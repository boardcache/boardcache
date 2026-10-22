import type { CanvasDocument, Item } from '@boardcache/schema';
import { withCarried } from './carried';
import { haptic } from '../iosNative';
import { AUDIO_MIN_HEIGHT } from '../media/audioActions';
import { isPanoImage } from '../media/pano';
import { clientToCanvas, clientToScreen } from './canvasDom';
import { canvasToScreen } from './coords';
import type { Point, Rect } from './coords';
import {
  aabbIntersectsRotatedRect,
  angleFromOrigin,
  computeResize,
  isCornerHandle,
  normalizeAngle,
  rectCenter,
  rotatedRectAABB,
  snapAngle,
  unionRects,
} from './geometry';
import type { ResizeHandle, RotatedRect } from './geometry';
import { produce } from 'immer';
import { expandToGroups, isInsideGroup, selectionUnits } from './grouping';
import { cropImageToBox } from '../media/imageActions';
import type { ConnectionEndpoint } from '@boardcache/schema';
import { addConnection, updateItems, transformItems } from '../../state/commands';
import { cardZoom, isZoomCard } from './cardZoom';
import {
  attachItemsToTimelinePoint,
  attachedPointOf,
  detachItems,
  outsideTimelineTerritory,
  reshelfTimelineById,
  shelfPositions,
  timelinePointAt,
  type TimelineTarget,
} from '../structure/timelineAttach';
import {
  attachItemsToTreeNode,
  attachedTreeNodeOf,
  detachFromTreeNodes,
  outsideTreeTerritory,
  treeNodeAt,
  updateTree as updateTreeCmd,
  type TreeTarget,
} from '../structure/treeAttach';
import { computeTreeLayout } from '../structure/treeLayout';
import {
  attachItemsToTierRow,
  attachedTierRowOf,
  detachFromTierRows,
  outsideTierTerritory,
  tierRowAt,
  updateTier,
  type TierTarget,
} from '../structure/tierAttach';
import {
  attachItemsToPanel,
  attachedPanelOf,
  detachFromPanels,
  outsideStoryboardTerritory,
  storyboardPanelAt,
  updateStoryboard,
  type StoryboardTarget,
} from '../structure/storyboardAttach';
import { useHistoryStore } from '../../state/history';
import type { BoundsPatch } from '../../state/commands';
import { runCommand } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Pointer gesture controllers. Each begin* call wires window-level
 * pointermove/pointerup listeners; per-frame feedback writes ONLY to
 * session state (gesture overrides / marquee), and exactly one document
 * command is issued on pointer-up (rule 3.4).
 */

const DRAG_THRESHOLD_PX = 3;
const MIN_ITEM_SIZE = 8;

/** Breathing room enforced between a dropped item and the group's members. */
const GROUP_JOIN_GAP = 16;

/**
 * Where dropped items should land inside a group: if they overlap (or crowd)
 * any member, slide them — as one unit — to the nearest clear spot beside a
 * member's edge. Returns per-item positions, or null when the drop point is
 * already clear.
 */
function resolveGroupPlacement(
  doc: Pick<CanvasDocument, 'items' | 'groups'>,
  ids: string[],
  groupId: string,
): Record<string, { x: number; y: number }> | null {
  const dropped = new Set(ids);
  const members = Object.values(doc.items).filter(
    (it) => isInsideGroup(doc, it, groupId) && !dropped.has(it.id),
  );
  const dragged = ids.map((id) => doc.items[id]).filter((it): it is Item => it !== undefined);
  if (members.length === 0 || dragged.length === 0) return null;

  // The dragged set moves as one unit, keyed by its union rect.
  const ux = Math.min(...dragged.map((d) => d.x));
  const uy = Math.min(...dragged.map((d) => d.y));
  const uw = Math.max(...dragged.map((d) => d.x + d.width)) - ux;
  const uh = Math.max(...dragged.map((d) => d.y + d.height)) - uy;

  const crowded = (x: number, y: number) =>
    members.some(
      (m) =>
        x < m.x + m.width + GROUP_JOIN_GAP &&
        m.x < x + uw + GROUP_JOIN_GAP &&
        y < m.y + m.height + GROUP_JOIN_GAP &&
        m.y < y + uh + GROUP_JOIN_GAP,
    );
  if (!crowded(ux, uy)) return null;

  // Candidate spots: beside each member's four edges, keeping the drop
  // point's other coordinate; nearest clear candidate wins.
  const candidates: { x: number; y: number }[] = [];
  for (const m of members) {
    candidates.push({ x: m.x + m.width + GROUP_JOIN_GAP, y: uy });
    candidates.push({ x: m.x - uw - GROUP_JOIN_GAP, y: uy });
    candidates.push({ x: ux, y: m.y + m.height + GROUP_JOIN_GAP });
    candidates.push({ x: ux, y: m.y - uh - GROUP_JOIN_GAP });
  }
  const clear = candidates.filter((c) => !crowded(c.x, c.y));
  const best = clear.length
    ? clear.reduce((a, b) =>
        Math.hypot(a.x - ux, a.y - uy) <= Math.hypot(b.x - ux, b.y - uy) ? a : b,
      )
    : // Fallback: right of the entire group can never collide.
      { x: Math.max(...members.map((m) => m.x + m.width)) + GROUP_JOIN_GAP, y: uy };

  const dx = best.x - ux;
  const dy = best.y - uy;
  return Object.fromEntries(dragged.map((d) => [d.id, { x: d.x + dx, y: d.y + dy }]));
}

