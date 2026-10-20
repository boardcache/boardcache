import { memo } from 'react';
import { canvasReadOnly, useCanvasReadOnly } from '../../lib/canvas/readOnly';
import type { Item } from '@boardcache/schema';
import { rasterizeRotation } from '../../lib/media/imageActions';
import { duplicateItems } from '../../state/commands';
import { beginCrop, effectiveBounds, beginMove } from '../../lib/canvas/gestures';
import { editItem } from '../../lib/itemEditors';
import { isMobileViewport } from '../../lib/mobile';
import { VIEWER } from '../../lib/viewerMode';
import { useDocumentStore } from '../../state/documentStore';
import { statusMeta } from '../../lib/text/evidenceStatus';
import { weightLabel } from '../../lib/text/evidenceWeight';
import { useSessionStore } from '../../state/sessionStore';
import { useCollabStore } from '../../state/collabStore';
import { expandToGroups, selectionUnit, isInsideGroup } from '../../lib/canvas/grouping';
import { effectiveUrl, openUrl } from '../../lib/text/itemUrl';
import { ChatIcon, LinkIcon } from '../icons';
import { presentZoomToggle } from '../../lib/canvas/presentation';
import { openLightbox } from '../lightbox/Lightbox';
import { viewItem } from './viewItem';
import { itemType } from '../../itemTypes';

/** Project cards open the full-screen Projects view rather than the lightbox. */
const openProject = (projectId: string) =>
  window.dispatchEvent(new CustomEvent('boardcache:open-projects', { detail: { projectId } }));

/** Last touch tap on an item (edit mode) — double-tap opens. Module-level:
 *  taps span re-renders and item components. */
/** The last edit-mode tap: which item, when, and whether it was already selected. */
/** Controls that edit when pressed; stopped on a locked canvas. */
const EDIT_CONTROLS =
  'button, input, select, textarea, [contenteditable="true"], [role="checkbox"], [role="button"], .tree-node, .task-row';
/** Controls that only look; left alone on a locked canvas. */
const READ_ONLY_OK =
  '[data-view-ok], a[href], .audio-controls, .pdf-bar, .timeline-chevron, video, audio';

let lastTouchTap: { id: string; at: number; wasSelected: boolean } | null = null;
/** When a touch double tap was just handled — the browser's synthesized
 *  dblclick that follows must not act a second time. */
let touchDoubleTapAt = 0;

/** The per-type renderer, resolved through the item-type registry (rule 3.2). */
function ItemContent({ item }: { item: Item }) {
  const Render = itemType(item).render;
  return Render ? <Render item={item} /> : <div className="item-placeholder">{item.type}</div>;
}

