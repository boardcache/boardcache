import { useEffect, useRef, useState } from 'react';
import type { TextItem } from '@boardcache/schema';
import { collabNotifyDraft } from '../../lib/sync/collab';
import { useCollabStore } from '../../state/collabStore';
import { updateItems } from '../../state/commands';
import {
  measureMarkdownHeight,
  renderMarkdown,
  useHighlightTick,
  taskIndexFromTarget,
  toggleTaskAt,
} from '../../lib/text/markdown';
import { textStyle, V_JUSTIFY } from '../items/TextContent';
import { MarkdownEditor } from '../panels/MarkdownEditor';
import { MarkdownToolbar } from '../panels/MarkdownToolbar';
import { TextBoxControls } from '../panels/TextBoxControls';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { EyeIcon, PencilIcon } from '../icons';

type Mode = 'edit' | 'preview' | 'split';
const MD_WIDTH_KEY = 'boardcache:lightbox-md-width';
const MD_MIN_WIDTH = 420;
const MODES: Mode[] = ['edit', 'preview', 'split'];
const MODE_LABEL: Record<Mode, string> = { edit: 'Edit', preview: 'Preview', split: 'Split' };

/** Full-size markdown editor for a text item, with Edit / Preview / Split. */
export function LightboxText({ item }: { item: TextItem }) {
  useHighlightTick(); // refresh fences when the code highlighter (un)loads
  const [mode, setMode] = useState<Mode>('preview');
  const [draft, setDraft] = useState(item.text);
  // Desktop: the stage fills the lightbox; a handle on either side narrows
  // it symmetrically for reading, and the width is remembered.
  const rootRef = useRef<HTMLDivElement>(null);
  const [mdWidth, setMdWidth] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(MD_WIDTH_KEY));
      return v >= MD_MIN_WIDTH ? v : null;
    } catch {
      return null;
    }
  });
  const startResize = (e: React.PointerEvent, dir: 1 | -1) => {
    const root = rootRef.current;
    if (!root || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = root.getBoundingClientRect().width;
    const max = root.parentElement?.clientWidth ?? startW;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let w = startW;
    const move = (ev: PointerEvent) => {
      // Both edges move: the box stays centred and only its width changes.
      w = Math.round(
        Math.min(max, Math.max(MD_MIN_WIDTH, startW + dir * 2 * (ev.clientX - startX))),
      );
      setMdWidth(w >= max - 2 ? null : w);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try {
        if (w >= max - 2) localStorage.removeItem(MD_WIDTH_KEY);
        else localStorage.setItem(MD_WIDTH_KEY, String(w));
      } catch {
        /* unavailable storage: the width lasts the session */
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const resetWidth = () => {
    setMdWidth(null);
    try {
      localStorage.removeItem(MD_WIDTH_KEY);
    } catch {
      /* ignore */
    }
  };
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  // A peer typing in this box right now (team boards): mirror their
  // keystrokes in the preview while our own draft is untouched.
  const remoteDraft = useCollabStore((s) => s.remoteDrafts[item.id]?.text);

  // A peer committed new text while we weren't editing → follow it. (An
  // in-progress local edit keeps priority; commit resolves last-write-wins.)
  const [seenText, setSeenText] = useState(item.text);
  if (item.text !== seenText) {
    const untouched = draft === seenText;
    setSeenText(item.text);
    if (untouched) setDraft(item.text);
  }

  const flush = () => {
    const text = draftRef.current;
    collabNotifyDraft(item.id, null); // peers switch to the committed text
    if (text === item.text) return;
    // Grow to fit new content, but never shrink the box the user sized.
    const measured = measureMarkdownHeight(text || ' ', item.width, item.fontSize, item.fontFamily);
    const height = Math.max(item.height, measured);
    updateItems([item.id], 'Edit text', (d) => {
      if (d.type !== 'text') return;
      d.text = text;
      d.height = height;
    });
  };

  // Commit on close / navigate away.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeMode = (m: Mode) => {
    if (m === 'preview') flush(); // entering preview shows the saved render
    setMode(m);
  };

  const showEditor = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';
  // Phones: no room for Split, so one button flips between editing and
  // reading; it sits with the style row, where the thumb already is.
  const mobile = useMobileViewport();
  const modeToggle = mobile ? (
    <button
      type="button"
      className={`lightbox-md-toggle${showEditor ? ' active' : ''}`}
      aria-pressed={showEditor}
      aria-label={showEditor ? 'Preview' : 'Edit'}
      title={showEditor ? 'Preview' : 'Edit'}
      data-testid="md-mode-toggle"
      onClick={() => changeMode(showEditor ? 'preview' : 'edit')}
    >
      {showEditor ? <EyeIcon size={16} /> : <PencilIcon size={16} />}
    </button>
  ) : null;

  // Split view: keep the two panes scroll-synced proportionally (the sides
  // have different heights, so ratios are the best shared coordinate).
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'split') return;
    const body = bodyRef.current;
    const ta = body?.querySelector('textarea');
    const pv = body?.querySelector<HTMLElement>('.lightbox-md-preview');
    if (!ta || !pv) return;
    let lock: 'ta' | 'pv' | null = null;
    let unlock = 0;
    const sync = (from: HTMLElement, to: HTMLElement, tag: 'ta' | 'pv') => () => {
      if (lock && lock !== tag) return; // echo from our own write — ignore
      lock = tag;
      window.clearTimeout(unlock);
      unlock = window.setTimeout(() => (lock = null), 120);
      const denomFrom = from.scrollHeight - from.clientHeight;
      const denomTo = to.scrollHeight - to.clientHeight;
      if (denomFrom <= 0 || denomTo <= 0) return;
      to.scrollTop = (from.scrollTop / denomFrom) * denomTo;
    };
    const fromEditor = sync(ta, pv, 'ta');
    const fromPreview = sync(pv, ta, 'pv');
    ta.addEventListener('scroll', fromEditor, { passive: true });
    pv.addEventListener('scroll', fromPreview, { passive: true });
    return () => {
      ta.removeEventListener('scroll', fromEditor);
      pv.removeEventListener('scroll', fromPreview);
      window.clearTimeout(unlock);
    };
  }, [mode]);

  return (
    <div
      className="lightbox-md"
      data-testid="lightbox-md"
      ref={rootRef}
      style={mdWidth ? ({ '--lb-md-w': `${mdWidth}px` } as React.CSSProperties) : undefined}
    >
      <div
        className="lightbox-md-handle left"
        title="Drag to set the width; double-click for full width"
        data-testid="lightbox-md-handle-left"
        onPointerDown={(e) => startResize(e, -1)}
        onDoubleClick={resetWidth}
      />
      <div
        className="lightbox-md-handle right"
        title="Drag to set the width; double-click for full width"
        data-testid="lightbox-md-handle-right"
        onPointerDown={(e) => startResize(e, 1)}
        onDoubleClick={resetWidth}
      />
      <div className="lightbox-md-bar">
        {/* Row 1: content — mode switch + markdown formatting. On phones
            the switch lives in the style row, so this row exists only while
            the formatting toolbar has something to show. */}
        {(!mobile || showEditor) && (
          <div className="lmb-row">
            {!mobile && (
              <div className="lightbox-md-modes">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={mode === m ? 'active' : ''}
                    onClick={() => changeMode(m)}
                    data-testid={`md-mode-${m}`}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
            {showEditor && <MarkdownToolbar />}
          </div>
        )}
        {/* Row 2: the box — font, size, alignment, colors. */}
        <div className="lmb-row lmb-row-style">
          <TextBoxControls item={item} compact={mobile} leading={modeToggle} />
        </div>
      </div>

      <div className={`lightbox-md-body mode-${mode}`} ref={bodyRef}>
        {showEditor && (
          <MarkdownEditor
            value={draft}
            onChange={(v) => {
              setDraft(v);
              collabNotifyDraft(item.id, v); // live typing for team-board peers
            }}
            onDone={() => changeMode('preview')}
            commitOnBlur={false}
            autoFocus={mode === 'edit'}
            placeholder="Markdown (press / for commands)"
            className="lightbox-md-source"
            style={{ fontFamily: item.fontFamily }}
            testId="lightbox-text-editor"
          />
        )}
        {showPreview && (
          <div
            className="lightbox-md-preview"
            style={{
              ...textStyle(item),
              display: 'flex',
              flexDirection: 'column',
              justifyContent: `safe ${V_JUSTIFY[item.verticalAlign]}`,
            }}
            data-testid="lightbox-text-preview"
            onClick={(e) => {
              const idx = taskIndexFromTarget(e.target);
              if (idx === null) return;
              setDraft((d) => toggleTaskAt(d, idx));
            }}
          >
            <div
              className="md-rendered"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(
                  (remoteDraft !== undefined && draft === item.text ? remoteDraft : draft).trim()
                    ? remoteDraft !== undefined && draft === item.text
                      ? remoteDraft
                      : draft
                    : '_Empty text_',
                ),
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