function itemBounds(item: Item): RotatedRect {
  return { x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation };
}

/** Live bounds: base geometry ⊕ current gesture override. */
export function effectiveBounds(item: Item, override?: BoundsPatch): RotatedRect {
  if (!override) return itemBounds(item);
  return {
    x: override.x ?? item.x,
    y: override.y ?? item.y,
    width: override.width ?? item.width,
    height: override.height ?? item.height,
    rotation: override.rotation ?? item.rotation,
  };
}

function trackPointer(
  e: { pointerId: number },
  handlers: {
    onMove: (ev: PointerEvent) => void;
    onEnd: (ev: PointerEvent) => void;
  },
): void {
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId === e.pointerId) handlers.onMove(ev);
  };
  const finish = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    handlers.onEnd(ev);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export function beginMove(
  e: { pointerId: number; clientX: number; clientY: number },
  options: {
    collapseToId?: string;
    /** Drag ONLY this item (e.g. shift-dragging one member out of a group). */
    soloDragId?: string;
    /** Run instead of `collapseToId` when the gesture turns out to be a click. */
    onClick?: () => void;
  } = {},
): void {
  const { selection, setGesture, setSelection } = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();

  const ids = options.soloDragId ? [options.soloDragId] : selection;
  // Containers carry what is shelved on them, like groups carry members.
  const movable = withCarried(
    doc,
    ids.filter((id) => {
      const item = doc.items[id];
      return item !== undefined && !item.locked;
    }),
  );
  const draggingTimeline = movable.some((id) => doc.items[id]?.type === 'timeline');
  const draggingTier = movable.some((id) => doc.items[id]?.type === 'tierlist');
  const draggingStoryboard = movable.some((id) => doc.items[id]?.type === 'storyboard');
  const draggingTree = movable.some((id) => doc.items[id]?.type === 'tree');
  const startPositions = new Map(
    movable.map((id) => {
      const item = doc.items[id]!;
      return [id, { x: item.x, y: item.y }] as const;
    }),
  );
  const start = { x: e.clientX, y: e.clientY };
  let dragging = false;

  // Drag-into-group: hovering a group's bounds shows a hint immediately and
  // ARMS the group after a short hold (a real timer — no pointer movement
  // required); dropping while armed joins the dragged items to the group.
  const GROUP_HOLD_MS = 450;
  const draggedSet = new Set(movable);
  let hoverGid: string | null = null;
  let armed: string | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const groupUnderPoint = (canvasPt: { x: number; y: number }): string | null => {
    const doc = useDocumentStore.getState().doc;
    // Never offer groups the dragged items already fully belong to.
    for (const gid of Object.keys(doc.groups)) {
      const members = Object.values(doc.items).filter(
        (it) => isInsideGroup(doc, it, gid) && !draggedSet.has(it.id),
      );
      if (members.length === 0) continue;
      if (movable.every((id) => doc.items[id] && isInsideGroup(doc, doc.items[id]!, gid))) continue;
      const pad = 16;
      const minX = Math.min(...members.map((m) => m.x)) - pad;
      const minY = Math.min(...members.map((m) => m.y)) - pad;
      const maxX = Math.max(...members.map((m) => m.x + m.width)) + pad;
      const maxY = Math.max(...members.map((m) => m.y + m.height)) + pad;
      if (canvasPt.x >= minX && canvasPt.x <= maxX && canvasPt.y >= minY && canvasPt.y <= maxY) {
        return gid;
      }
    }
    return null;
  };

  // The visual center of the dragged items at their CURRENT (override) spot —
  // "the item is over the group" reads truer than the grab point alone.
  const draggedCenter = (dx: number, dy: number): { x: number; y: number } | null => {
    const doc = useDocumentStore.getState().doc;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, p] of startPositions) {
      const item = doc.items[id];
      if (!item) continue;
      minX = Math.min(minX, p.x + dx);
      minY = Math.min(minY, p.y + dy);
      maxX = Math.max(maxX, p.x + dx + item.width);
      maxY = Math.max(maxY, p.y + dy + item.height);
    }
    return minX === Infinity ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  };

  const setHover = (gid: string | null) => {
    if (gid === hoverGid) return;
    hoverGid = gid;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
    if (armed) {
      armed = null;
      useSessionStore.getState().setGroupDropArmed(null);
    }
    useSessionStore.getState().setGroupDropHover(gid);
    if (gid) {
      armTimer = setTimeout(() => {
        armed = gid;
        useSessionStore.getState().setGroupDropArmed(gid);
      }, GROUP_HOLD_MS);
    }
  };

  const updateHover = (ev: { clientX: number; clientY: number }, dx: number, dy: number) => {
    const cursor = groupUnderPoint(clientToCanvas(ev.clientX, ev.clientY));
    const center = cursor ? null : draggedCenter(dx, dy);
    setHover(cursor ?? (center ? groupUnderPoint(center) : null));
  };

  // Timeline point drop targets: cursor-based (small, explicit zones — no
  // arm delay needed). Never while a timeline itself is being dragged.
  let tlHover: TimelineTarget | null = null;
  let trHover: TierTarget | null = null;
  let sbHover: StoryboardTarget | null = null;
  let treeHover: TreeTarget | null = null;
  const updateTreeHover = (ev: { clientX: number; clientY: number }) => {
    const next = draggingTree
      ? null
      : treeNodeAt(
          useDocumentStore.getState().doc,
          clientToCanvas(ev.clientX, ev.clientY),
          draggedSet,
        );
    if (next?.itemId === treeHover?.itemId && next?.nodeId === treeHover?.nodeId) return;
    treeHover = next;
    useSessionStore.getState().setTreeDropHover(next);
  };
  const updateTrHover = (ev: { clientX: number; clientY: number }) => {
    const next = draggingTier
      ? null
      : tierRowAt(
          useDocumentStore.getState().doc,
          clientToCanvas(ev.clientX, ev.clientY),
          draggedSet,
        );
    if (next?.itemId === trHover?.itemId && next?.rowId === trHover?.rowId) return;
    trHover = next;
    useSessionStore.getState().setTierDropHover(next);
  };
  const updateSbHover = (ev: { clientX: number; clientY: number }) => {
    const next = draggingStoryboard
      ? null
      : storyboardPanelAt(
          useDocumentStore.getState().doc,
          clientToCanvas(ev.clientX, ev.clientY),
          draggedSet,
        );
    if (next?.itemId === sbHover?.itemId && next?.panelId === sbHover?.panelId) return;
    sbHover = next;
    useSessionStore.getState().setSbDropHover(next);
  };
  const updateTlHover = (ev: { clientX: number; clientY: number }) => {
    const next = draggingTimeline
      ? null
      : timelinePointAt(
          useDocumentStore.getState().doc,
          clientToCanvas(ev.clientX, ev.clientY),
          draggedSet,
        );
    if (next?.itemId === tlHover?.itemId && next?.pointId === tlHover?.pointId) return;
    tlHover = next;
    useSessionStore.getState().setTimelineDropHover(next);
  };

  trackPointer(e, {
    onMove: (ev) => {
      const dxScreen = ev.clientX - start.x;
      const dyScreen = ev.clientY - start.y;
      if (!dragging && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
      if (movable.length === 0) return;
      if (!dragging && options.soloDragId) setSelection([options.soloDragId]);
      dragging = true;
      const { scale } = useDocumentStore.getState().doc.viewport;
      const dx = dxScreen / scale;
      const dy = dyScreen / scale;
      const overrides: Record<string, BoundsPatch> = {};
      for (const [id, p] of startPositions) overrides[id] = { x: p.x + dx, y: p.y + dy };
      setGesture({ kind: 'move', overrides });
      updateHover(ev, dx, dy);
      updateTlHover(ev);
      updateTrHover(ev);
      updateSbHover(ev);
      updateTreeHover(ev);
    },
    onEnd: () => {
      const gesture = useSessionStore.getState().gesture;
      if (armTimer) clearTimeout(armTimer);
      // The hover tracker already reflects the final pointer position.
      const dropInto = dragging && armed && hoverGid === armed ? armed : null;
      if (dragging && gesture) {
        const before = useHistoryStore.getState().index;
        transformItems(gesture.overrides, 'Move');
        haptic(dropInto ? 'medium' : 'light');
        if (dropInto) {
          // Tidy the landing: if the dropped items sit on a member, nudge
          // them (as one unit) to the nearest clear spot in the group.
          const docNow = useDocumentStore.getState().doc;
          const placed = resolveGroupPlacement(docNow, movable, dropInto);
          // Whole dragged groups nest inside the target; loose items join it.
          const units = selectionUnits(docNow, movable, useSessionStore.getState().isolatedGroupId);
          runCommand('Add to group', (draft) => {
            for (const unit of units) {
              if (unit.kind === 'group') {
                const g = draft.groups[unit.id];
                if (g && unit.id !== dropInto) g.parentId = dropInto;
              } else {
                const it = draft.items[unit.id];
                if (it) it.groupId = dropInto;
              }
            }
            for (const id of movable) {
              const it = draft.items[id];
              const p = placed?.[id];
              if (it && p) {
                it.x = p.x;
                it.y = p.y;
              }
            }
          });
          useHistoryStore.getState().coalesceSince(before, 'Add to group');
        } else if (tlHover) {
          attachItemsToTimelinePoint(movable, tlHover);
          useHistoryStore.getState().coalesceSince(before, 'Attach to timeline');
        } else if (sbHover) {
          attachItemsToPanel(movable, sbHover);
          useHistoryStore.getState().coalesceSince(before, 'Frame in storyboard');
        } else if (trHover) {
          attachItemsToTierRow(movable, trHover);
          useHistoryStore.getState().coalesceSince(before, 'Rank on tier list');
        } else if (treeHover) {
          attachItemsToTreeNode(movable, treeHover);
          useHistoryStore.getState().coalesceSince(before, 'Attach to tree');
        } else if (!draggingTimeline) {
          // Dropped nowhere near a point: attached items that left their
          // timeline's territory detach; nearby drops keep membership (that
          // IS the free-arrange escape hatch).
          const docNow = useDocumentStore.getState().doc;
          const strays = movable.filter((id) => {
            const attachment = attachedPointOf(docNow, id);
            if (!attachment) return false;
            const timeline = docNow.items[attachment.itemId];
            const item = docNow.items[id];
            if (!item) return false;
            return timeline?.type !== 'timeline' || outsideTimelineTerritory(item, timeline);
          });
          if (strays.length > 0) {
            detachItems(strays);
            useHistoryStore.getState().coalesceSince(before, 'Move');
          }
          // Tree attachments that left their card's territory detach.
          if (!draggingTree) {
            const treeStrays = movable.filter((id) => {
              const attachment = attachedTreeNodeOf(docNow, id);
              if (!attachment) return false;
              const tree = docNow.items[attachment.itemId];
              const item = docNow.items[id];
              if (!item) return false;
              return tree?.type !== 'tree' || outsideTreeTerritory(item, tree);
            });
            if (treeStrays.length > 0) {
              detachFromTreeNodes(treeStrays);
              useHistoryStore.getState().coalesceSince(before, 'Move');
            }
          }
          // Ranked tier items that left their card's territory un-rank.
          if (!draggingTier) {
            const tierStrays = movable.filter((id) => {
              const attachment = attachedTierRowOf(docNow, id);
              if (!attachment) return false;
              const tier = docNow.items[attachment.itemId];
              const item = docNow.items[id];
              if (!item) return false;
              return tier?.type !== 'tierlist' || outsideTierTerritory(item, tier);
            });
            if (tierStrays.length > 0) {
              detachFromTierRows(tierStrays);
              useHistoryStore.getState().coalesceSince(before, 'Move');
            }
          }
          if (!draggingStoryboard) {
            const sbStrays = movable.filter((id) => {
              const attachment = attachedPanelOf(docNow, id);
              if (!attachment) return false;
              const sb = docNow.items[attachment.itemId];
              const item = docNow.items[id];
              if (!item) return false;
              return sb?.type !== 'storyboard' || outsideStoryboardTerritory(item, sb);
            });
            if (sbStrays.length > 0) {
              detachFromPanels(sbStrays);
              useHistoryStore.getState().coalesceSince(before, 'Move');
            }
          }
        }
      } else if (!dragging) {
        // A click, not a drag: run the caller's intent.
        if (options.onClick) options.onClick();
        else if (options.collapseToId) setSelection([options.collapseToId]);
      }
      if (armed) useSessionStore.getState().setGroupDropArmed(null);
      if (hoverGid) useSessionStore.getState().setGroupDropHover(null);
      if (tlHover) useSessionStore.getState().setTimelineDropHover(null);
      if (trHover) useSessionStore.getState().setTierDropHover(null);
      if (sbHover) useSessionStore.getState().setSbDropHover(null);
      if (treeHover) useSessionStore.getState().setTreeDropHover(null);
      setGesture(null);
    },
  });
}

