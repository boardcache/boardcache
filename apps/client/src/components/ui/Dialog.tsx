import * as D from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';
import { isAppleTouch, isMobileViewport } from '../../lib/mobile';
import { probeDialogPaint } from '../../lib/deviceLog';

/**
 * App-styled modal on Radix Dialog: focus trap, Escape/outside dismissal, and
 * aria wiring for free, rendered into the existing .dlg-veil / .dlg-sheet /
 * .sheet-head CSS. Parents keep the `open ? <Body/> : null` mount pattern so
 * dialog state resets on every open; UiDialog itself is always "open".
 *
 * Focus: the first field in the dialog gets it on open (a `data-autofocus`
 * mark picks another), never the header close button. Whatever closed to
 * make way (a menu, another dialog) hands focus back to ITS trigger a tick
 * later, over the top of ours, so the claim is re-asserted after that tick.
 */
export type DialogSize = 'narrow' | 'default' | 'wide' | 'large' | 'full';

const FIELD =
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable="true"]';

/** The element a freshly opened dialog focuses: the marked field, else the
 *  first text field that can take input, else the panel itself. */
function initialFocusTarget(root: HTMLElement): HTMLElement {
  const marked = root.querySelector<HTMLElement>('[data-autofocus]');
  if (marked) return marked;
  for (const el of root.querySelectorAll<HTMLElement>(FIELD)) {
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) continue;
    return el;
  }
  return root;
}

function focusInitial(root: HTMLElement | null): void {
  if (root) initialFocusTarget(root).focus();
}

/** Re-assert the dialog's focus once the closed thing's restore has run
 *  (Radix queues that restore with a zero timeout at unmount). */
function useFocusReassert(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const t = setTimeout(() => {
      const root = ref.current;
      if (root && !root.contains(document.activeElement)) focusInitial(root);
    }, 60);
    return () => clearTimeout(t);
  }, [ref]);
}

