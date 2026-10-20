import type { CanvasDocument, Item } from '@boardcache/schema';
import { newId, parseDocument } from '@boardcache/schema';
import { openBoard, saveBoardRecord } from './boardLibrary';
import { getCanvasContainer } from '../canvas/canvasDom';
import { visibleCanvasRect } from '../canvas/coords';
import { getDb } from '../db';
import { downloadBlob } from '../export/download';
import { exportBoardFile, importBoardFile, ImportError } from './boardcacheFile';
import { contentBounds, renderRegion } from '../media/thumbnail';
import { useDocumentStore } from '../../state/documentStore';
import { isInsideGroup } from '../canvas/grouping';

/** User-facing export/import entry points (toolbar, library, drag-drop). */

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'board';
}

/**
 * Output pixel size for a high-res PNG of a canvas-space region. PNG is already
 * lossless; this supersamples (up to 4×) for crispness and caps the largest
 * side so the canvas stays within browser limits.
 */
const MAX_PNG_DIM = 10000;
const MAX_SUPERSAMPLE = 4;
function hiResDims(width: number, height: number): { width: number; height: number } {
  const fit = Math.min(MAX_PNG_DIM / width, MAX_PNG_DIM / height);
  const scale = Math.min(fit, MAX_SUPERSAMPLE) || 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function pageBackground(doc: CanvasDocument): string {
  if (doc.settings.background !== 'default') return doc.settings.background;
  return document.documentElement.dataset.theme === 'dark' ? '#1b1f24' : '#fafafa';
}

/** Export the open board as .boardcache; a passphrase wraps it in AES-256-GCM. */
export async function exportCurrentAsBoardcache(passphrase?: string): Promise<void> {
  const { doc } = useDocumentStore.getState();
  let blob = await exportBoardFile(doc);
  let name = `${safeFilename(doc.name)}.boardcache`;
  if (passphrase?.trim()) {
    const { encryptBackup } = await import('../sync/backup');
    blob = await encryptBackup(blob, passphrase.trim());
    name += '.enc';
  }
  downloadBlob(blob, name);
}

/**
 * Export one group as a .boardcache archive: the member items, the group
 * record, connections that stay inside the group, and every referenced
 * asset. Round-trips through the normal board import.
 */
export async function exportGroupAsArchive(groupId: string): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const group = doc.groups[groupId];
  if (!group) return;
  const items = Object.fromEntries(
    Object.entries(doc.items).filter(([, it]) => isInsideGroup(doc, it, groupId)),
  );
  const memberIds = new Set(Object.keys(items));
  const inGroup = (ep: { kind: 'item' | 'group'; id: string }) =>
    ep.kind === 'item' ? memberIds.has(ep.id) : ep.id === groupId;
  const connections = Object.fromEntries(
    Object.entries(doc.connections).filter(([, c]) => inGroup(c.from) && inGroup(c.to)),
  );
  const sub: CanvasDocument = {
    ...doc,
    id: newId(),
    name: group.name ?? `${doc.name} group`,
    items,
    groups: { [groupId]: group },
    connections,
    settings: {
      ...doc.settings,
      galleryOrder: doc.settings.galleryOrder.filter((id) => memberIds.has(id)),
      coverItemId: memberIds.has(doc.settings.coverItemId ?? '') ? doc.settings.coverItemId : null,
    },
  };
  const blob = await exportBoardFile(sub);
  downloadBlob(blob, `${safeFilename(sub.name)}.boardcache`);
}

/** Whole board as a plain-files zip (folders per type, no manifest). */
export async function exportBoardAsPlainZip(): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const { exportPlainZip } = await import('../export/exportPlainZip');
  await exportPlainZip(Object.values(doc.items), safeFilename(doc.name));
}

/** One group as a plain-files zip (folders per type, no manifest). */
export async function exportGroupAsPlainZip(groupId: string): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const group = doc.groups[groupId];
  if (!group) return;
  await exportItemsAsPlainZip(
    Object.values(doc.items).filter((it) => isInsideGroup(doc, it, groupId)),
    group.name ?? `${doc.name} group`,
  );
}

/** PNG of a group: its members' bounds, rendered high-res on the page background. */
export async function exportGroupAsPng(groupId: string): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const group = doc.groups[groupId];
  if (!group) return;
  await exportItemsAsPng(
    Object.values(doc.items).filter((it) => isInsideGroup(doc, it, groupId)),
    group.name ?? `${doc.name} group`,
  );
}

/** Zip of the items' own files plus the Markdown form of any structured cards. */
export async function exportItemsAsPlainZip(items: Item[], name: string): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const [{ exportPlainZip }, { cardMarkdownEntries }] = await Promise.all([
    import('../export/exportPlainZip'),
    import('../export/downloadItem'),
  ]);
  await exportPlainZip(items, safeFilename(name), cardMarkdownEntries(items, doc));
}