// ---------------------------------------------------------------------------
// Resize (single item)
// ---------------------------------------------------------------------------

/**
 * Zoomed cards (Task List, Project, Case, Link button, Storyboard) keep an explicit content zoom: a uniform
 * scale multiplies it by the width factor; an edge drag leaves it alone (the
 * box just changes). Either way the value is materialised so a card saved
 * before `zoom` existed stops deriving it from its width. Coalesced into the
 * transform's own undo entry.
 */
function rezoomCards(
  prev: Map<string, Item | undefined>,
  uniform: boolean,
  label: string,
  historyBefore: number,
): void {
  const doc = useDocumentStore.getState().doc;
  const zooms = new Map<string, number>();
  const storyboards: string[] = [];
  for (const [id, was] of prev) {
    const now = doc.items[id];
    if (!isZoomCard(was) || !isZoomCard(now)) continue;
    if (now.type === 'storyboard') storyboards.push(id);
    const z = cardZoom(was) * (uniform && was.width > 0 ? now.width / was.width : 1);
    if (now.zoom !== undefined && Math.abs(z - now.zoom) < 1e-6) continue;
    zooms.set(id, z);
  }
  if (zooms.size > 0) {
    updateItems([...zooms.keys()], label, (d) => {
      const z = zooms.get(d.id);
      if (z !== undefined && isZoomCard(d)) d.zoom = z;
    });
  }
  // Storyboards: framed items refit to the new panel boxes.
  for (const id of storyboards) updateStoryboard(id, label, () => {});
  if (zooms.size > 0 || storyboards.length > 0)
    useHistoryStore.getState().coalesceSince(historyBefore, label);
}

