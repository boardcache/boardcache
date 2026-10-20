import { Zip, ZipPassThrough, unzip } from 'fflate';
import { fetchTeamDoc, listBoards, loadBoardRecord } from '../board/boardLibrary';
import { platform } from '../platform';
import { exportBoardFile, exportLockedBoardFile, importBoardFile } from '../board/boardcacheFile';
import { getLockedRecord } from '../board/boardLock';

/**
 * Whole-library backups: a plain zip of one .boardcache file per board
 * (each already a self-contained zip with assets) plus a manifest — named
 * like 2026-07-17_1530_boardcache_backup.zip. Remote destinations relay
 * through the sync server's /backup proxy (S3, FTP/SFTP, WebDAV/NextCloud,
 * Git); Download works everywhere.
 */

export type BackupDest = 'download' | 's3' | 'ftp' | 'sftp' | 'webdav' | 'git';

export const REMOTE_DESTS = ['s3', 'ftp', 'sftp', 'webdav', 'git'] as const;

export const DEST_LABELS: Record<BackupDest, string> = {
  download: 'Download file',
  s3: 'S3 (AWS / compatible)',
  ftp: 'FTP / FTPS',
  sftp: 'SFTP',
  webdav: 'WebDAV / NextCloud',
  git: 'Git repository',
};

// --- saved destination configs (local-only; they hold credentials) --------------

const TARGETS_KEY = 'boardcache:backupTargets';

export type DestConfig = Record<string, string | number | boolean>;

export function loadTargets(): Record<string, DestConfig> {
  try {
    return (
      (JSON.parse(localStorage.getItem(TARGETS_KEY) ?? '{}') as Record<string, DestConfig>) ?? {}
    );
  } catch {
    return {};
  }
}

