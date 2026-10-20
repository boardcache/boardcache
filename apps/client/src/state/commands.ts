import { produce, produceWithPatches } from 'immer';
import { tally } from '../lib/usageTally';
import type {
  BoardSettings,
  BackgroundImage,
  CanvasDocument,
  ConnectionEndpoint,
  ConnectionRel,
  Item,
  PaletteEntry,
  SwatchItem,
} from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { collabNotifyPatches } from '../lib/sync/collab';
import { connectionExists, endpointExists } from '../lib/canvas/connections';
import { remapClonedTimelines } from '../lib/structure/timelineLayout';
import { remapClonedStoryboards } from '../lib/structure/storyboardAttach';
import { mapPosterKey } from '../lib/integrations/mapEmbed';
import { useDocumentStore } from './documentStore';
import { useHistoryStore } from './history';
import {
  groupChain,
  selectionUnits,
  groupMembers,
  type SelectionUnit,
} from '../lib/canvas/grouping';
import { useSessionStore } from './sessionStore';
import { useCollabStore } from './collabStore';
import { useSyncStore } from './syncStore';

/**
 * Commands are the only writers of document content (rule 3.4). Every
 * mutation runs inside produceWithPatches; the history manager stores the
 * patch pair. One gesture = one command = one undo step.
 */
export function runCommand(label: string, recipe: (draft: CanvasDocument) => void): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const [next, patches, inversePatches] = produceWithPatches(doc, recipe);
  if (patches.length === 0) return; // no-op commands stay out of history
  // The timestamp is stamped outside patch recording so it never masquerades
  // as (or hides) a real change; undo intentionally keeps the newer stamp.
  replaceDoc({ ...next, updatedAt: new Date().toISOString() });
  useHistoryStore.getState().push({ label, patches, inversePatches });
  collabNotifyPatches(patches); // live team boards mirror every command
}

/**
 * Silent write: persists and mirrors to a live team room like any command,
 * but records NO history entry. For view-ish item state that must sync but
 * would pollute undo (PDF page, reader positions).
 */
export function runSilent(recipe: (draft: CanvasDocument) => void): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const [next, patches] = produceWithPatches(doc, recipe);
  if (patches.length === 0) return;
  replaceDoc({ ...next, updatedAt: new Date().toISOString() });
  collabNotifyPatches(patches);
}

/**
 * Board-settings write: preference-grade (no undo entry) but LIVE — it rides
 * runSilent so team boards mirror the change. Direct documentStore writes
 * never reached the room, which made board themes/grid settings silently
 * revert on team boards at the next resync. `undefined` clears a key.
 */
export function updateBoardSettings(patch: Partial<BoardSettings>): void {
  runSilent((draft) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (draft.settings as Record<string, unknown>)[k];
      else (draft.settings as Record<string, unknown>)[k] = v;
    }
  });
}

/** Highest zIndex currently in use (0 when the board is empty). */
export function topZIndex(doc: CanvasDocument): number {
  let top = 0;
  for (const item of Object.values(doc.items)) top = Math.max(top, item.zIndex);
  return top;
}

export function addItems(items: Item[], label = 'Add'): void {
  if (items.length === 0) return;
  for (const it of items) tally(`item.add.${it.type}`);
  const now = new Date().toISOString();
  runCommand(label, (draft) => {
    // New items land on the ACTIVE page (the one choke point every factory,
    // paste, import, and AI tool flows through). First-page items stay
    // unstamped — single-page boards remain byte-identical to pre-pages docs.
    const { activePageId: active, isolatedGroupId } = useSessionStore.getState();
    const stamp =
      active && active !== draft.pages[0]?.id && draft.pages.some((p) => p.id === active)
        ? active
        : undefined;
    // Inside an isolated group, whatever gets added or pasted joins that group
    // (the user is editing it); items that already belong somewhere keep it.
    const join = isolatedGroupId && draft.groups[isolatedGroupId] ? isolatedGroupId : null;
    for (const item of items) {
      draft.items[item.id] = {
        ...item,
        groupId: item.groupId ?? join,
        createdAt: item.createdAt ?? now,
        ...(item.pageId === undefined && stamp ? { pageId: stamp } : {}),
      };
    }
  });
}

