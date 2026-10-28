import * as D from '@radix-ui/react-dialog';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
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
 * Focus: Radix focuses the first tabbable element (the header close button).
 * Mark a field with `data-autofocus` to receive initial focus instead.
 */
export type DialogSize = 'narrow' | 'default' | 'wide' | 'large' | 'full';

export function UiDialog({
  title,
  onClose,
  className,
  size = 'default',
  testId,
  clearBackdrop = false,
  dismissable = true,
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
  children: ReactNode;
}) {
  // Phones AND every Apple touch device (iPads report desktop widths) bypass
  // Radix Dialog entirely: iOS Safari kept presenting Radix's portal
  // invisibly while it swallowed every tap (reported on-device even in a
  // private tab, after non-modal + backdrop-filter fixes). A bare
  // createPortal div has no focus trap, no scroll lock, no dismissal layers
  // — nothing left to misplace. As a last-resort escape hatch, tapping the
  // backdrop closes the dialog on mobile.
  const mobile = isMobileViewport() || isAppleTouch();
  const sheetClass = `dlg-sheet${size !== 'default' ? ` dlg-${size}` : ''}${className ? ` ${className}` : ''}`;
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
      className={sheetClass}
      aria-describedby={undefined}
      tabIndex={-1}
      onOpenAutoFocus={(e) => {
        // Focus the marked field, or the panel itself — never the ✕,
        // which would draw a stray focus ring on open.
        const content = e.target as HTMLElement | null;
        e.preventDefault();
        (content?.querySelector<HTMLElement>('[data-autofocus]') ?? content)?.focus();
      }}
      onEscapeKeyDown={(e) => {
        if (!dismissable) e.preventDefault();
      }}
      // Never dismiss on backdrop/outside clicks — too easy to lose
      // dialog state by accident. Escape and ✕ remain (when dismissable).
      onInteractOutside={(e) => e.preventDefault()}
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

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

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
      <div className={className} role="dialog" aria-modal="true">
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