export function beginResize(
  e: { pointerId: number; clientX: number; clientY: number },
  itemId: string,
  handle: ResizeHandle,
): void {
  const { doc } = useDocumentStore.getState();
  const item = doc.items[itemId];
  if (!item || item.locked) return;
  const start = itemBounds(item);
  const { setGesture } = useSessionStore.getState();

  trackPointer(e, {
    onMove: (ev) => {
      const pointer = clientToCanvas(ev.clientX, ev.clientY);
      const next = computeResize(start, handle, pointer, {
        // Corners keep aspect ratio (Shift to free-transform), except types
        // whose content reflows freely (text, audio, RSS readers).
        proportional:
          item.type !== 'text' &&
          item.type !== 'code' &&
          item.type !== 'audio' &&
          item.type !== 'rss' &&
          item.type !== 'time' &&
          item.type !== 'map' &&
          item.type !== 'recipe' &&
          item.type !== 'poll' &&
          item.type !== 'timeline' &&
          item.type !== 'tierlist' &&
          item.type !== 'epub' &&
          item.type !== 'title' &&
          // Panoramas are a window into the scene — the frame is free.
          !(item.type === 'image' && isPanoImage(item)) &&
          isCornerHandle(handle) &&
          !ev.shiftKey,
        fromCenter: ev.altKey,
        minSize: MIN_ITEM_SIZE,
        // Audio can't shrink below the player's content height.
        ...(item.type === 'audio' ? { minHeight: () => AUDIO_MIN_HEIGHT } : {}),
      });
      const overrides: Record<string, BoundsPatch> = {
        [itemId]: { x: next.x, y: next.y, width: next.width, height: next.height },
      };
      // Trees: the WHOLE map scales live with the drag — attached items get
      // scaled position/size overrides; the chrome reads the override too.
      if (item.type === 'tree') {
        const docNow = useDocumentStore.getState().doc;
        const layout = computeTreeLayout(item, docNow.items);
        const k = next.width / Math.max(1, layout.width);
        for (const node of item.nodes) {
          const box = layout.boxes.get(node.id);
          const shelf = layout.shelves.get(node.id);
          if (!box || !shelf) continue;
          for (const id of node.itemIds) {
            const off = shelf[id];
            if (!off || !docNow.items[id]) continue;
            overrides[id] = {
              x: next.x + (box.shelfX + off.dx) * k,
              y: next.y + (box.shelfY + off.dy) * k,
              width: off.w * k,
              height: off.h * k,
            };
          }
        }
      }
      // Timelines: shelves track the stretch LIVE, not just on release.
      if (item.type === 'timeline') {
        const docNow = useDocumentStore.getState().doc;
        const shim = { ...item, ...next };
        for (const point of item.points) {
          if (point.freeArrange) continue;
          const members = point.itemIds
            .map((id) => docNow.items[id])
            .filter((m): m is Item => m !== undefined);
          if (members.length === 0) continue;
          const positions = shelfPositions(shim, point.id, members, docNow.items);
          for (const member of members) {
            const p = positions[member.id];
            if (p) overrides[member.id] = { x: p.x, y: p.y };
          }
        }
      }
      setGesture({ kind: 'resize', overrides, uniform: isCornerHandle(handle) });
    },
    onEnd: () => {
      const gesture = useSessionStore.getState().gesture;
      if (gesture) {
        const before = useHistoryStore.getState().index;
        const prev = new Map([[itemId, useDocumentStore.getState().doc.items[itemId]]]);
        transformItems(gesture.overrides, 'Resize');
        rezoomCards(prev, isCornerHandle(handle), 'Resize', before);
        // Stretching a timeline respaces its points — reflow the shelves
        // with it (one undo entry with the resize).
        const resized = useDocumentStore.getState().doc.items[itemId];
        if (resized?.type === 'timeline') {
          reshelfTimelineById(itemId);
          useHistoryStore.getState().coalesceSince(before, 'Resize');
        }
        // Tier cards: snap ranked items back onto the resized shelves.
        if (resized?.type === 'tierlist') {
          updateTier(itemId, 'Resize', () => {});
          useHistoryStore.getState().coalesceSince(before, 'Resize');
        }
        // Trees: resize = uniform SCALE of the whole map (attachments too).
        if (resized?.type === 'tree') {
          updateTreeCmd(itemId, 'Resize', () => {});
          useHistoryStore.getState().coalesceSince(before, 'Resize');
        }
        // A manual resize sets the box size, so stop auto-fitting text to its
        // content (the content scrolls instead).
        const fresh = useDocumentStore.getState();
        const it = fresh.doc.items[itemId];
        if (it?.type === 'text' && it.autoHeight) {
          fresh.replaceDoc(
            produce(fresh.doc, (d) => {
              const t = d.items[itemId];
              if (t?.type === 'text') t.autoHeight = false;
            }),
          );
        }
      }
      setGesture(null);
    },
  });
}