export function saveTarget(dest: string, config: DestConfig): void {
  try {
    const all = loadTargets();
    all[dest] = config;
    localStorage.setItem(TARGETS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

// --- building --------------------------------------------------------------------

function backupFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}`;
  return `${date}_${time}_boardcache_backup.zip`;
}

function safeEntryName(name: string, id: string): string {
  const base = name.replace(/[^\w.-]+/g, '_').slice(0, 50) || 'board';
  return `${base}-${id.slice(0, 6)}.boardcache`;
}

export interface BackupBuild {
  blob: Blob;
  filename: string;
  included: number;
  /** Boards that couldn't be packaged: known from the server but not
   *  downloadable right now (offline, or the download failed). */
  skippedLocked: string[];
}

/**
 * A board that is only a stub from the server (lazy sync) has nothing to
 * export yet; pull it first. Locked boards arrive as their lock ciphertext,
 * which is exactly what the export carries. Returns false when it couldn't
 * be fetched (offline), so the caller can report it instead of silently
 * leaving a hole in the backup.
 */
async function ensureLocal(summary: { id: string; remote?: boolean }): Promise<boolean> {
  if (!summary.remote) return true;
  const { downloadBoard } = await import('./boardSync');
  return downloadBoard(summary.id);
}

/** Package every board (local + synced) into one backup zip. */
export async function buildBackupZip(): Promise<BackupBuild> {
  const summaries = await listBoards();
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    if (chunk) chunks.push(chunk);
    if (final || err) resolveDone();
  });
  // Inner .boardcache files are already deflated zips — store, don't recompress.
  const addStored = (name: string, data: Uint8Array) => {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(data, true);
  };

  const skippedLocked: string[] = [];
  const manifestBoards: { id: string; name: string; entry: string; locked?: boolean }[] = [];
  for (const summary of summaries) {
    let file: Blob;
    if (!(await ensureLocal(summary))) {
      skippedLocked.push(summary.name);
      continue;
    }
    if (summary.locked) {
      // Locked boards ride as their lock ciphertext — restore lands locked.
      const locked = await getLockedRecord(summary.id);
      if (!locked) {
        skippedLocked.push(summary.name);
        continue;
      }
      file = await exportLockedBoardFile(locked);
    } else {
      const doc = await loadBoardRecord(summary.id);
      if (!doc) {
        skippedLocked.push(summary.name);
        continue;
      }
      file = await exportBoardFile(doc);
    }
    const entry = safeEntryName(summary.name, summary.id);
    addStored(entry, new Uint8Array(await file.arrayBuffer()));
    manifestBoards.push({
      id: summary.id,
      name: summary.name,
      entry,
      ...(summary.locked ? { locked: true } : {}),
    });
  }
  addStored(
    'backup-manifest.json',
    new TextEncoder().encode(
      JSON.stringify(
        {
          app: 'boardcache',
          kind: 'backup',
          createdAt: new Date().toISOString(),
          boards: manifestBoards,
        },
        null,
        2,
      ),
    ),
  );
  zip.end();
  await done;
  if (zipError) throw zipError;
  return {
    blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }),
    filename: backupFilename(),
    included: manifestBoards.length,
    skippedLocked,
  };
}

// --- parsing / importing -----------------------------------------------------------

function unzipAll(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

export interface BackupEntry {
  fileName: string;
  boardName: string;
  blob: Blob;
}

/** Board name from a .boardcache blob's manifest (falls back to filename). */
async function boardNameOf(blob: Blob, fallback: string): Promise<string> {
  try {
    const files = await unzipAll(new Uint8Array(await blob.arrayBuffer()));
    const manifest = files['manifest.json'];
    if (!manifest) return fallback;
    const parsed = JSON.parse(new TextDecoder().decode(manifest)) as { name?: string };
    return parsed.name || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Turn a picked/fetched file into importable board entries: a backup zip
 * yields one entry per contained board; a single .boardcache yields itself.
 */
export async function collectBackupEntries(
  file: File | Blob,
  fileName: string,
): Promise<BackupEntry[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.boardcache') || lower.endsWith('.refboard')) {
    return [{ fileName, boardName: await boardNameOf(file, fileName), blob: file }];
  }
  const files = await unzipAll(new Uint8Array(await file.arrayBuffer()));
  // A single-board .zip export is a .boardcache in disguise (has manifest.json).
  if (files['manifest.json'] && files['document.json']) {
    return [{ fileName, boardName: await boardNameOf(file, fileName), blob: file }];
  }
  const entries: BackupEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (!/\.(boardcache|refboard)$/i.test(name)) continue;
    const blob = new Blob([data as BlobPart], { type: 'application/zip' });
    entries.push({ fileName: name, boardName: await boardNameOf(blob, name), blob });
  }
  if (!entries.length) throw new Error('No boards found in this file.');
  return entries;
}

export type ConflictChoice = 'replace' | 'skip' | 'keep';

export interface ImportRow {
  entry: BackupEntry;
  /** Existing board with the same name (case-insensitive), if any. */
  existing: { id: string; name: string } | null;
}

/** Match entries against the current library by board name. */
export async function planImport(entries: BackupEntry[]): Promise<ImportRow[]> {
  const boards = await listBoards();
  const byName = new Map(boards.map((b) => [b.name.trim().toLowerCase(), b]));
  return entries.map((entry) => {
    const hit = byName.get(entry.boardName.trim().toLowerCase());
    return { entry, existing: hit ? { id: hit.id, name: hit.name } : null };
  });
}

export interface ImportResult {
  imported: number;
  replaced: number;
  skipped: number;
  errors: string[];
  /** Board id of the last successful import (single-import auto-open). */
  lastImportedId: string | null;
}

/** Execute the plan: replace overwrites the matched board in place. */
export async function runImport(
  rows: ImportRow[],
  choices: ConflictChoice[],
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    replaced: 0,
    skipped: 0,
    errors: [],
    lastImportedId: null,
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const choice = row.existing ? (choices[i] ?? 'keep') : 'keep';
    if (choice === 'skip') {
      result.skipped += 1;
      continue;
    }
    try {
      const imported = await importBoardFile(
        row.entry.blob,
        choice === 'replace' && row.existing ? { assignId: row.existing.id } : {},
      );
      result.lastImportedId = imported.locked ? null : imported.id;
      if (choice === 'replace') result.replaced += 1;
      else result.imported += 1;
    } catch (err) {
      result.errors.push(
        `${row.entry.boardName}: ${err instanceof Error ? err.message : 'import failed'}`,
      );
    }
  }
  return result;
}

// --- remote transport ----------------------------------------------------------------

export async function uploadBackup(
  dest: Exclude<BackupDest, 'download'>,
  config: DestConfig,
  filename: string,
  blob: Blob,
): Promise<void> {
  const res = await platform.backupPut({
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/zip',
      'x-backup-dest': dest,
      'x-backup-name': filename,
      'x-backup-config': btoa(JSON.stringify(config)),
    },
    body: blob,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Upload failed (${res.status}).`);
  }
}