export function removeItems(ids: string[], label = 'Delete'): void {
  if (ids.length === 0) return;
  runCommand(label, (draft) => {
    for (const id of ids) delete draft.items[id];
    pruneEmptyGroups(draft);
  });
}

/** Drop group records that no longer have any member items, then any
 *  connections left dangling by removed items/groups. */
export function pruneEmptyGroups(draft: CanvasDocument): void {
  // Timeline + tier-list attachments to deleted items go too. Only lists
  // that actually lose a member are rewritten: a fresh array for an
  // unchanged list is a patch for nothing (and a wire message on a team
  // board for nothing).
  const keepLive = (holder: { itemIds: string[] }) => {
    if (holder.itemIds.some((id) => !(id in draft.items))) {
      holder.itemIds = holder.itemIds.filter((id) => id in draft.items);
    }
  };
  for (const item of Object.values(draft.items)) {
    if (item.type === 'timeline') item.points.forEach(keepLive);
    else if (item.type === 'tierlist') item.rows.forEach(keepLive);
    else if (item.type === 'storyboard') item.panels.forEach(keepLive);
    else if (item.type === 'tree') item.nodes.forEach(keepLive);
    else if (item.type === 'case') {
      if (item.evidence.some((e) => !(e.itemId in draft.items))) {
        item.evidence = item.evidence.filter((e) => e.itemId in draft.items);
      }
    } else if (item.type === 'project') {
      // Associations are references: drop deleted items.
      keepLive(item);
      item.tasks.forEach(keepLive);
      item.milestones.forEach(keepLive);
    }
  }
  // Presentation steps point at items or groups; drop the ones that are gone.
  const steps = draft.presentation.steps;
  if (steps.some((st) => !(st.id in draft.items) && !(st.id in draft.groups))) {
    draft.presentation.steps = steps.filter((st) => st.id in draft.items || st.id in draft.groups);
  }
  // A group lives while any item sits in it at any depth: its own items, or
  // a subgroup's. A dangling parent (deleted, or a cycle) becomes top level.
  const used = new Set<string>();
  for (const item of Object.values(draft.items)) {
    for (const gid of groupChain(draft, item.groupId)) used.add(gid);
  }
  for (const gid of Object.keys(draft.groups)) {
    if (!used.has(gid)) delete draft.groups[gid];
  }
  for (const g of Object.values(draft.groups)) {
    // Dangling parent, or a parent chain that leads back here: top level.
    if (g.parentId && (!draft.groups[g.parentId] || groupChain(draft, g.parentId).includes(g.id))) {
      delete g.parentId;
    }
  }
  for (const [cid, c] of Object.entries(draft.connections)) {
    const alive = (ep: { kind: 'item' | 'group'; id: string }) =>
      ep.kind === 'item' ? ep.id in draft.items : ep.id in draft.groups;
    if (!alive(c.from) || !alive(c.to)) delete draft.connections[cid];
  }
  for (const [cmid, cm] of Object.entries(draft.comments)) {
    if (!(cm.itemId in draft.items)) delete draft.comments[cmid];
  }
}

/** Display identity for doc writes (comments, poll votes): live team peer,
 *  else account, else Me. */
export function currentAuthor(): { name: string; color?: string; userId?: string } {
  const { profile, account } = useSyncStore.getState();
  const self = useCollabStore.getState().self;
  if (self) {
    // Guests have no account; members attach their id for avatar lookups.
    return {
      name: self.name,
      color: self.color,
      ...(self.role !== 'guest' && account ? { userId: account.id } : {}),
    };
  }
  const name = profile?.name.trim() || account?.username;
  return name ? { name, ...(account ? { userId: account.id } : {}) } : { name: 'Me' };
}

/** Add a comment to an item. Returns the comment id (null if item missing). */
export function addComment(itemId: string, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !useDocumentStore.getState().doc.items[itemId]) return null;
  const id = newId();
  const author = currentAuthor();
  runCommand('Add comment', (draft) => {
    draft.comments[id] = {
      id,
      itemId,
      author: author.name,
      ...(author.color ? { color: author.color } : {}),
      ...(author.userId ? { userId: author.userId } : {}),
      text: trimmed.slice(0, 4000),
      createdAt: new Date().toISOString(),
    };
  });
  return id;
}