// ---------------------------------------------------------------------------
// Line / arrow endpoint drag
// ---------------------------------------------------------------------------

/**
 * Drag one end of a line/arrow. Its endpoints ARE two opposite corners of the
 * box (which corners depends on `flipDiagonal`), so we reuse computeResize: the
 * opposite corner stays anchored and the dragged end follows the pointer. Free
 * (non-proportional) and near-zero min so the segment can be any angle/length.
 */
export function beginLineEndpoint(
  e: { pointerId: number; clientX: number; clientY: number },
  itemId: string,
  end: 'a' | 'b',
): void {
  const { doc } = useDocumentStore.getState();
  const item = doc.items[itemId];
  if (!item || item.locked || item.type !== 'shape') return;
  // a = nw/sw, b = se/ne, per the diagonal.
  const handle: ResizeHandle = item.flipDiagonal
    ? end === 'a'
      ? 'sw'
      : 'ne'
    : end === 'a'
      ? 'nw'
      : 'se';
  const start = itemBounds(item);
  const { setGesture } = useSessionStore.getState();

  trackPointer(e, {
    onMove: (ev) => {
      const pointer = clientToCanvas(ev.clientX, ev.clientY);
      const next = computeResize(start, handle, pointer, {
        proportional: false,
        fromCenter: false,
        minSize: 1,
      });
      setGesture({
        kind: 'resize',
        overrides: {
          [itemId]: { x: next.x, y: next.y, width: next.width, height: next.height },
        },
      });
    },
    onEnd: () => {
      const gesture = useSessionStore.getState().gesture;
      if (gesture) transformItems(gesture.overrides, 'Move endpoint');
      setGesture(null);
    },
  });
}

