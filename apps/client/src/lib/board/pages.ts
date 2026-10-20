import type { CanvasDocument, Item } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { runCommand } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Pages (docs/archive/PAGES_PLAN.md): a PARTITION over the flat item map, never
 * sub-documents. `doc.pages` empty = a single-page board; `item.pageId`
 * absent = the board's first page. `pageItems` is the ONLY sanctioned
 * filter — any other `Object.values(doc.items)` must state its scope.
 */

const firstPageId = (doc: CanvasDocument): string | null => doc.pages[0]?.id ?? null;

/** The page the session is looking at (normalized to a real page). */
export function activePageId(doc: CanvasDocument): string | null {
  const want = useSessionStore.getState().activePageId;
  if (want && doc.pages.some((p) => p.id === want)) return want;
  return firstPageId(doc);
}

/** Does this item live on `pageId` (both normalized to the first page)? */
export function onPage(doc: CanvasDocument, item: Item, pageId: string | null): boolean {
  const first = firstPageId(doc);
  return (item.pageId ?? first) === (pageId ?? first);
}

/** All items of one page. `pageId` null = the first page. */
export function pageItems(doc: CanvasDocument, pageId: string | null): Item[] {
  return Object.values(doc.items).filter((i) => onPage(doc, i, pageId));
}

/** Appearance for a page: page overrides ?? board settings. */
export function effectiveAppearance(doc: CanvasDocument, pageId: string | null) {
  const page = doc.pages.find((p) => p.id === pageId);
  const s = doc.settings;
  return {
    background: page?.background ?? s.background,
    backgroundImage: page?.backgroundImage === undefined ? s.backgroundImage : page.backgroundImage,
    gridVisible: page?.gridVisible ?? s.gridVisible,
    gridOpacity: page?.gridOpacity ?? s.gridOpacity,
    gridType: page?.gridType ?? s.gridType,
    themeId: page?.themeId ?? s.themeId,
  };
}

/** Remember the live viewport on the page being left (no-history write —
 *  same rail as doc.viewport). */
function storeViewportIntoActivePage(): void {
  const { doc } = useDocumentStore.getState();
  const id = activePageId(doc);
  if (!id) return;
  const pages = doc.pages.map((p) => (p.id === id ? { ...p, viewport: doc.viewport } : p));
  useDocumentStore.getState().setPages(pages);
}

/** Jump-to-item paths: make the item's page active before focusing it. */
export function revealItemPage(itemId: string): void {
  const { doc } = useDocumentStore.getState();
  const item = doc.items[itemId];
  if (!item) return;
  const target = item.pageId ?? firstPageId(doc);
  if (target && target !== activePageId(doc)) switchPage(target);
}

export function switchPage(id: string): void {
  const { doc } = useDocumentStore.getState();
  const target = doc.pages.find((p) => p.id === id);
  if (!target || id === activePageId(doc)) return;
  storeViewportIntoActivePage();
  const session = useSessionStore.getState();
  session.setSelection([]);
  session.setEditingItemId(null);
  session.setIsolatedGroup(null);
  session.setActivePageId(id);
  useDocumentStore.getState().setViewport(target.viewport);
}

/** Materialize the implicit first page (single-page boards have none). */
function ensureFirstPage(draft: CanvasDocument): void {
  if (draft.pages.length === 0) {
    draft.pages.push({ id: newId(), name: 'Page 1', viewport: draft.viewport });
  }
}

/** Add a page and switch to it. Returns the new page id. */
export function addPage(name?: string): string {
  storeViewportIntoActivePage();
  const id = newId();
  runCommand('Add page', (draft) => {
    ensureFirstPage(draft);
    draft.pages.push({
      id,
      name: name?.trim() || `Page ${draft.pages.length + 1}`,
      viewport: { x: 0, y: 0, scale: 1 },
    });
  });
  const session = useSessionStore.getState();
  session.setSelection([]);
  session.setActivePageId(id);
  useDocumentStore.getState().setViewport({ x: 0, y: 0, scale: 1 });
  return id;
}

export function renamePage(id: string, name: string): void {
  if (!name.trim()) return;
  runCommand('Rename page', (draft) => {
    const page = draft.pages.find((p) => p.id === id);
    if (page) page.name = name.trim();
  });
}

/** Duplicate a page: clones its items (new ids; groups re-keyed) onto a new
 *  page appended after it. Connections between cloned items come along. */
export function duplicatePage(id: string): string | null {
  const { doc } = useDocumentStore.getState();
  const src = doc.pages.find((p) => p.id === id);
  if (!src) return null;
  const newPage = newId();
  const members = pageItems(doc, id);
  const idMap = new Map(members.map((m) => [m.id, newId()]));
  const groupMap = new Map<string, string>();
  runCommand('Duplicate page', (draft) => {
    const at = draft.pages.findIndex((p) => p.id === id);
    draft.pages.splice(at + 1, 0, { ...src, id: newPage, name: `${src.name} copy` });
    for (const m of members) {
      let groupId = m.groupId;
      if (groupId) {
        if (!groupMap.has(groupId)) {
          const g = draft.groups[groupId];
          const cloneG = newId();
          groupMap.set(groupId, cloneG);
          if (g) draft.groups[cloneG] = { ...g, id: cloneG };
        }
        groupId = groupMap.get(groupId)!;
      }
      draft.items[idMap.get(m.id)!] = { ...m, id: idMap.get(m.id)!, groupId, pageId: newPage };
    }
    // Nesting among the cloned groups follows; a parent that stayed behind
    // (its items on other pages) is dropped and the clone sits top level.
    for (const cloneG of groupMap.values()) {
      const g = draft.groups[cloneG];
      if (!g?.parentId) continue;
      const mapped = groupMap.get(g.parentId);
      if (mapped) g.parentId = mapped;
      else delete g.parentId;
    }
    for (const c of Object.values(draft.connections)) {
      const from = c.from.kind === 'item' ? idMap.get(c.from.id) : undefined;
      const to = c.to.kind === 'item' ? idMap.get(c.to.id) : undefined;
      if (from && to) {
        const cid = newId();
        draft.connections[cid] = {
          ...c,
          id: cid,
          from: { kind: 'item', id: from },
          to: { kind: 'item', id: to },
        };
      }
    }
  });
  return newPage;
}

/** Delete a page; its items either MOVE to the first remaining page or go. */
export function deletePage(id: string, mode: 'move' | 'delete'): void {
  const { doc } = useDocumentStore.getState();
  if (doc.pages.length < 2) return; // never delete the only page
  const members = pageItems(doc, id).map((m) => m.id);
  const memberSet = new Set(members);
  runCommand('Delete page', (draft) => {
    draft.pages = draft.pages.filter((p) => p.id !== id);
    for (const itemId of members) {
      const item = draft.items[itemId];
      if (!item) continue;
      if (mode === 'move') {
        // Items land on the (new) FIRST page — the implicit default, so the
        // stamp just comes off.
        delete item.pageId;
      } else {
        delete draft.items[itemId];
      }
    }
    if (mode === 'delete') {
      for (const [cid, c] of Object.entries(draft.connections)) {
        const dead =
          (c.from.kind === 'item' && memberSet.has(c.from.id)) ||
          (c.to.kind === 'item' && memberSet.has(c.to.id));
        if (dead) delete draft.connections[cid];
      }
    }
  });
  const session = useSessionStore.getState();
  if (session.activePageId === id) {
    const next = useDocumentStore.getState().doc.pages[0];
    session.setActivePageId(next?.id ?? null);
    if (next) useDocumentStore.getState().setViewport(next.viewport);
  }
}