/**
 * Cast/toggle a vote. Single-choice polls replace the voter's pick (clicking
 * the same option retracts it); multi-choice polls toggle the option. Votes
 * are doc state, so they sync and mirror live into team rooms like any edit.
 */
export function votePoll(itemId: string, optionId: string): void {
  const author = currentAuthor();
  const voterKey = author.userId ?? author.name;
  runCommand('Vote', (draft) => {
    const item = draft.items[itemId];
    if (!item || item.type !== 'poll' || item.closed) return;
    if (!item.options.some((o) => o.id === optionId)) return;
    const existing = item.votes[voterKey];
    if (!existing) {
      item.votes[voterKey] = { name: author.name, optionIds: [optionId] };
      return;
    }
    existing.name = author.name; // keep the display name fresh
    if (item.multiple) {
      existing.optionIds = existing.optionIds.includes(optionId)
        ? existing.optionIds.filter((id) => id !== optionId)
        : [...existing.optionIds, optionId];
    } else {
      existing.optionIds = existing.optionIds.includes(optionId) ? [] : [optionId];
    }
    if (existing.optionIds.length === 0) delete item.votes[voterKey];
  });
}

export function setPollClosed(itemId: string, closed: boolean): void {
  runCommand(closed ? 'Close poll' : 'Reopen poll', (draft) => {
    const item = draft.items[itemId];
    if (item?.type === 'poll') item.closed = closed;
  });
}

/** The current user's picks on a poll (empty when they haven't voted). */
export function myPollVotes(item: { votes: Record<string, { optionIds: string[] }> }): string[] {
  const author = currentAuthor();
  return item.votes[author.userId ?? author.name]?.optionIds ?? [];
}

export function removeComment(id: string): void {
  if (!(id in useDocumentStore.getState().doc.comments)) return;
  runCommand('Delete comment', (draft) => {
    delete draft.comments[id];
  });
}

/** Connect two endpoints (item/group). No self-links, no duplicates. */
/** Set what a connection MEANS (typed connections). One undo step. */
export function setConnectionRel(id: string, rel: ConnectionRel): void {
  if (!(id in useDocumentStore.getState().doc.connections)) return;
  runCommand('Connection type', (draft) => {
    const c = draft.connections[id];
    if (c) c.rel = rel;
  });
}

/** Reverse a connection's direction (from ⇄ to). One undo step. */
export function swapConnection(id: string): void {
  if (!(id in useDocumentStore.getState().doc.connections)) return;
  runCommand('Reverse connection', (draft) => {
    const c = draft.connections[id];
    if (c) [c.from, c.to] = [c.to, c.from];
  });
}

/** Set/clear a connection's midpoint label. One undo step. */
export function setConnectionLabel(id: string, label: string): void {
  if (!(id in useDocumentStore.getState().doc.connections)) return;
  runCommand('Connection label', (draft) => {
    const c = draft.connections[id];
    if (!c) return;
    if (label.trim()) c.label = label.trim();
    else delete c.label;
  });
}

export function addConnection(
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  rel: ConnectionRel = 'relates',
): string | null {
  const { doc } = useDocumentStore.getState();
  if (from.kind === to.kind && from.id === to.id) return null;
  if (!endpointExists(doc, from) || !endpointExists(doc, to)) return null;
  if (connectionExists(doc, from, to)) return null;
  const id = newId();
  runCommand('Connect', (draft) => {
    draft.connections[id] = { id, from, to, rel };
  });
  return id;
}

export function removeConnection(id: string): void {
  if (!(id in useDocumentStore.getState().doc.connections)) return;
  runCommand('Delete connection', (draft) => {
    delete draft.connections[id];
  });
}

/**
 * Group 2+ items under a fresh group id (rule 3.2: grouping is just a shared
 * `groupId` field plus a record — no new item type). Returns the group id.
 */