// ---------------------------------------------------------------------------
// Uniform scale (multi selection)
// ---------------------------------------------------------------------------

export function beginMultiScale(
  e: { pointerId: number; clientX: number; clientY: number },
  handle: Extract<ResizeHandle, 'nw' | 'ne' | 'se' | 'sw'>,
): void {
  const { selection, setGesture } = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();
  const items = selection
    .map((id) => doc.items[id])
    .filter((item): item is Item => item !== undefined && !item.locked);
  if (items.length === 0) return;

  const bounds = unionRects(items.map((item) => rotatedRectAABB(itemBounds(item))));
  if (!bounds) return;
  const anchor: Point = {
    x: handle.includes('w') ? bounds.x + bounds.width : bounds.x,
    y: handle.includes('n') ? bounds.y + bounds.height : bounds.y,
  };
  const startPointer = clientToCanvas(e.clientX, e.clientY);
  const startDist = Math.hypot(startPointer.x - anchor.x, startPointer.y - anchor.y);
  if (startDist === 0) return;
  const largest = Math.max(...items.map((i) => Math.max(i.width, i.height)));
  const minScale = Math.max(0.02, MIN_ITEM_SIZE / largest);
  const snapshot = items.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  }));

  trackPointer(e, {
    onMove: (ev) => {
      const pointer = clientToCanvas(ev.clientX, ev.clientY);
      const dist = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
      const scale = Math.max(minScale, dist / startDist);
      const overrides: Record<string, BoundsPatch> = {};
      for (const s of snapshot) {
        overrides[s.id] = {
          x: anchor.x + (s.x - anchor.x) * scale,
          y: anchor.y + (s.y - anchor.y) * scale,
          width: s.width * scale,
          height: s.height * scale,
        };
      }
      setGesture({ kind: 'resize', overrides });
    },
    onEnd: () => {
      const gesture = useSessionStore.getState().gesture;
      if (gesture) {
        const before = useHistoryStore.getState().index;
        const doc = useDocumentStore.getState().doc;
        const prev = new Map(
          Object.keys(gesture.overrides).map((id) => [id, doc.items[id]] as const),
        );
        transformItems(gesture.overrides, 'Scale');
        rezoomCards(prev, true, 'Scale', before);
      }
      setGesture(null);
    },
  });
}

// ---------------------------------------------------------------------------
// Mobile dimension locks: the whole screen is the manipulation surface —
// dragging anywhere scales/rotates the selection about its center, so
// precision doesn't depend on hitting a small handle with a finger.
// ---------------------------------------------------------------------------