export interface RemoteFile {
  name: string;
  size: number | null;
  mtime: string | null;
}

export async function listRemoteBackups(
  dest: Exclude<BackupDest, 'download'>,
  config: DestConfig,
): Promise<RemoteFile[]> {
  const res = await platform.backupList({
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dest, config }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Listing failed (${res.status}).`);
  }
  return ((await res.json()) as { files: RemoteFile[] }).files;
}

export async function fetchRemoteBackup(
  dest: Exclude<BackupDest, 'download'>,
  config: DestConfig,
  name: string,
): Promise<Blob> {
  const res = await platform.backupGet({
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dest, config, name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Download failed (${res.status}).`);
  }
  return res.blob();
}

// Passphrase encryption lives in backupCrypto (shared with the share viewer).
export { encryptBackup, decryptBackup, isEncryptedBackup } from './backupCrypto';

/**
 * Export chosen boards for the library index: one board downloads as its
 * .boardcache; several bundle into one stored (not recompressed) zip.
 * Locked boards ride as their lock ciphertext, like backups — restoring
 * them lands locked.
 */
export async function exportBoardsFiles(
  ids: string[],
): Promise<{ blob: Blob; filename: string } | null> {
  const summaries = (await listBoards()).filter((b) => ids.includes(b.id));
  const parts: { name: string; blob: Blob }[] = [];
  for (const summary of summaries) {
    if (!(await ensureLocal(summary))) continue;
    if (summary.locked) {
      const locked = await getLockedRecord(summary.id);
      if (!locked) continue;
      parts.push({
        name: safeEntryName(summary.name, summary.id),
        blob: await exportLockedBoardFile(locked),
      });
    } else {
      const doc = await loadBoardRecord(summary.id);
      if (!doc) continue;
      parts.push({
        name: safeEntryName(summary.name, summary.id),
        blob: await exportBoardFile(doc),
      });
    }
  }
  return bundleParts(parts);
}

/** Export team boards by fetching their room documents. */
export async function exportTeamBoardsFiles(
  teamIds: string[],
): Promise<{ blob: Blob; filename: string } | null> {
  const parts: { name: string; blob: Blob }[] = [];
  for (const id of teamIds) {
    const fetched = await fetchTeamDoc(id);
    if (!fetched) continue;
    parts.push({ name: safeEntryName(fetched.name, id), blob: await exportBoardFile(fetched.doc) });
  }
  return bundleParts(parts);
}

/** One part downloads as-is; several bundle into a stored zip. */
async function bundleParts(
  parts: { name: string; blob: Blob }[],
): Promise<{ blob: Blob; filename: string } | null> {
  if (parts.length === 0) return null;
  if (parts.length === 1) return { blob: parts[0]!.blob, filename: parts[0]!.name };

  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    if (chunk) chunks.push(chunk);
    if (final || err) resolveDone();
  });
  for (const part of parts) {
    const file = new ZipPassThrough(part.name);
    zip.add(file);
    file.push(new Uint8Array(await part.blob.arrayBuffer()), true);
  }
  zip.end();
  await done;
  if (zipError) throw zipError;
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }),
    filename: `boardcache-export-${stamp}.zip`,
  };
}
