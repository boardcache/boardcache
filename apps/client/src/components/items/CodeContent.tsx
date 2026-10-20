import { useEffect, useRef, useState } from 'react';
import type { CodeItem } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';
import { CODE_LANGUAGES } from '../../lib/text/codeLangs';
import { ExpandIcon, PencilIcon } from '../icons';
import type { CodeEditorHandle } from '../../lib/text/codeEditor';
import { CopyIcon } from '../icons';

/**
 * Live code snippet item. Display mode is a statically highlighted block
 * (lazy Prism, same theme variables as markdown fences); double-click swaps
 * in a CodeMirror editor that highlights AS YOU TYPE. The header bar carries
 * the language picker and a copy button. Edits commit on blur/Escape as one
 * undo step.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Statically highlighted HTML (escaped fallback until Prism arrives). */
export function useHighlightedHtml(code: string, language: string): string {
  const [html, setHtml] = useState(() => escapeHtml(code));
  useEffect(() => {
    let alive = true;
    // Microtask keeps the effect body free of sync setState (lint rule).
    void Promise.resolve().then(() => {
      if (alive) setHtml(escapeHtml(code));
    });
    if (!language) {
      return () => {
        alive = false;
      };
    }
    void import('../../lib/text/codeHighlight').then((mod) => {
      if (!alive) return;
      const highlighted = mod.highlightCode(code, language);
      if (highlighted !== null) setHtml(highlighted);
    });
    return () => {
      alive = false;
    };
  }, [code, language]);
  return html;
}

export function CodeContent({ item, lightbox = false }: { item: CodeItem; lightbox?: boolean }) {
  const editing = useSessionStore((s) => s.editingItemId === item.id);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const [copied, setCopied] = useState(false);
  // Lightbox editing is local to the lightbox (canvas editing uses the
  // session's editingItemId).
  const [editHere, setEditHere] = useState(false);
  const showEditor = lightbox ? editHere : editing;

  const copy = () => {
    void navigator.clipboard?.writeText(item.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="code-item" data-testid="code-item" style={{ fontSize: item.fontSize }}>
      {/* The bar itself drags the item; only its controls swallow events. */}
      <div className="code-bar">
        <select
          className="code-bar-lang"
          value={item.language}
          onPointerDown={stop}
          onDoubleClick={stop}
          data-testid="code-item-language"
          onChange={(e) =>
            updateItems([item.id], 'Change code language', (d) => {
              if (d.type === 'code') d.language = e.target.value;
            })
          }
        >
          {CODE_LANGUAGES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <span className="code-bar-actions" onPointerDown={stop} onDoubleClick={stop}>
          <button
            type="button"
            className="code-bar-copy"
            title="Smaller text"
            aria-label="Smaller text"
            data-testid="code-size-minus"
            disabled={item.fontSize <= 8}
            onClick={() =>
              updateItems([item.id], 'Change code font size', (d) => {
                if (d.type === 'code') d.fontSize = Math.max(8, d.fontSize - 1);
              })
            }
          >
            A−
          </button>
          <span className="code-size-label" data-testid="code-size-label">
            {item.fontSize}
          </span>
          <button
            type="button"
            className="code-bar-copy"
            title="Larger text"
            aria-label="Larger text"
            data-testid="code-size-plus"
            disabled={item.fontSize >= 40}
            onClick={() =>
              updateItems([item.id], 'Change code font size', (d) => {
                if (d.type === 'code') d.fontSize = Math.min(40, d.fontSize + 1);
              })
            }
          >
            A+
          </button>
          {lightbox ? (
            <button
              type="button"
              className={`code-bar-copy${editHere ? ' active' : ''}`}
              title={editHere ? 'Done editing' : 'Edit code'}
              aria-label={editHere ? 'Done editing' : 'Edit code'}
              data-testid="code-lightbox-edit"
              onClick={() => setEditHere(!editHere)}
            >
              {editHere ? 'Done' : <PencilIcon size={14} />}
            </button>
          ) : (
            <button
              type="button"
              className="code-bar-copy"
              title="Open in lightbox"
              aria-label="Open in lightbox"
              data-testid="code-item-lightbox"
              data-view-ok=""
              onClick={() => useSessionStore.getState().setLightbox(item.id)}
            >
              <ExpandIcon size={14} />
            </button>
          )}
          <button
            type="button"
            className="code-bar-copy"
            title="Copy code"
            aria-label="Copy code"
            data-testid="code-item-copy"
            onClick={copy}
          >
            {copied ? '✓' : <CopyIcon size={14} />}
          </button>
        </span>
      </div>
      {showEditor ? (
        <CodeEditorPane item={item} {...(lightbox ? { onExit: () => setEditHere(false) } : {})} />
      ) : (
        <CodeStatic item={item} />
      )}
    </div>
  );
}

function CodeStatic({ item }: { item: CodeItem }) {
  const html = useHighlightedHtml(item.code, item.language);
  return (
    <pre className="code-static" data-testid="code-static">
      <code
        className={item.language ? `language-${item.language}` : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

/** CodeMirror mounts lazily; edits land as ONE history entry on exit. */
function CodeEditorPane({ item, onExit }: { item: CodeItem; onExit?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  // The item as of editing start; the commit diffs against this.
  const initial = useRef(item.code);

  const commit = (value: string | undefined) => {
    if (value !== undefined && value !== initial.current) {
      updateItems([item.id], 'Edit code', (d) => {
        if (d.type === 'code') d.code = value;
      });
      initial.current = value;
    }
  };

  const commitAndClose = () => {
    commit(editorRef.current?.getValue());
    if (onExit) {
      onExit();
    } else {
      const s = useSessionStore.getState();
      if (s.editingItemId === item.id) s.setEditingItemId(null);
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    void import('../../lib/text/codeEditor').then((mod) => {
      if (!alive || !hostRef.current) return;
      editorRef.current = mod.createCodeEditor(hostRef.current, {
        doc: initial.current,
        language: item.language,
        onBlur: commitAndClose,
        onEscape: commitAndClose,
      });
      editorRef.current.view.focus();
    });
    return () => {
      alive = false;
      // Safety net: whatever closes the editor (Done button, unmount,
      // language switch) still commits the pending text.
      const value = editorRef.current?.getValue();
      editorRef.current?.destroy();
      editorRef.current = null;
      commit(value);
    };
    // Remount the editor if the language changes mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.language]);

  return (
    <div
      ref={hostRef}
      className="code-editor-host"
      data-testid="code-editor"
      // Keep canvas shortcuts/gestures out of the editor.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    />
  );
}