export function beginLockedScale(e: { pointerId: number; clientX: number; clientY: number }): void {
  const { selection, setGesture } = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();
  const items = selection
    .map((id) => doc.items[id])
    .filter((item): item is Item => item !== undefined && !item.locked);
  if (items.length === 0) return;
  const bounds = unionRects(items.map((item) => rotatedRectAABB(itemBounds(item))));
  if (!bounds) return;
  const center: Point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const startPointer = clientToCanvas(e.clientX, e.clientY);
  const startDist = Math.hypot(startPointer.x - center.x, startPointer.y - center.y);
  if (startDist < 4) return; // touching the exact center gives no direction
  const largest = Math.max(...items.map((i) => Math.max(i.width, i.height)));
  const minScale = Math.max(0.02, MIN_ITEM_SIZE / largest);
  const snapshot = items.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  }));

  trackPointer(e, {
    onMove: (ev) => {
      const pointer = clientToCanvas(ev.clientX, ev.clientY);
      const dist = Math.hypot(pointer.x - center.x, pointer.y - center.y);
      const scale = Math.min(20, Math.max(minScale, dist / startDist));
      const overrides: Record<string, BoundsPatch> = {};
      for (const snap of snapshot) {
        overrides[snap.id] = {
          x: center.x + (snap.x - center.x) * scale,
          y: center.y + (snap.y - center.y) * scale,
          width: snap.width * scale,
          height: snap.height * scale,
        };
      }
      setGesture({ kind: 'resize', overrides });
    },
    onEnd: () => {
      const gesture = useSessionStore.getState().gesture;
      if (gesture) {
        const before = useHistoryStore.getState().index;
        const doc = useDocumentStore.getState().doc;
        const prev = new Map(
          Object.keys(gesture.overrides).map((id) => [id, doc.items[id]] as const),
        );
        transformItems(gesture.overrides, 'Scale');
        rezoomCards(prev, true, 'Scale', before);
      }
      setGesture(null);
    },
  });
}

/** Rotate lock: single-item only (the bar disables it otherwise). */
export function beginLockedRotate(e: {
  pointerId: number;
  clientX: number;
  clientY: number;
}): void {
  const { selection } = useSessionStore.getState();
  if (selection.length !== 1) return;
  beginRotate(e, selection[0]!);
}

// ---------------------------------------------------------------------------
// Rotate (single item)
// ---------------------------------------------------------------------------

export function beginRotate(
  e: { pointerId: number; clientX: number; clientY: number },
  itemId: string,
): void {
  const { doc } = useDocumentStore.getState();
  const item = doc.items[itemId];
  if (!item || item.locked) return;
  const centerScreen = canvasToScreen(rectCenter(itemBounds(item)), doc.viewport);
  const startAngle = angleFromOrigin(centerScreen, clientToScreen(e.clientX, e.clientY));
  const startRotation = item.rotation;
  const { setGesture } = useSessionStore.getState();
  let lastSnapped = Number.NaN;

  trackPointer(e, {
    onMove: (ev) => {
      const angle = angleFromOrigin(centerScreen, clientToScreen(ev.clientX, ev.clientY));
      let rotation = startRotation + (angle - startAngle);
      if (ev.shiftKey || ev.pointerType === 'touch') {
        rotation = snapAngle(rotation, 15);
        // Haptic tick each time the snap lands on a new angle (touch only).
        if (ev.pointerType === 'touch' && rotation !== lastSnapped) {
          lastSnapped = rotation;
          navigator.vibrate?.(5);
        }
      }
      setGesture({
        kind: 'rotate',
        overrides: { [itemId]: { rotation: normalizeAngle(rotation) } },
      });
    },
    onEnd: () => {
      const gesture = useSessionStore.getState().gesture;
      if (gesture) transformItems(gesture.overrides, 'Rotate');
      setGesture(null);
    },
  });
}

// ---------------------------------------------------------------------------
// Crop (drag a box over an image while holding "c")
// ---------------------------------------------------------------------------