export function groupItems(ids: string[], name?: string): string | null {
  const { doc } = useDocumentStore.getState();
  const live = ids.filter((id) => id in doc.items);
  if (live.length < 2) return null;
  const isolated = useSessionStore.getState().isolatedGroupId;
  const liveSet = new Set(live);
  // A group unit travels whole only when every member was asked for; a
  // subset (a tool or a shift-built selection) takes just those items out.
  const units = selectionUnits(
    doc,
    live,
    isolated && doc.groups[isolated] ? isolated : null,
  ).flatMap((unit): SelectionUnit[] => {
    if (unit.kind === 'item') return [unit];
    const members = groupMembers(doc, unit.id);
    return members.every((m) => liveSet.has(m))
      ? [unit]
      : members.filter((m) => liveSet.has(m)).map((m) => ({ kind: 'item' as const, id: m }));
  });
  if (units.length < 2) return null;
  // The new group nests where the user is editing: inside the isolated
  // group, or, for a subset pulled out of one group, inside that group.
  const parent =
    isolated && doc.groups[isolated]
      ? isolated
      : units.every((u) => u.kind === 'item') &&
          new Set(units.map((u) => doc.items[u.id]?.groupId ?? null)).size === 1
        ? (doc.items[units[0]!.id]?.groupId ?? null)
        : null;
  const groupId = newId();
  runCommand('Group', (draft) => {
    draft.groups[groupId] = {
      id: groupId,
      ...(name !== undefined ? { name } : {}),
      ...(parent ? { parentId: parent } : {}),
    };
    for (const unit of units) {
      if (unit.kind === 'group') {
        const g = draft.groups[unit.id];
        if (g) g.parentId = groupId;
      } else {
        const item = draft.items[unit.id];
        if (item) item.groupId = groupId;
      }
    }
    pruneEmptyGroups(draft);
  });
  return groupId;
}

/**
 * Combine selected swatches into ONE palette item — the same representation
 * extraction and harmonies produce, so every palette looks/behaves the same
 * however it was made. The source swatches are consumed; one undo step.
 */
export function createPaletteFromSwatches(ids: string[]): string | null {
  const { doc } = useDocumentStore.getState();
  const swatches = ids
    .map((id) => doc.items[id])
    .filter((i): i is SwatchItem => i?.type === 'swatch')
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (swatches.length < 2) return null;

  const left = Math.min(...swatches.map((s) => s.x));
  const top = Math.min(...swatches.map((s) => s.y));
  const colors: PaletteEntry[] = swatches.map((s) =>
    s.name !== undefined ? { color: s.color, name: s.name } : { color: s.color },
  );
  const paletteId = newId();
  const z = topZIndex(doc) + 1;
  runCommand('Create palette', (draft) => {
    for (const s of swatches) delete draft.items[s.id];
    draft.items[paletteId] = {
      id: paletteId,
      type: 'palette',
      x: left,
      y: top,
      width: Math.max(240, colors.length * 56),
      height: 72,
      rotation: 0,
      zIndex: z,
      locked: false,
      opacity: 1,
      groupId: null,
      colors,
      sourceAssetId: null,
    };
    pruneEmptyGroups(draft);
  });
  useSessionStore.getState().setSelection([paletteId]);
  return paletteId;
}

/** Rename a group (action bar / isolation banner / legacy swatch lightbox). */
export function renameGroup(groupId: string, name: string): void {
  if (!useDocumentStore.getState().doc.groups[groupId]) return;
  runCommand('Rename group', (draft) => {
    const group = draft.groups[groupId];
    if (!group) return;
    const trimmed = name.trim();
    if (trimmed) group.name = trimmed;
    else delete group.name;
  });
}

/** Set/clear a group's optional container background (and its opacity). */
export function updateGroupBackground(
  groupId: string,
  patch: {
    background?: string | null;
    backgroundOpacity?: number;
    backgroundImage?: BackgroundImage | null;
  },
): void {
  if (!useDocumentStore.getState().doc.groups[groupId]) return;
  runCommand('Group background', (draft) => {
    const group = draft.groups[groupId];
    if (!group) return;
    if (patch.background === null) {
      delete group.background;
      delete group.backgroundOpacity;
    } else {
      if (patch.background !== undefined) group.background = patch.background;
      if (patch.backgroundOpacity !== undefined) group.backgroundOpacity = patch.backgroundOpacity;
    }
    if (patch.backgroundImage === null) delete group.backgroundImage;
    else if (patch.backgroundImage !== undefined) group.backgroundImage = patch.backgroundImage;
  });
}

/** Ungroup: dissolve the groups the ids fully cover — the outermost such
 *  group of each chain, so a selected unit dissolves as one — or, when the
 *  ids cover no whole group (a single id from a tool), each item's innermost
 *  group. Direct items and subgroups move up to the dissolved group's parent. */