export function UiDialog({
  title,
  onClose,
  className,
  size = 'default',
  testId,
  clearBackdrop = false,
  dismissable = true,
  resizable,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  /** Variant class(es) appended to `.dlg-sheet` (e.g. "sync-sheet"). */
  className?: string;
  /** Width: narrow (380), default (440), wide (560), large (720), full (960). */
  size?: DialogSize;
  /** data-testid on the backdrop, matching the previous markup. */
  testId?: string;
  /** Don't dim/blur the page behind — for dialogs with a live canvas preview. */
  clearBackdrop?: boolean;
  /** false locks the dialog open (busy states): no Escape/outside/✕ close. */
  dismissable?: boolean;
  /** A corner grip drags the sheet's size, kept on the device under this key
   *  (desktop only; the sheet lays its body out as a column that fills it). */
  resizable?: string;
  children: ReactNode;
}) {
  // Phones AND every Apple touch device (iPads report desktop widths) bypass
  // Radix Dialog entirely: iOS Safari kept presenting Radix's portal
  // invisibly while it swallowed every tap (reported on-device even in a
  // private tab, after non-modal + backdrop-filter fixes). A bare
  // createPortal div has no focus trap, no scroll lock, no dismissal layers
  // — nothing left to misplace. As a last-resort escape hatch, tapping the
  // backdrop closes the dialog on mobile.
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusReassert(contentRef);
  const mobile = isMobileViewport() || isAppleTouch();
  const sheetClass = `dlg-sheet${size !== 'default' ? ` dlg-${size}` : ''}${resizable ? ' dlg-resizable' : ''}${className ? ` ${className}` : ''}`;
  const [box, setBox] = useState(() => (resizable ? readBox(resizable) : null));
  useEffect(() => {
    probeDialogPaint(`${mobile ? 'mobile' : 'radix'}:${testId ?? 'dialog'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (mobile) {
    return (
      <MobileDialog
        title={title}
        onClose={onClose}
        className={sheetClass}
        {...(testId !== undefined ? { testId } : {})}
        clearBackdrop={clearBackdrop}
        dismissable={dismissable}
      >
        {children}
      </MobileDialog>
    );
  }
  const backdropProps = {
    className: `dlg-veil${clearBackdrop ? ' dlg-veil-clear' : ''}`,
    ...(testId ? { 'data-testid': testId } : {}),
  };
  const content = (
    <D.Content
      ref={contentRef}
      className={sheetClass}
      aria-describedby={undefined}
      tabIndex={-1}
      onOpenAutoFocus={(e) => {
        // The first field, or the panel itself — never the ✕, which would
        // draw a stray focus ring on open.
        e.preventDefault();
        focusInitial(e.target as HTMLElement | null);
      }}
      onEscapeKeyDown={(e) => {
        if (!dismissable) e.preventDefault();
      }}
      // Never dismiss on backdrop/outside clicks — too easy to lose
      // dialog state by accident. Escape and ✕ remain (when dismissable).
      onInteractOutside={(e) => e.preventDefault()}
      style={box ? { width: box.w, height: box.h } : undefined}
    >
      <header className="sheet-head">
        <D.Title asChild>
          <h2>{title}</h2>
        </D.Title>
        <D.Close asChild>
          <button type="button" className="sheet-close" aria-label="Close" disabled={!dismissable}>
            <CloseIcon />
          </button>
        </D.Close>
      </header>
      {children}
      {resizable && (
        <ResizeGrip
          target={contentRef}
          onResize={(b) => {
            setBox(b);
            try {
              localStorage.setItem(resizable, JSON.stringify(b));
            } catch {
              /* private mode */
            }
          }}
        />
      )}
    </D.Content>
  );

  return (
    <D.Root open onOpenChange={(open) => !open && onClose()}>
      <D.Portal>
        <D.Overlay {...backdropProps}>{content}</D.Overlay>
      </D.Portal>
    </D.Root>
  );
}

const MIN_BOX = { w: 420, h: 320 };

function readBox(key: string): { w: number; h: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      w?: unknown;
      h?: unknown;
    } | null;
    if (v && typeof v.w === 'number' && typeof v.h === 'number') return clampBox(v.w, v.h);
  } catch {
    /* private mode, or an old value */
  }
  return null;
}

function clampBox(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.round(Math.min(window.innerWidth * 0.96, Math.max(MIN_BOX.w, w))),
    h: Math.round(Math.min(window.innerHeight * 0.92, Math.max(MIN_BOX.h, h))),
  };
}

/** The sheet's bottom-right corner: dragging it sets the sheet's size. */
function ResizeGrip({
  target,
  onResize,
}: {
  target: RefObject<HTMLElement | null>;
  onResize: (box: { w: number; h: number }) => void;
}) {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  return (
    <div
      className="dlg-resize"
      role="separator"
      aria-label="Resize"
      title="Drag to resize"
      data-testid="dlg-resize"
      onPointerDown={(e) => {
        if (e.button !== 0 || !target.current) return;
        e.preventDefault();
        const r = target.current.getBoundingClientRect();
        start.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        onResize(clampBox(s.w + e.clientX - s.x, s.h + e.clientY - s.y));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    />
  );
}

/** Radix-free mobile dialog: a fixed backdrop + panel via bare createPortal. */
function MobileDialog({
  title,
  onClose,
  className,
  testId,
  clearBackdrop,
  dismissable,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  /** The full sheet class list (UiDialog composes it). */
  className: string;
  testId?: string;
  clearBackdrop: boolean;
  dismissable: boolean;
  children: ReactNode;
}) {
  const mountedAt = useRef(0);
  const downOnBackdrop = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedAt.current = Date.now();
    focusInitial(panelRef.current);
  }, []);
  useFocusReassert(panelRef);

  useEffect(() => {
    if (!dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dismissable, onClose]);

  return createPortal(
    <div
      className={`dlg-veil${clearBackdrop ? ' dlg-veil-clear' : ''}`}
      {...(testId ? { 'data-testid': testId } : {})}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Tap outside the panel closes — doubles as the escape hatch if the
        // panel ever fails to paint. Two guards, both for iOS: the press must
        // have STARTED on the backdrop, and the click must not be the ghost
        // click Safari synthesizes from the tap that OPENED the dialog
        // (which lands on the freshly mounted backdrop and closed it
        // instantly — "the button does nothing").
        if (!dismissable || e.target !== e.currentTarget) return;
        if (!downOnBackdrop.current) return;
        if (mountedAt.current === 0 || Date.now() - mountedAt.current < 500) return;
        onClose();
      }}
    >
      <div className={className} role="dialog" aria-modal="true" tabIndex={-1} ref={panelRef}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            disabled={!dismissable}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
