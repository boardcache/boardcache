import { Zip, ZipDeflate, ZipPassThrough, unzip } from 'fflate';
import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds, newId, parseDocument, serializeDocument } from '@boardcache/schema';
import { putLockedAssetRecord, putAsset, sha256Hex } from './assetStore';
import { saveBoardRecord } from './boardLibrary';
import { getDb } from '../db';
import { renderThumbnails } from '../media/thumbnail';

/**
 * The .refboard format (brief §3.3): a plain zip —
 *   manifest.json   formatVersion, board id/name, asset index
 *   document.json   the CanvasDocument (media referenced by assetId)
 *   thumbnail.png   board-library preview
 *   assets/<sha256> raw blobs, stored uncompressed (media is already
 *                   compressed; PassThrough avoids size inflation and
 *                   pointless CPU)
 */

// v1: plaintext board. v2 adds locked exports (lock ciphertext + per-asset
// locked flags) — plain exports still stamp v1 so older apps keep importing.
const BOARDCACHE_FORMAT_VERSION = 2;
const PLAIN_FORMAT_VERSION = 1;

interface Manifest {
  formatVersion: number;
  boardId: string;
  name: string;
  exportedAt: string;
  assets: Record<string, { mime: string; bytes: number; locked?: boolean }>;
  /** v2: present for locked exports — document travels as lock ciphertext. */
  lock?: { salt: string; doc: string };
  updatedAt?: string;
}

/** Stream the board + referenced assets into a .refboard zip blob. */
export async function exportBoardFile(doc: CanvasDocument): Promise<Blob> {
  const assetIds = collectAssetIds(doc);
  const db = await getDb();

  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    if (chunk) chunks.push(chunk);
    if (final || err) resolveDone();
  });

  const addDeflated = (name: string, data: Uint8Array) => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(data, true);
  };

  // Manifest first so importers can sniff it cheaply.
  const manifest: Manifest = {
    formatVersion: PLAIN_FORMAT_VERSION,
    boardId: doc.id,
    name: doc.name,
    exportedAt: new Date().toISOString(),
    assets: {},
  };
  const assetRecords = new Map<string, { blob: Blob; mime: string }>();
  for (const id of assetIds) {
    const record = await db.get('assets', id);
    if (!record) {
      console.warn(`boardCache: asset ${id} missing from store; exporting without it`);
      continue;
    }
    manifest.assets[id] = { mime: record.mime, bytes: record.bytes };
    assetRecords.set(id, { blob: record.blob, mime: record.mime });
  }

  // The thumbnail goes FIRST and stored (not deflated): Finder/Explorer
  // thumbnail extensions read it straight out of the first local header.
  try {
    const thumb = (await renderThumbnails(doc)).light;
    const file = new ZipPassThrough('thumbnail.png');
    zip.add(file);
    file.push(new Uint8Array(await thumb.arrayBuffer()), true);
  } catch {
    /* preview is optional */
  }

  addDeflated('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  addDeflated('document.json', new TextEncoder().encode(serializeDocument(doc)));

  // Stream each blob through in slices so large boards never materialize
  // as one buffer.
  for (const [id, { blob }] of assetRecords) {
    const file = new ZipPassThrough(`assets/${id}`);
    zip.add(file);
    const reader = blob.stream().getReader();
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      file.push(value);
    }
    file.push(new Uint8Array(0), true);
  }

  zip.end();
  await done;
  if (zipError) throw zipError;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

/**
 * Export a LOCKED board without its password: manifest v2 carries the lock
 * ciphertext; locked assets ship as their stored ciphertext (flagged), shared
 * plaintext assets ship as-is. Restoring lands the board locked.
 */
export async function exportLockedBoardFile(locked: {
  id: string;
  name: string;
  updatedAt: string;
  salt: string;
  doc: string;
  assets: string[];
}): Promise<Blob> {
  const db = await getDb();
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    if (chunk) chunks.push(chunk);
    if (final || err) resolveDone();
  });
  const addDeflated = (name: string, data: Uint8Array) => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(data, true);
  };

  const manifest: Manifest = {
    formatVersion: BOARDCACHE_FORMAT_VERSION,
    boardId: locked.id,
    name: locked.name,
    exportedAt: new Date().toISOString(),
    updatedAt: locked.updatedAt,
    lock: { salt: locked.salt, doc: locked.doc },
    assets: {},
  };
  const blobs = new Map<string, Blob>();
  for (const id of new Set(locked.assets)) {
    const record = await db.get('assets', id);
    if (!record) continue;
    manifest.assets[id] = {
      mime: record.mime,
      bytes: record.bytes,
      ...(record.lock ? { locked: true } : {}),
    };
    blobs.set(id, record.blob);
  }
  addDeflated('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  for (const [id, blob] of blobs) {
    const file = new ZipPassThrough(`assets/${id}`);
    zip.add(file);
    file.push(new Uint8Array(await blob.arrayBuffer()), true);
  }
  zip.end();
  await done;
  if (zipError) throw zipError;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