export function ungroupItems(ids: string[]): void {
  const { doc } = useDocumentStore.getState();
  const idSet = new Set(ids);
  const covered = Object.keys(doc.groups).filter((g) => {
    const members = groupMembers(doc, g);
    return members.length > 0 && members.every((m) => idSet.has(m));
  });
  let targets = covered.filter(
    (g) =>
      !groupChain(doc, g)
        .slice(1)
        .some((ancestor) => covered.includes(ancestor)),
  );
  if (targets.length === 0) {
    targets = [...new Set(ids.map((id) => doc.items[id]?.groupId).filter((g): g is string => !!g))];
  }
  if (targets.length === 0) return;
  runCommand('Ungroup', (draft) => {
    for (const gid of targets) {
      const parent = draft.groups[gid]?.parentId ?? null;
      for (const item of Object.values(draft.items)) {
        if (item.groupId === gid) item.groupId = parent;
      }
      for (const g of Object.values(draft.groups)) {
        if (g.parentId === gid) {
          if (parent) g.parentId = parent;
          else delete g.parentId;
        }
      }
      delete draft.groups[gid];
    }
  });
}

/** Geometry fields a transform gesture may change. */
export interface BoundsPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

/**
 * Apply final gesture geometry to many items at once. Used by move, resize,
 * rotate, and nudge — the per-frame visual feedback lives in session state;
 * this runs once on pointer-up.
 */
export function transformItems(overrides: Record<string, BoundsPatch>, label: string): void {
  const ids = Object.keys(overrides);
  if (ids.length === 0) return;
  runCommand(label, (draft) => {
    for (const id of ids) {
      const item = draft.items[id];
      const patch = overrides[id];
      if (!item || !patch) continue;
      if (patch.x !== undefined) item.x = patch.x;
      if (patch.y !== undefined) item.y = patch.y;
      if (patch.width !== undefined) item.width = patch.width;
      if (patch.height !== undefined) item.height = patch.height;
      if (patch.rotation !== undefined) item.rotation = patch.rotation;
    }
  });
}

export function moveItemsBy(ids: string[], dx: number, dy: number, label = 'Move'): void {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return;
  runCommand(label, (draft) => {
    for (const id of ids) {
      const item = draft.items[id];
      if (!item || item.locked) continue;
      item.x += dx;
      item.y += dy;
    }
  });
}

export type ZOrderMode = 'front' | 'back' | 'forward' | 'backward';

/**
 * Z-order commands. Items are ranked by (zIndex, id); after the operation all
 * items get contiguous zIndexes, which keeps future moves well-defined.
 */
export function reorderItems(ids: string[], mode: ZOrderMode): void {
  if (ids.length === 0) return;
  const labels: Record<ZOrderMode, string> = {
    front: 'Bring to front',
    back: 'Send to back',
    forward: 'Bring forward',
    backward: 'Send backward',
  };
  runCommand(labels[mode], (draft) => {
    const ordered = Object.values(draft.items)
      .sort((a, b) => a.zIndex - b.zIndex || (a.id < b.id ? -1 : 1))
      .map((item) => item.id);
    const moving = new Set(ids.filter((id) => id in draft.items));
    if (moving.size === 0) return;

    const rest = ordered.filter((id) => !moving.has(id));
    const movingOrdered = ordered.filter((id) => moving.has(id));
    let next: string[];

    if (mode === 'front') {
      next = [...rest, ...movingOrdered];
    } else if (mode === 'back') {
      next = [...movingOrdered, ...rest];
    } else {
      next = [...ordered];
      const step = mode === 'forward' ? 1 : -1;
      const indices = movingOrdered.map((id) => next.indexOf(id));
      // Walk from the edge being moved toward so adjacent selected items
      // don't leapfrog each other.
      const walk =
        mode === 'forward'
          ? [...indices].sort((a, b) => b - a)
          : [...indices].sort((a, b) => a - b);
      for (const i of walk) {
        const j = i + step;
        if (j < 0 || j >= next.length) continue;
        const a = next[i];
        const b = next[j];
        if (a === undefined || b === undefined || moving.has(b)) continue;
        next[i] = b;
        next[j] = a;
      }
    }

    // Pure no-op (e.g. "forward" on the topmost item) must not touch the doc,
    // or zIndex normalization alone would pollute history.
    if (next.every((id, i) => id === ordered[i])) return;

    next.forEach((id, z) => {
      const item = draft.items[id];
      if (item) item.zIndex = z;
    });
  });
}