export const ItemView = memo(function ItemView({ id }: { id: string }) {
  const item = useDocumentStore((s) => s.doc.items[id]);
  /** Was this item selected at each of the last two presses? [earlier, latest] */
  const localOverride = useSessionStore((s) => s.gesture?.overrides[id]);
  // A peer's in-flight drag/resize preview (team boards); local wins.
  const remoteOverride = useCollabStore((s) => s.remoteOverrides[id]?.bounds);
  const override = localOverride ?? remoteOverride;
  // Isolation dims everything outside the isolated group — at any depth, so
  // a nested group's members stay live while their ancestor is isolated.
  const isolatedId = useSessionStore((s) => s.isolatedGroupId);
  const weightsVisible = useSessionStore((s) => s.weightsVisible);
  const readOnly = useCanvasReadOnly();
  const dimmed = useDocumentStore(
    (s) => isolatedId !== null && item !== undefined && !isInsideGroup(s.doc, item, isolatedId),
  );
  const presentDim = useSessionStore((s) => s.presenting && !s.presentIds.includes(id));
  const editing = useSessionStore((s) => s.editingItemId === id);
  const opacityPreview = useSessionStore((s) =>
    s.opacityPreview?.ids.includes(id) ? s.opacityPreview.value : null,
  );
  // Dragging over a timeline point: the carried item goes translucent so
  // the target point stays visible underneath.
  const dropGhost = useSessionStore(
    (s) =>
      s.timelineDropHover !== null &&
      s.gesture?.kind === 'move' &&
      s.gesture.overrides[id] !== undefined,
  );
  const commentsVisible = useSessionStore((s) => s.commentsVisible);
  const commentCount = useDocumentStore((s) => {
    let n = 0;
    for (const c of Object.values(s.doc.comments)) if (c.itemId === id) n++;
    return n;
  });

  if (!item) return null;
  const bounds = effectiveBounds(item, override);
  const url = editing ? null : effectiveUrl(item);

  /**
   * Open/activate an item the way desktop double-click does. readOnly (the
   * view-only canvas) never edits: text and friends open in the lightbox.
   */
  const activateItem = (readOnly: boolean) => {
    const session = useSessionStore.getState();
    if (
      !readOnly &&
      (item.type === 'text' || item.type === 'code' || item.type === 'title') &&
      !item.locked
    ) {
      session.setEditingItemId(id);
      return;
    }
    if (item.type === 'link') {
      // Edit mode on touch: the double-tap EDITS (the style panel is a
      // desktop hover affordance; view-only tap still opens the URL).
      if (!readOnly && isMobileViewport() && !item.locked) {
        editItem(item);
        return;
      }
      if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (item.type === 'iframe') {
      // Edit mode: open the lightbox (its side panel has the URL field).
      if (!readOnly && !item.locked) openLightbox(item);
      return; // view-only: the in-item page drives it
    }
    if (item.type === 'project' && !VIEWER) {
      openProject(item.id);
      return;
    }
    openLightbox(item);
  };

  /** View-only mobile: a motionless tap opens the item (lightbox/link). */
  const tapActivate = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startAt = Date.now();
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      if (Date.now() - startAt > 600) return;
      if (Math.hypot(up.clientX - startX, up.clientY - startY) > 10) return;
      activateItem(true);
    };
    window.addEventListener('pointerup', onUp);
  };

  /** Tap (not drag) on an unselected item selects it — mobile edit mode. */
  const tapSelect = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startAt = Date.now();
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      if (Date.now() - startAt > 600) return;
      if (Math.hypot(up.clientX - startX, up.clientY - startY) > 10) return;
      const session = useSessionStore.getState();
      const doc = useDocumentStore.getState().doc;
      const item = doc.items[id];
      if (!item) return;
      session.setSelection(expandToGroups(doc, [id], session.isolatedGroupId));
      lastTouchTap = { id, at: Date.now(), wasSelected: false };
    };
    window.addEventListener('pointerup', onUp);
  };

  /** Edit mode: a DOUBLE tap opens (lightbox/editor). A single tap only
   *  selects, and a long-press release is the context menu's — not a tap. */
  const touchTapOpen = (downAt: number) => {
    if (Date.now() - downAt > 450) {
      lastTouchTap = null; // a hold, not a tap
      return;
    }
    const prev = lastTouchTap;
    lastTouchTap = { id, at: Date.now(), wasSelected: true };
    if (prev && prev.id === id && Date.now() - prev.at < 400) {
      lastTouchTap = null;
      touchDoubleTapAt = Date.now();
      // Same rule as the desktop double-click: a double tap on a member of a
      // group enters that group, one level, selecting nothing inside it;
      // inside the member's own group the double tap opens the item.
      const session = useSessionStore.getState();
      const doc = useDocumentStore.getState().doc;
      const unit = selectionUnit(doc, id, session.isolatedGroupId);
      if (unit.kind === 'group' && !item.locked) {
        session.setIsolatedGroup(unit.id);
        session.setSelection([]);
        return;
      }
      activateItem(false);
    }
  };

  /** Long-press (touch edit mode) opens the item context menu. */
  const armLongPress = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointermove', onMove);
    };
    const onMove = (mv: PointerEvent) => {
      if (Math.hypot(mv.clientX - startX, mv.clientY - startY) > 10) cancel();
    };
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointermove', onMove);
    window.setTimeout(() => {
      if (cancelled) return;
      cancel();
      const session = useSessionStore.getState();
      const doc = useDocumentStore.getState().doc;
      const item = doc.items[id];
      if (!item) return;
      // Locked never selects; its menu is the minimal Open/Unlock one.
      if (!item.locked && !session.selection.includes(id)) {
        session.setSelection(expandToGroups(doc, [id], session.isolatedGroupId));
      }
      navigator.vibrate?.(10);
      session.setContextMenu({ x: startX, y: startY, itemId: id });
    }, 500);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return; // middle-mouse pans; editors own their events
    const session = useSessionStore.getState();
    // Presenting: the step's controls work (a PDF pages, a video plays),
    // but nothing selects, drags or opens.
    if (session.presenting) return;
    if (e.pointerType === 'touch' && isMobileViewport()) {
      // View-only: taps OPEN items (lightbox/link) while drags bubble to
      // pan/pinch. In edit mode the ORIGIN rule applies: dragging a
      // selected item moves it; an unselected item only tap-selects.
      if (!session.mobileEditMode) {
        tapActivate(e);
        return;
      }
      // While a dimension lock is armed, the viewport owns every DRAG — but a
      // motionless tap still selects, and tap-again still opens the item
      // (otherwise Scale/Rotate mode traps the user out of the lightbox).
      if (session.mobileTransformLock !== 'move' && session.selection.length > 0) {
        if (session.selection.includes(id)) {
          const downAt = Date.now();
          const sx = e.clientX;
          const sy = e.clientY;
          const onUp = (up: PointerEvent) => {
            window.removeEventListener('pointerup', onUp);
            if (Math.hypot(up.clientX - sx, up.clientY - sy) > 10) return;
            touchTapOpen(downAt);
          };
          window.addEventListener('pointerup', onUp);
        } else {
          tapSelect(e);
        }
        return;
      }
      armLongPress(e);
      if (item.locked) {
        // Locked = view-only: no selecting. Double-tap still opens; a
        // long-press release fails touchTapOpen's hold check, so the minimal
        // Open/Unlock menu never fights the lightbox.
        const downAt = Date.now();
        const sx = e.clientX;
        const sy = e.clientY;
        const onUp = (up: PointerEvent) => {
          window.removeEventListener('pointerup', onUp);
          if (Math.hypot(up.clientX - sx, up.clientY - sy) > 10) return;
          touchTapOpen(downAt);
        };
        window.addEventListener('pointerup', onUp);
        return;
      }
      if (!session.selection.includes(id)) {
        tapSelect(e);
        return;
      }
      // fall through: selected item -> normal move flow below
    }
    // Hold "c" and drag over an image to crop it. Rotated images bake their
    // rotation down first (crop math is axis-aligned); the same pointer
    // gesture then starts the crop on the freshly rasterized item.
    if (session.cropHeld && item.type === 'image' && !item.locked) {
      e.stopPropagation();
      if (!session.selection.includes(id)) session.setSelection([id]);
      if (item.rotation !== 0) {
        const evt = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
        void rasterizeRotation(id).then(() => beginCrop(evt, id));
      } else {
        beginCrop(e, id);
      }
      return;
    }
    // Locked = view-only content: it never selects or drags. Returning
    // WITHOUT stopping propagation lets the press fall through to the canvas
    // (marquee/pan), and double-click still reaches onDoubleClick below —
    // crucially with no selection overlay appearing between the two clicks.
    if (item.locked) return;
    if (session.tool !== 'select' || session.spaceHeld) return;
    e.stopPropagation();

    // Grouped items select and move as a unit — unless their group is
    // ISOLATED, in which case members act as individuals.
    const doc = useDocumentStore.getState().doc;
    const targets = expandToGroups(doc, [id], session.isolatedGroupId);
    const wasSelected = session.selection.includes(id);

    // Alt-drag duplicates (Illustrator-style): clone IN PLACE and keep
    // dragging the clones — the originals stay where they were.
    if (e.altKey && !item.locked) {
      const dragIds = wasSelected ? session.selection : targets;
      const cloneIds = duplicateItems(dragIds, 'Duplicate', 0);
      if (cloneIds.length) {
        session.setSelection(cloneIds);
        beginMove(e);
        return;
      }
    }

    const toggleTargets = () => {
      const allIn = targets.every((t) => session.selection.includes(t));
      session.setSelection(
        allIn
          ? session.selection.filter((s) => !targets.includes(s))
          : [...session.selection, ...targets.filter((t) => !session.selection.includes(t))],
      );
    };

    // Shift-drag a grouped item moves just that one item out of the group; a
    // plain shift-click (no drag) still toggles the whole group in the selection.
    if (e.shiftKey && item.groupId && !item.locked) {
      beginMove(e, { soloDragId: id, onClick: toggleTargets });
      return;
    }

    if (e.shiftKey) {
      const allIn = targets.every((t) => session.selection.includes(t));
      toggleTargets();
      if (allIn) return; // shift-click deselected — no drag
    } else if (!wasSelected) {
      session.setSelection(targets);
    }
    if (session.pathEditId && session.pathEditId !== id) session.setPathEditId(null);
    // Only narrow to a single item on a plain click of an ungrouped item.
    const collapseToId = !e.shiftKey && wasSelected && !item.groupId ? id : undefined;
    // Mobile edit mode: a DOUBLE tap (no drag) opens the item — in-place
    // editing for text, the lightbox for media. (A long-press release used
    // to count as the "second tap" and threw the lightbox over the context
    // menu; the tap timer filters holds out.)
    const touchDownAt = Date.now();
    const mobileTapAgain =
      e.pointerType === 'touch' && isMobileViewport() && wasSelected
        ? () => touchTapOpen(touchDownAt)
        : undefined;
    beginMove(
      e,
      mobileTapAgain
        ? { ...(collapseToId ? { collapseToId } : {}), onClick: mobileTapAgain }
        : collapseToId
          ? { collapseToId }
          : {},
    );
  };

  /**
   * Locked canvas (pan tool) and the viewer: nothing inside an item edits.
   * Editing controls — buttons, inputs, checkboxes, drag grips, node cards —
   * are stopped in the capture phase before they act; what only LOOKS
   * (media transport, PDF paging, a timeline chevron, links, anything marked
   * data-view-ok) still works; anything marked data-edit never does.
   */
  const guardReadOnly = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;
    if (target.closest('[data-edit]')) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (target.closest(READ_ONLY_OK)) return;
    if (target.closest(EDIT_CONTROLS)) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onDoubleClickReadOnly = (e: React.MouseEvent) => {
    // Any double-click on a locked item opens it for looking, whatever
    // control it landed on. In a presentation it takes a closer look instead.
    e.stopPropagation();
    e.preventDefault();
    if (useSessionStore.getState().presenting) presentZoomToggle({ x: e.clientX, y: e.clientY });
    else viewItem(item);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const session = useSessionStore.getState();
    if (session.presenting) return;
    // A touch double tap already acted through touchTapOpen; the dblclick
    // Chromium synthesizes from the same two taps is a duplicate.
    if (Date.now() - touchDoubleTapAt < 500) {
      e.stopPropagation();
      return;
    }
    // A view-only canvas — the offline viewer / share page, or mobile before
    // the Edit button — always VIEWS on double-click/double-tap: the lightbox
    // opens, nothing enters an editor. This must come BEFORE group isolation,
    // which is an editing affordance (it selects the tapped member).
    if (canvasReadOnly() || (isMobileViewport() && !session.mobileEditMode)) {
      e.stopPropagation();
      activateItem(true);
      return;
    }
    // Double-click on a member of a group ENTERS the group, one level per
    // double-click, selecting nothing inside it: the next click picks a
    // member, the next double-click on it goes one level deeper or, inside
    // the member's own group, acts on the item (editor, lightbox, link).
    // (Until 2026-10-16 a group this double-click itself selected opened the
    // item instead; it kept starting editors by surprise.) A locked item is
    // view-only: it opens (below) and never enters editing.
    const doc = useDocumentStore.getState().doc;
    const unit = selectionUnit(doc, id, session.isolatedGroupId);
    if (unit.kind === 'group' && !item.locked) {
      e.stopPropagation();
      session.setIsolatedGroup(unit.id);
      session.setSelection([]);
      return;
    }
    if (item.type === 'shape' && item.shape === 'path' && !item.locked) {
      e.stopPropagation();
      const session = useSessionStore.getState();
      session.setSelection([]); // node handles replace the transform frame
      session.setPathEditId(id);
      return;
    }
    if ((item.type === 'text' || item.type === 'code' || item.type === 'title') && !item.locked) {
      e.stopPropagation();
      useSessionStore.getState().setEditingItemId(id);
    } else if (item.type === 'link') {
      e.stopPropagation();
      if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
    } else if (item.type === 'iframe') {
      e.stopPropagation();
      // Unlocked: the address bar drives it. Locked: the page is inert, so
      // double-click opens the lightbox like any other locked item.
      if (item.locked) openLightbox(item);
    } else if (item.type === 'project' && !VIEWER) {
      // The card is a summary: its home is the full-screen Projects view.
      e.stopPropagation();
      openProject(item.id);
    } else if (openLightbox(item)) {
      // image / video / pdf → fullscreen viewer
      e.stopPropagation();
    }
  };

  const status = statusMeta(item.status);
  return (
    <div
      className={`canvas-item${dimmed ? ' iso-dim' : ''}${presentDim ? ' present-dim' : ''}${item.status === 'debunked' ? ' item-debunked' : ''}`}
      data-item-id={id}
      data-item-type={item.type}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      {...(readOnly
        ? {
            onPointerDownCapture: guardReadOnly,
            onClickCapture: guardReadOnly,
            onChangeCapture: guardReadOnly,
            onDoubleClickCapture: onDoubleClickReadOnly,
          }
        : {})}
      style={{
        transform: `translate(${bounds.x}px, ${bounds.y}px) rotate(${bounds.rotation}deg)`,
        width: bounds.width,
        // Auto-grow only while editing an auto-height text box; fixed/document
        // boxes keep their height (their content scrolls).
        height: item.type === 'text' && editing && item.autoHeight ? 'auto' : bounds.height,
        minHeight: item.type === 'text' ? bounds.height : undefined,
        zIndex: item.zIndex,
        // Presentation Mode dims everything but the current step (inline, so
        // it composes with the item's own opacity rather than fighting it).
        opacity:
          (dropGhost
            ? Math.min(opacityPreview ?? item.opacity, 0.35)
            : (opacityPreview ?? item.opacity)) * (presentDim ? 0.22 : 1),
      }}
    >
      <ItemContent item={item} />
      {status && (
        <span
          className={`item-status-badge status-${status.id}`}
          title={status.name}
          data-testid="item-status-badge"
        >
          {status.glyph}
        </span>
      )}
      {item.weight && weightsVisible && (
        <span
          className={`item-weight-badge${status ? ' after-status' : ''}`}
          title={`Strength ${weightLabel(item.weight)}`}
          data-testid="item-weight-badge"
        >
          {item.weight}
        </span>
      )}
      {url && (
        <button
          type="button"
          className="item-link-badge"
          title={url}
          aria-label="Open link"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openUrl(url);
          }}
        >
          <LinkIcon />
        </button>
      )}
      {commentsVisible && commentCount > 0 && (
        <button
          type="button"
          className="item-comment-badge"
          title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
          aria-label="View comments"
          data-testid="item-comment-badge"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            useSessionStore.getState().setLightboxCommentsHint(true);
            useSessionStore.getState().setLightbox(id);
          }}
        >
          <ChatIcon />
          <span>{commentCount}</span>
        </button>
      )}
    </div>
  );
});
