import { useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  ExpandIcon,
  GearIcon,
  MoveIcon,
  PencilIcon,
  RedoIcon,
  RotateIcon,
  TrashIcon,
  UndoIcon,
  GroupIcon,
} from '../icons';
import { removeItems, updateItems } from '../../state/commands';
import { canEditItem, editItem } from '../../lib/itemEditors';
import { isMobileViewport } from '../../lib/mobile';
import { useHistoryStore } from '../../state/history';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Mobile edit mode (phase 1): a pencil FAB flips the small-screen canvas out
 * of view-only, and a transient Undo chip appears after each edit — fat
 * fingers guarantee mistakes, so undo has to be one thumb-tap away.
 */

export function MobileEditFab() {
  const active = useSessionStore((s) => s.mobileEditMode);
  // The selection bar owns the bottom edge while items are selected.
  const raised = useSessionStore((s) => s.mobileEditMode && s.selection.length > 0);
  // Rerender on resize so the FAB appears/disappears with the breakpoint.
  const [, force] = useState(0);
  useEffect(() => {
    const onResize = () => force((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (!isMobileViewport()) return null;
  return (
    <button
      type="button"
      className={`mobile-edit-fab${active ? ' active' : ''}${raised ? ' raised' : ''}`}
      aria-label={active ? 'Done editing' : 'Edit the canvas'}
      aria-pressed={active}
      data-testid="mobile-edit-fab"
      onClick={() => {
        const session = useSessionStore.getState();
        if (active) session.clearSelection();
        session.setMobileEditMode(!active);
        navigator.vibrate?.(8);
      }}
    >
      {active ? <CloseIcon /> : <PencilIcon />}
      <span>{active ? 'Done' : 'Edit'}</span>
    </button>
  );
}

/** Persistent top-left undo/redo while editing — fat fingers guarantee
 *  mistakes, so history stays one thumb-tap away (and redo un-does the
 *  panic-undo). */
export function MobileHistoryCluster() {
  const editMode = useSessionStore((s) => s.mobileEditMode);
  const index = useHistoryStore((s) => s.index);
  const count = useHistoryStore((s) => s.entries.length);
  if (!editMode) return null;
  return (
    <div className="mobile-history" data-testid="mobile-history">
      <button
        type="button"
        aria-label="Undo"
        data-testid="mobile-undo"
        disabled={index < 0}
        onClick={() => {
          useHistoryStore.getState().undo();
          navigator.vibrate?.(8);
        }}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        aria-label="Redo"
        data-testid="mobile-redo"
        disabled={index >= count - 1}
        onClick={() => {
          useHistoryStore.getState().redo();
          navigator.vibrate?.(8);
        }}
      >
        <RedoIcon />
      </button>
    </div>
  );
}

type Lock = 'move' | 'scale' | 'rotate';

/**
 * Phase 2: contextual bar while items are selected in mobile edit mode.
 * Move is the default origin-rule behavior; Scale/Rotate LOCK the next
 * gestures to one dimension (drag anywhere on screen — precision without
 * tiny handles). Plus a nudge D-pad for the last few pixels, delete, done.
 */
export function MobileSelectionBar() {
  const editMode = useSessionStore((s) => s.mobileEditMode);
  const selection = useSessionStore((s) => s.selection);
  const adjustOpen = useSessionStore((s) => s.mobileAdjustOpen);
  const singleImage = useDocumentStore(
    (s) => selection.length === 1 && s.doc.items[selection[0]!]?.type === 'image',
  );
  const singleItem = useDocumentStore((s) =>
    selection.length === 1 ? s.doc.items[selection[0]!] : undefined,
  );
  const sheetOpen = useSessionStore((s) => s.mobileStyleSheetOpen);
  const lock = useSessionStore((s) => s.mobileTransformLock);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [big, setBig] = useState(false);
  const repeat = useRef<number | null>(null);

  // New selection → back to the default lock, close the pad.
  const selKey = selection.join(',');
  const prevSel = useRef(selKey);
  useEffect(() => {
    if (prevSel.current !== selKey) {
      prevSel.current = selKey;
      useSessionStore.getState().setMobileTransformLock('move');
      useSessionStore.getState().setMobileStyleSheetOpen(false);
      setNudgeOpen(false);
    }
  }, [selKey]);

  if (!editMode || selection.length === 0) return null;

  const setLock = (next: Lock) => {
    useSessionStore.getState().setMobileTransformLock(next);
    navigator.vibrate?.(6);
  };

  const nudge = (dx: number, dy: number) => {
    const step = big ? 10 : 1;
    updateItems(useSessionStore.getState().selection, 'Nudge', (d) => {
      d.x += dx * step;
      d.y += dy * step;
    });
  };
  const startRepeat = (dx: number, dy: number) => {
    nudge(dx, dy);
    stopRepeat();
    repeat.current = window.setInterval(() => nudge(dx, dy), 140);
  };
  const stopRepeat = () => {
    if (repeat.current) {
      window.clearInterval(repeat.current);
      repeat.current = null;
    }
  };

  const lockBtn = (value: Lock, icon: React.ReactNode, label: string, disabled = false) => (
    <button
      type="button"
      className={lock === value ? 'active' : ''}
      disabled={disabled}
      aria-pressed={lock === value}
      aria-label={label}
      data-testid={`msel-${value}`}
      onClick={() => setLock(value)}
    >
      {icon}
    </button>
  );

  return (
    <>
      {nudgeOpen && (
        <div className="mobile-nudge-pad" data-testid="mobile-nudge-pad">
          <button
            type="button"
            aria-label="Nudge up"
            data-testid="nudge-up"
            onPointerDown={() => startRepeat(0, -1)}
            onPointerUp={stopRepeat}
            onPointerLeave={stopRepeat}
          >
            <ChevronUpIcon />
          </button>
          <div className="mobile-nudge-mid">
            <button
              type="button"
              aria-label="Nudge left"
              data-testid="nudge-left"
              onPointerDown={() => startRepeat(-1, 0)}
              onPointerUp={stopRepeat}
              onPointerLeave={stopRepeat}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className={`mobile-nudge-step${big ? ' active' : ''}`}
              aria-pressed={big}
              data-testid="nudge-step"
              onClick={() => setBig(!big)}
            >
              {big ? '10px' : '1px'}
            </button>
            <button
              type="button"
              aria-label="Nudge right"
              data-testid="nudge-right"
              onPointerDown={() => startRepeat(1, 0)}
              onPointerUp={stopRepeat}
              onPointerLeave={stopRepeat}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <button
            type="button"
            aria-label="Nudge down"
            data-testid="nudge-down"
            onPointerDown={() => startRepeat(0, 1)}
            onPointerUp={stopRepeat}
            onPointerLeave={stopRepeat}
          >
            <ChevronDownIcon />
          </button>
        </div>
      )}
      <div className="mobile-selection-bar" data-testid="mobile-selection-bar">
        {lockBtn('move', <MoveIcon />, 'Move (drag the item)')}
        {lockBtn('scale', <ExpandIcon />, 'Scale (drag anywhere)')}
        {lockBtn('rotate', <RotateIcon />, 'Rotate (drag anywhere)', selection.length !== 1)}
        <button
          type="button"
          className={nudgeOpen ? 'active' : ''}
          aria-pressed={nudgeOpen}
          aria-label="Nudge"
          data-testid="msel-nudge"
          onClick={() => setNudgeOpen(!nudgeOpen)}
        >
          <ChevronUpIcon />
        </button>
        {selection.length > 1 && (
          <button
            type="button"
            aria-label="Group selection"
            data-testid="msel-group"
            onClick={() => {
              void import('../../lib/canvas/groupActions').then((m) => m.groupSelection());
              navigator.vibrate?.(10);
            }}
          >
            <GroupIcon />
          </button>
        )}
        {singleItem && !singleImage && canEditItem(singleItem) && (
          <button
            type="button"
            className={sheetOpen ? 'active' : ''}
            aria-pressed={sheetOpen}
            aria-label="Edit item"
            data-testid="msel-edit"
            onClick={() => {
              if (sheetOpen) useSessionStore.getState().setMobileStyleSheetOpen(false);
              else editItem(singleItem);
            }}
          >
            <PencilIcon />
          </button>
        )}
        {singleImage && (
          <button
            type="button"
            className={adjustOpen ? 'active' : ''}
            aria-pressed={adjustOpen}
            aria-label="Image adjustments"
            data-testid="msel-adjust"
            onClick={() => useSessionStore.getState().setMobileAdjustOpen(!adjustOpen)}
          >
            <GearIcon />
          </button>
        )}
        <button
          type="button"
          className="danger"
          aria-label="Delete"
          data-testid="msel-delete"
          onClick={() => {
            removeItems(useSessionStore.getState().selection);
            navigator.vibrate?.(10);
          }}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          aria-label="Done (deselect)"
          data-testid="msel-done"
          onClick={() => {
            useSessionStore.getState().setMobileAdjustOpen(false);
            useSessionStore.getState().setMobileStyleSheetOpen(false);
            useSessionStore.getState().clearSelection();
          }}
        >
          <CheckIcon />
        </button>
      </div>
    </>
  );
}
