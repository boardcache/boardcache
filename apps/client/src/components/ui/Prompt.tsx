import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { UiDialog } from './Dialog';

/**
 * App-styled replacement for window.prompt(): `promptText(...)` resolves with
 * the entered string, or null on Cancel/Escape. One host (`UiPromptHost`,
 * mounted at the app root) renders whichever request is pending, so callers
 * stay imperative one-liners.
 */

export interface PromptOptions {
  /** Dialog heading, e.g. "Name your board". */
  title: string;
  /** Optional field label to the left of the input. */
  label?: string;
  placeholder?: string;
  /** Pre-filled (and pre-selected) value. */
  initial?: string;
  /** Confirm button text (default "OK"). */
  confirmLabel?: string;
  /** Optional helper line under the input. */
  hint?: string;
}

interface PromptRequest extends PromptOptions {
  kind?: 'text';
  resolve: (value: string | null) => void;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmRequest extends ConfirmOptions {
  kind: 'confirm';
  resolveBool: (value: boolean) => void;
}

const usePromptStore = create<{ req: PromptRequest | ConfirmRequest | null }>(() => ({
  req: null,
}));

/** Ask a yes/no question in the app-styled dialog. Resolves false on
 *  Cancel/Escape — the safe answer. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = usePromptStore.getState().req;
    if (prev) {
      if (prev.kind === 'confirm') prev.resolveBool(false);
      else prev.resolve(null);
    }
    usePromptStore.setState({ req: { ...opts, kind: 'confirm', resolveBool: resolve } });
  });
}

/** Ask for one line of text. Resolves null when dismissed. */
export function promptText(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // A second prompt replaces a pending one — the old caller gets the
    // dismissive answer rather than hanging forever.
    const prev = usePromptStore.getState().req;
    if (prev) {
      if (prev.kind === 'confirm') prev.resolveBool(false);
      else prev.resolve(null);
    }
    usePromptStore.setState({ req: { ...opts, kind: 'text', resolve } });
  });
}

function settle(value: string | null): void {
  const req = usePromptStore.getState().req;
  usePromptStore.setState({ req: null });
  if (req && req.kind !== 'confirm') req.resolve(value);
}

function settleConfirm(value: boolean): void {
  const req = usePromptStore.getState().req;
  usePromptStore.setState({ req: null });
  if (req?.kind === 'confirm') req.resolveBool(value);
}

export function UiPromptHost() {
  const req = usePromptStore((s) => s.req);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!req) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [req]);
  if (!req) return null;

  if (req.kind === 'confirm') {
    return (
      <UiDialog
        title={req.title}
        onClose={() => settleConfirm(false)}
        className="ui-prompt-sheet"
        size="narrow"
        testId="ui-confirm"
      >
        <div className="plugin-settings">
          <p className="ui-confirm-body">{req.body}</p>
          <div className="ui-prompt-actions">
            <button
              type="button"
              data-testid="ui-confirm-cancel"
              onClick={() => settleConfirm(false)}
            >
              {req.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className="sync-primary"
              data-testid="ui-confirm-ok"
              onClick={() => settleConfirm(true)}
            >
              {req.confirmLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </UiDialog>
    );
  }

  const confirm = () => settle(inputRef.current?.value ?? '');
  return (
    <UiDialog
      title={req.title}
      onClose={() => settle(null)}
      className="ui-prompt-sheet"
      size="narrow"
      testId="ui-prompt"
    >
      <div className="plugin-settings">
        <label className="settings-row">
          {req.label && <span>{req.label}</span>}
          <input
            ref={inputRef}
            className="tag-input"
            defaultValue={req.initial ?? ''}
            placeholder={req.placeholder}
            data-testid="ui-prompt-input"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') confirm();
              if (e.key === 'Escape') settle(null);
            }}
          />
        </label>
        {req.hint && <p className="settings-hint">{req.hint}</p>}
        <div className="ui-prompt-actions">
          <button type="button" data-testid="ui-prompt-cancel" onClick={() => settle(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="sync-primary"
            data-testid="ui-prompt-ok"
            onClick={confirm}
          >
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