export function beginCrop(
  e: { pointerId: number; clientX: number; clientY: number },
  itemId: string,
): void {
  const { setCropBox } = useSessionStore.getState();
  const start = clientToCanvas(e.clientX, e.clientY);
  const startScreen = { x: e.clientX, y: e.clientY };
  let lastScreen = startScreen;
  let dragging = false;
  let box: Rect | null = null;

  trackPointer(e, {
    onMove: (ev) => {
      if (
        !dragging &&
        Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < DRAG_THRESHOLD_PX
      ) {
        lastScreen = { x: ev.clientX, y: ev.clientY };
        return;
      }
      dragging = true;
      const current = clientToCanvas(ev.clientX, ev.clientY);
      // Space held mid-draw → reposition the box at its current size
      // (Photoshop-style): the anchor corner rides along with the pointer,
      // so the pointer→anchor span — and thus the size — stays constant.
      if (useSessionStore.getState().spaceHeld && box) {
        const prev = clientToCanvas(lastScreen.x, lastScreen.y);
        start.x += current.x - prev.x;
        start.y += current.y - prev.y;
      }
      lastScreen = { x: ev.clientX, y: ev.clientY };
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      let w = Math.abs(dx);
      let h = Math.abs(dy);
      // Shift constrains the crop box to a square (sized to the larger edge).
      if (ev.shiftKey) w = h = Math.max(w, h);
      box = {
        x: dx < 0 ? start.x - w : start.x,
        y: dy < 0 ? start.y - h : start.y,
        width: w,
        height: h,
      };
      setCropBox(box);
    },
    onEnd: () => {
      setCropBox(null);
      if (dragging && box) {
        cropImageToBox(
          itemId,
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
        );
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Marquee selection
// ---------------------------------------------------------------------------

/**
 * Drag a connector from an endpoint's connect handle. A dashed draft line
 * follows the cursor; releasing over another item/group creates the
 * connection (releasing on nothing cancels).
 */
export function beginConnect(
  e: { pointerId: number; clientX: number; clientY: number },
  from: ConnectionEndpoint,
): void {
  const start = clientToCanvas(e.clientX, e.clientY);

  const targetAt = (pt: Point): ConnectionEndpoint | null => {
    const doc = useDocumentStore.getState().doc;
    // Topmost item under the point wins (skip the source itself).
    const hit = Object.values(doc.items)
      .filter(
        (it) => pt.x >= it.x && pt.x <= it.x + it.width && pt.y >= it.y && pt.y <= it.y + it.height,
      )
      .sort((a, b) => b.zIndex - a.zIndex)[0];
    if (hit) {
      if (from.kind === 'item' && hit.id === from.id) return null;
      // Linking a group to its own member is meaningless — skip.
      if (from.kind === 'group' && hit.groupId === from.id) return null;
      return { kind: 'item', id: hit.id };
    }
    // No item — try group footprints (their union AABB + backdrop padding).
    for (const gid of Object.keys(doc.groups)) {
      if (from.kind === 'group' && gid === from.id) continue;
      if (from.kind === 'item' && doc.items[from.id]?.groupId === gid) continue;
      const members = Object.values(doc.items).filter((it) => it.groupId === gid);
      if (members.length === 0) continue;
      const pad = 16;
      const minX = Math.min(...members.map((m) => m.x)) - pad;
      const minY = Math.min(...members.map((m) => m.y)) - pad;
      const maxX = Math.max(...members.map((m) => m.x + m.width)) + pad;
      const maxY = Math.max(...members.map((m) => m.y + m.height)) + pad;
      if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
        return { kind: 'group', id: gid };
      }
    }
    return null;
  };

  useSessionStore.getState().setConnectDraft({ from, x: start.x, y: start.y, target: null });
  trackPointer(e, {
    onMove: (ev) => {
      const pt = clientToCanvas(ev.clientX, ev.clientY);
      useSessionStore.getState().setConnectDraft({ from, x: pt.x, y: pt.y, target: targetAt(pt) });
    },
    onEnd: () => {
      const draft = useSessionStore.getState().connectDraft;
      useSessionStore.getState().setConnectDraft(null);
      if (draft?.target) {
        const id = addConnection(draft.from, draft.target);
        if (id) useSessionStore.getState().setSelectedConnection(id);
      }
    },
  });
}

export function beginMarquee(
  e: { pointerId: number; clientX: number; clientY: number },
  additive: boolean,
): void {
  const { selection, setSelection, setMarquee, clearSelection } = useSessionStore.getState();
  useSessionStore.getState().setSelectedConnection(null);
  const base = additive ? [...selection] : [];
  const start = clientToCanvas(e.clientX, e.clientY);
  let dragging = false;
  const startScreen = { x: e.clientX, y: e.clientY };

  trackPointer(e, {
    onMove: (ev) => {
      if (
        !dragging &&
        Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      dragging = true;
      const current = clientToCanvas(ev.clientX, ev.clientY);
      const rect: Rect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      };
      setMarquee(rect);

      const { doc } = useDocumentStore.getState();
      const hits: string[] = [];
      for (const item of Object.values(doc.items)) {
        if (item.locked || item.hidden) continue;
        if (aabbIntersectsRotatedRect(rect, itemBounds(item))) hits.push(item.id);
      }
      let merged = additive ? [...base, ...hits.filter((id) => !base.includes(id))] : hits;
      const iso = useSessionStore.getState().isolatedGroupId;
      if (iso) {
        // Isolation: only what sits inside the isolated group, as the units
        // at that level (its direct items, its subgroups as wholes).
        merged = merged.filter((id) => {
          const it = doc.items[id];
          return it ? isInsideGroup(doc, it, iso) : false;
        });
        setSelection(expandToGroups(doc, merged, iso));
      } else {
        // Touching any grouped item pulls in the whole group.
        setSelection(expandToGroups(doc, merged));
      }
    },
    onEnd: () => {
      setMarquee(null);
      if (!dragging && !additive) {
        clearSelection();
        // Auto-hide chrome (Appearance): a clean blank-canvas click toggles
        // the controls' visibility.
        const session = useSessionStore.getState();
        if (session.autoHideChrome) session.setChromeHidden(!session.chromeHidden);
      }
    },
  });
}