/**
 * Set the absolute z-order from a complete bottom-to-top id list (the layers
 * panel computes it from a drag). Assigns contiguous zIndexes; one undo step.
 */
export function reorderZ(orderBottomToTop: string[]): void {
  if (orderBottomToTop.length === 0) return;
  runCommand('Reorder layers', (draft) => {
    orderBottomToTop.forEach((id, z) => {
      const item = draft.items[id];
      if (item) item.zIndex = z;
    });
  });
}

/** Clone items with fresh ids at a small offset; returns the new ids. */
export function duplicateItems(ids: string[], label = 'Duplicate', offset = 24): string[] {
  const { doc } = useDocumentStore.getState();
  const clones: Item[] = [];
  const idMap = new Map<string, string>();
  let z = topZIndex(doc) + 1;
  for (const id of ids) {
    const item = doc.items[id];
    if (!item) continue;
    const cloneId = newId();
    idMap.set(id, cloneId);
    clones.push({ ...item, id: cloneId, x: item.x + offset, y: item.y + offset, zIndex: z++ });
  }
  remapClonedTimelines(clones, idMap);
  remapClonedStoryboards(clones, idMap);
  addItems(clones, label);
  return clones.map((c) => c.id);
}

/**
 * Update arbitrary per-type item fields. The recipe receives each draft item;
 * narrowing on `item.type` inside the recipe keeps call sites type-safe.
 */
export function updateItems(ids: string[], label: string, recipe: (item: Item) => void): void {
  if (ids.length === 0) return;
  runCommand(label, (draft) => {
    for (const id of ids) {
      const item = draft.items[id];
      if (item) recipe(item);
    }
  });
}

export function setItemsLocked(ids: string[], locked: boolean): void {
  if (ids.length === 0) return;
  runCommand(locked ? 'Lock' : 'Unlock', (draft) => {
    for (const id of ids) {
      const item = draft.items[id];
      if (item) item.locked = locked;
    }
  });
  // Locked = view-only: a locked item never sits in the selection, so the
  // handles and the editing menu go away the moment the lock lands.
  if (locked) {
    const session = useSessionStore.getState();
    const rest = session.selection.filter((id) => !ids.includes(id));
    if (rest.length !== session.selection.length) session.setSelection(rest);
  }
}

/** Photoshop-style eye: hidden items skip every render surface. `hidden` is
 *  optional in the schema, so showing DELETES the key to keep docs clean. */
export function setItemsHidden(ids: string[], hidden: boolean): void {
  if (ids.length === 0) return;
  runCommand(hidden ? 'Hide' : 'Show', (draft) => {
    for (const id of ids) {
      const item = draft.items[id];
      if (!item) continue;
      if (hidden) item.hidden = true;
      else delete item.hidden;
    }
  });
  if (hidden) {
    const session = useSessionStore.getState();
    const remaining = session.selection.filter((id) => !ids.includes(id));
    if (remaining.length !== session.selection.length) session.setSelection(remaining);
  }
}

export function renameBoard(name: string): void {
  runCommand('Rename board', (draft) => {
    draft.name = name;
  });
}

/**
 * Update a video's volume/muted. These are playback preferences, not document
 * edits worth an undo step (a volume drag would otherwise flood history), so
 * they bypass the history manager — but still persist via autosave.
 */
export function setVideoAudio(
  id: string,
  patch: { volume?: number; muted?: boolean; playbackRate?: number },
): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const item = doc.items[id];
  if (!item || item.type !== 'video') return;
  const next = produce(doc, (draft) => {
    const it = draft.items[id];
    if (it?.type !== 'video') return;
    if (patch.volume !== undefined) it.volume = patch.volume;
    if (patch.muted !== undefined) it.muted = patch.muted;
    if (patch.playbackRate !== undefined) it.playbackRate = patch.playbackRate;
    draft.updatedAt = new Date().toISOString();
  });
  if (next !== doc) replaceDoc(next);
}