function unzipAll(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

export class ImportError extends Error {
  override name = 'ImportError';
}

/**
 * Import a .refboard file: manifest → format check → validate document →
 * verify every asset hash (free integrity check) → copy blobs into the
 * local store (existing hashes skipped) → save to the library.
 * Returns the imported document, ready to activate.
 */
export async function importBoardFile(
  file: File | Blob,
  opts: { assignId?: string } = {},
): Promise<{ id: string; locked: boolean }> {
  const files = await unzipAll(new Uint8Array(await file.arrayBuffer())).catch(() => {
    throw new ImportError('Not a valid .refboard file (unreadable zip)');
  });

  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) throw new ImportError('Missing manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest;
  if (
    typeof manifest.formatVersion !== 'number' ||
    manifest.formatVersion > BOARDCACHE_FORMAT_VERSION
  ) {
    throw new ImportError(
      `This board was exported by a newer boardCache (format ${manifest.formatVersion}).`,
    );
  }

  // v2 locked export: no document — restore the lock record + assets as-is.
  if (manifest.lock) {
    const db = await getDb();
    let id = opts.assignId ?? manifest.boardId;
    if (!opts.assignId && (await db.get('boards', id))) id = newId();
    for (const [hash, meta] of Object.entries(manifest.assets)) {
      const bytes = files[`assets/${hash}`];
      if (!bytes) throw new ImportError(`Archive is missing asset ${hash.slice(0, 12)}…`);
      const blob = new Blob([bytes as BlobPart], {
        type: meta.locked ? 'application/octet-stream' : meta.mime,
      });
      if (meta.locked) {
        // Lock ciphertext: the plaintext hash can't be checked without the
        // password — the lock's AES-GCM authenticates on unlock instead.
        await putLockedAssetRecord(hash, blob, id);
      } else {
        if ((await sha256Hex(blob)) !== hash) {
          throw new ImportError(`Asset ${hash.slice(0, 12)}… failed its integrity check`);
        }
        await putAsset(blob);
      }
    }
    await db.put('boards', {
      id,
      doc: null,
      name: manifest.name,
      updatedAt: manifest.updatedAt ?? new Date().toISOString(),
      lock: {
        salt: manifest.lock.salt,
        doc: manifest.lock.doc,
        assets: Object.keys(manifest.assets),
      },
    });
    return { id, locked: true };
  }

  const documentRaw = files['document.json'];
  if (!documentRaw) throw new ImportError('Missing document.json');
  let doc: CanvasDocument;
  try {
    doc = parseDocument(new TextDecoder().decode(documentRaw));
  } catch (err) {
    throw new ImportError(`Invalid board document: ${err instanceof Error ? err.message : err}`);
  }

  // Verify + store assets. putAsset hashes the bytes itself, so a corrupted
  // blob can never land under the manifest's hash — but verify explicitly to
  // reject tampered archives with a clear error.
  for (const [hash, meta] of Object.entries(manifest.assets)) {
    const bytes = files[`assets/${hash}`];
    if (!bytes) throw new ImportError(`Archive is missing asset ${hash.slice(0, 12)}…`);
    const blob = new Blob([bytes as BlobPart], { type: meta.mime });
    const actual = await sha256Hex(blob);
    if (actual !== hash) {
      throw new ImportError(`Asset ${hash.slice(0, 12)}… failed its integrity check`);
    }
    await putAsset(blob);
  }

  if (opts.assignId) {
    // Replace mode: land on the chosen existing board's id (overwrite).
    doc = { ...doc, id: opts.assignId };
  } else {
    // Keep the embedded board id unless it collides with an existing board.
    const db = await getDb();
    const collision = await db.get('boards', doc.id);
    if (collision) doc = { ...doc, id: newId() };
  }

  await saveBoardRecord(doc, true);
  return { id: doc.id, locked: false };
}
