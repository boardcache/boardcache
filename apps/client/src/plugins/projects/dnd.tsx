import { useState } from 'react';
import type { ProjectTask } from '@boardcache/schema';
import { GripIcon } from '../../components/icons';

/**
 * Tiny pointer-drag helper for the Projects views (Kanban cards between
 * columns, Calendar chips between days). Window-level listeners like
 * lib/gestures.ts; the caller decides what a drop over a target means.
 */

export interface PointerDrag {
  /** Fires once the pointer has moved past the threshold (a click never drags). */
  onStart?: () => void;
  onMove?: (ev: PointerEvent, dx: number, dy: number) => void;
  /** Fires on release after a real drag; `target` is the matched drop element. */
  onDrop?: (ev: PointerEvent, target: HTMLElement | null) => void;
  /** Fires on release when the gesture was a click. */
  onClick?: () => void;
  /** CSS selector for drop targets (matched via elementsFromPoint). */
  dropSelector: string;
  threshold?: number;
}

export function dropTargetAt(x: number, y: number, selector: string): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const hit = (el as HTMLElement).closest?.(selector);
    if (hit) return hit as HTMLElement;
  }
  return null;
}

export function startPointerDrag(e: React.PointerEvent, drag: PointerDrag): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const id = e.pointerId;
  const threshold = drag.threshold ?? 4;
  let dragging = false;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < threshold) return;
      dragging = true;
      drag.onStart?.();
    }
    ev.preventDefault();
    drag.onMove?.(ev, dx, dy);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    cleanup();
    if (dragging) drag.onDrop?.(ev, dropTargetAt(ev.clientX, ev.clientY, drag.dropSelector));
    else drag.onClick?.();
  };
  // The browser claimed the gesture (touch scroll): abort — never a click.
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    cleanup();
    if (dragging) drag.onDrop?.(ev, null);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/** Local-time ISO date key (YYYY-MM-DD). */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD (or a datetime) as a local date; null if invalid. */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Among a container's `[data-task-id]` rows (minus the dragged one), the
 *  first whose midpoint is below `y` — i.e. the row to insert before. */
function insertionBefore(container: HTMLElement, y: number, excludeId: string): string | null {
  for (const row of container.querySelectorAll<HTMLElement>('[data-task-id]')) {
    const id = row.dataset.taskId;
    if (!id || id === excludeId) continue;
    const r = row.getBoundingClientRect();
    if (y < r.top + r.height / 2) return id;
  }
  return null;
}

export interface DropTarget {
  /** The `data-drop-key` of the column / section under the pointer. */
  key: string;
  /** Insert before this task (null = end). Only resolved in manual order. */
  beforeId: string | null;
}

/**
 * Drag a task between drop containers (`[data-drop-key]`) and — in manual
 * order — to a position within one. Shared by the Board and List views so
 * both drags feel identical: the dragged element lifts out of flow (fixed,
 * following the pointer) and, in manual order, a slot of its size opens
 * where it will land.
 */
export function useTaskDrag(opts: {
  manual: boolean;
  /** Lock the ghost to vertical movement (list rows). */
  vertical?: boolean;
  onDrop: (task: ProjectTask, target: DropTarget | null) => void;
  onClick?: (task: ProjectTask) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState<DropTarget | null>(null);
  /** The dragged element's rect at pointerdown: the ghost's anchor and the slot's size. */
  const [rect, setRect] = useState<DOMRect | null>(null);
  const resolve = (ev: PointerEvent, task: ProjectTask): DropTarget | null => {
    const el = dropTargetAt(ev.clientX, ev.clientY, '[data-drop-key]');
    if (!el) return null;
    return {
      key: el.dataset.dropKey ?? '',
      beforeId: opts.manual ? insertionBefore(el, ev.clientY, task.id) : null,
    };
  };
  const beginDrag = (e: React.PointerEvent, task: ProjectTask) => {
    // Touch: only the grip drags, so a finger anywhere else scrolls — and a
    // motionless tap opens, as a click does with a mouse.
    if (e.pointerType === 'touch' && !(e.target as Element).closest('.pj-grip')) {
      const sx = e.clientX;
      const sy = e.clientY;
      const at = Date.now();
      const done = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', cancel);
        if (Date.now() - at < 600 && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 10)
          opts.onClick?.(task);
      };
      const cancel = () => {
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', cancel);
      };
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', cancel);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    startPointerDrag(e, {
      dropSelector: '[data-drop-key]',
      onStart: () => {
        setRect(r);
        setDraggingId(task.id);
      },
      onMove: (ev, dx, dy) => {
        setOffset({ x: opts.vertical ? 0 : dx, y: dy });
        setTarget(resolve(ev, task));
      },
      onDrop: (ev) => {
        const t = resolve(ev, task);
        setDraggingId(null);
        setTarget(null);
        setOffset({ x: 0, y: 0 });
        opts.onDrop(task, t);
      },
      onClick: () => opts.onClick?.(task),
    });
  };
  /** Style for the dragged element: lifted out of flow, following the pointer. */
  const ghost = (id: string): React.CSSProperties | undefined => {
    if (draggingId !== id || !rect) return undefined;
    return {
      position: 'fixed',
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      margin: 0,
      transform: `translate(${offset.x}px, ${offset.y}px)`,
    };
  };
  /** Height of the slot to open at the drop position (manual order only). */
  const slot = draggingId && opts.manual && rect ? rect.height : null;
  return { draggingId, target, beginDrag, ghost, slot };
}

/** The drag handle: the only touch drag surface (mouse drags from anywhere). */
export function Grip({ className = '' }: { className?: string }) {
  return (
    <span className={`pj-grip ${className}`.trim()} aria-hidden data-testid="pj-grip">
      <GripIcon size={14} />
    </span>
  );
}

/** The tinted placeholder that opens where the dragged task will land. */
export function DropSlot({ height }: { height: number }) {
  return <div className="pj-drop-slot" style={{ height }} aria-hidden data-testid="pj-drop-slot" />;
}