const ITEMS_PNG_PAD = 24;
/** High-res PNG of just these items: their bounds plus a margin, on the page background. */
export async function exportItemsAsPng(items: Item[], name: string): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const bounds = contentBounds(doc, items);
  if (!bounds) return;
  const region = {
    x: bounds.x - ITEMS_PNG_PAD,
    y: bounds.y - ITEMS_PNG_PAD,
    width: bounds.width + ITEMS_PNG_PAD * 2,
    height: bounds.height + ITEMS_PNG_PAD * 2,
  };
  const out = hiResDims(region.width, region.height);
  const keep = new Set(items.map((i) => i.id));
  const only: CanvasDocument = {
    ...doc,
    items: Object.fromEntries(Object.entries(doc.items).filter(([id]) => keep.has(id))),
  };
  const blob = await renderRegion(only, region, out.width, out.height, pageBackground(doc));
  downloadBlob(blob, `${safeFilename(name)}.png`);
}

/** High-res, lossless PNG of exactly what the viewport shows right now. */
export async function exportViewAsPng(): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const container = getCanvasContainer();
  const width = container?.clientWidth ?? 1280;
  const height = container?.clientHeight ?? 800;
  const region = visibleCanvasRect(doc.viewport, width, height);
  const out = hiResDims(width, height);
  const blob = await renderRegion(doc, region, out.width, out.height, pageBackground(doc));
  downloadBlob(blob, `${safeFilename(doc.name)}.png`);
}

/**
 * Highest-resolution PNG of the whole board: the bounding box of every item,
 * rendered as large as browser canvas limits allow.
 */
export async function renderPagePng(
  doc: CanvasDocument,
  pageId: string | null | 'all',
): Promise<Blob | null> {
  const firstPg = doc.pages[0]?.id ?? null;
  const items =
    pageId === 'all'
      ? undefined
      : Object.values(doc.items).filter((i) => (i.pageId ?? firstPg) === (pageId ?? firstPg));
  const bounds = contentBounds(doc, items);
  if (!bounds) return null;
  const pad = 48;
  const region = {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
  const out = hiResDims(region.width, region.height);
  return renderRegion(
    doc,
    region,
    out.width,
    out.height,
    pageBackground(doc),
    undefined,
    undefined,
    'contain',
    pageId,
  );
}

/** Full-board image. Scope (docs/archive/PAGES_PLAN.md): 'page' renders the active
 *  page; 'all' zips one PNG per page (single-page boards download one PNG). */
export async function exportFullAsPng(scope: 'page' | 'all' = 'page'): Promise<void> {
  const { doc } = useDocumentStore.getState();
  if (scope === 'page' || doc.pages.length <= 1) {
    const { activePageId } = await import('./pages');
    const pageId = doc.pages.length > 1 ? activePageId(doc) : 'all';
    const blob = await renderPagePng(doc, pageId);
    if (!blob) {
      window.alert('This page is empty — nothing to export.');
      return;
    }
    downloadBlob(blob, `${safeFilename(doc.name)}-full.png`);
    return;
  }
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const page of doc.pages) {
    const blob = await renderPagePng(doc, page.id);
    if (!blob) continue;
    files[`${safeFilename(doc.name)} — ${safeFilename(page.name)}.png`] = new Uint8Array(
      await blob.arrayBuffer(),
    );
  }
  if (Object.keys(files).length === 0) {
    window.alert('This board is empty — nothing to export.');
    return;
  }
  downloadBlob(
    new Blob([zipSync(files).buffer as ArrayBuffer], { type: 'application/zip' }),
    `${safeFilename(doc.name)}-pages.png.zip`,
  );
}

async function importBoardcacheFile(file: File | Blob): Promise<void> {
  let blob: Blob = file;
  const { isEncryptedBackup, decryptBackup } = await import('../sync/backup');
  if (await isEncryptedBackup(blob)) {
    const passphrase = window.prompt('This board file is encrypted. Enter its passphrase:');
    if (!passphrase) return;
    try {
      blob = await decryptBackup(blob, passphrase);
    } catch {
      throw new ImportError('Wrong passphrase (or the file is corrupted).');
    }
  }
  const { id, locked } = await importBoardFile(blob);
  // A locked import can't open without its password — it lands in the library.
  if (!locked) await openBoard(id);
}

export async function importJsonFile(file: File): Promise<void> {
  let doc = parseDocument(await file.text());
  const db = await getDb();
  if (await db.get('boards', doc.id)) doc = { ...doc, id: newId() };
  await saveBoardRecord(doc, true);
  await openBoard(doc.id);
}

/** Route a dropped/picked file to the right importer; false = not a board. */
export async function importBoardFromFile(file: File): Promise<boolean> {
  const lower = file.name.toLowerCase();
  try {
    if (/\.(boardcache|refboard)(\.enc)?$/.test(lower) || lower.endsWith('.zip')) {
      await importBoardcacheFile(file);
      return true;
    }
    if (lower.endsWith('.json')) {
      await importJsonFile(file);
      return true;
    }
  } catch (err) {
    const message = err instanceof ImportError ? err.message : `Could not import ${file.name}`;
    console.error('boardCache: import failed', err);
    window.alert(message);
    return true; // it was a board file, just a broken one — don't fall through
  }
  return false;
}