/** Live playback settings for an audio item (no undo step — like setVideoAudio). */
export function setAudioPlayback(
  id: string,
  patch: { volume?: number; muted?: boolean; loop?: boolean; playbackRate?: number },
): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const item = doc.items[id];
  if (!item || item.type !== 'audio') return;
  const next = produce(doc, (draft) => {
    const it = draft.items[id];
    if (it?.type !== 'audio') return;
    if (patch.volume !== undefined) it.volume = patch.volume;
    if (patch.muted !== undefined) it.muted = patch.muted;
    if (patch.loop !== undefined) it.loop = patch.loop;
    if (patch.playbackRate !== undefined) it.playbackRate = patch.playbackRate;
    draft.updatedAt = new Date().toISOString();
  });
  if (next !== doc) replaceDoc(next);
}

/** Live playlist state (track index / volume / mute / loop) — no undo step,
 *  like setAudioPlayback: switching tracks shouldn't flood history. */
export function setPlaylistPlayback(
  id: string,
  patch: { current?: number; volume?: number; muted?: boolean; loop?: boolean },
): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const item = doc.items[id];
  if (!item || item.type !== 'playlist') return;
  const next = produce(doc, (draft) => {
    const it = draft.items[id];
    if (it?.type !== 'playlist') return;
    if (patch.current !== undefined)
      it.current = Math.max(0, Math.min(it.tracks.length - 1, patch.current));
    if (patch.volume !== undefined) it.volume = patch.volume;
    if (patch.muted !== undefined) it.muted = patch.muted;
    if (patch.loop !== undefined) it.loop = patch.loop;
    draft.updatedAt = new Date().toISOString();
  });
  if (next !== doc) replaceDoc(next);
}

/**
 * Combine several file-backed audio items into ONE playlist player (one undo
 * step: originals removed, the playlist added where the top-left one sat).
 * Returns the new item id, or null when fewer than two audio items qualify.
 */
export function combineIntoPlaylist(ids: string[]): string | null {
  const { doc } = useDocumentStore.getState();
  const audios = ids
    .map((id) => doc.items[id])
    .filter((i): i is Extract<Item, { type: 'audio' }> => i?.type === 'audio' && !!i.assetId)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (audios.length < 2) return null;

  const x = Math.min(...audios.map((a) => a.x));
  const y = Math.min(...audios.map((a) => a.y));
  const width = 360;
  const height = Math.min(96 + audios.length * 34, 96 + 8 * 34);
  const playlist: Item = {
    id: newId(),
    type: 'playlist',
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    name: 'Playlist',
    tracks: audios.map((a) => ({
      assetId: a.assetId!,
      title: a.title ?? a.name ?? 'Audio',
      artist: a.artist,
      coverAssetId: a.coverAssetId,
    })),
    current: 0,
    volume: 1,
    muted: false,
    loop: false,
  };
  runCommand('Combine into playlist', (draft) => {
    for (const a of audios) delete draft.items[a.id];
    draft.items[playlist.id] = playlist;
    pruneEmptyGroups(draft);
  });
  useSessionStore.getState().setSelection([playlist.id]);
  return playlist.id;
}

/**
 * Store an iframe's server-rendered poster (no undo step — it's derived
 * metadata, not a user edit). `forUrl` guards against a late capture landing
 * after the user navigated the embed elsewhere.
 */
export function setIframePoster(id: string, posterAssetId: string, forUrl: string): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const item = doc.items[id];
  if (!item || item.type !== 'iframe' || item.url !== forUrl) return;
  const next = produce(doc, (draft) => {
    const it = draft.items[id];
    if (it?.type === 'iframe') it.posterAssetId = posterAssetId;
    draft.updatedAt = new Date().toISOString();
  });
  if (next !== doc) replaceDoc(next);
}

/** Like setIframePoster: a background snapshot lands outside undo history,
 *  and only if the map still matches the state it was rendered from. */
export function setMapPoster(id: string, posterAssetId: string, forKey: string): void {
  const { doc, replaceDoc } = useDocumentStore.getState();
  const item = doc.items[id];
  if (!item || item.type !== 'map' || mapPosterKey(item) !== forKey) return;
  const next = produce(doc, (draft) => {
    const it = draft.items[id];
    if (it?.type === 'map') it.posterAssetId = posterAssetId;
    draft.updatedAt = new Date().toISOString();
  });
  if (next !== doc) replaceDoc(next);
}
