import { useLayoutEffect, useRef, useState } from 'react';
import { produce } from 'immer';
import type { TextItem } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { collabNotifyDraft } from '../../lib/sync/collab';
import { readableTextColor, splitHexAlpha } from '../../lib/color/color';
import { useCollabStore } from '../../state/collabStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import {
  measureMarkdownHeight,
  renderMarkdown,
  taskIndexFromTarget,
  toggleTaskAt,
  useHighlightTick,
} from '../../lib/text/markdown';
import { MarkdownEditor } from '../panels/MarkdownEditor';

/** Resolve the 'default' sentinel against the theme (live CSS var). */
function textColor(item: TextItem): string {
  if (item.color !== 'default') return item.color;
  // Card ink pairs with the CARD ('auto' background). A transparent box sits
  // on the canvas, so its default ink is the theme text color — it flips with
  // light/dark mode. Default ink over an explicit card picks whichever of
  // black/white reads against that card.
  if (item.background === 'auto') return 'var(--new-text-ink, var(--text-primary))';
  if (item.background === null) return 'var(--text-primary)';
  // A mostly-transparent card is really the canvas showing through.
  const { hex, alpha } = splitHexAlpha(item.background);
  if (alpha < 0.5) return 'var(--text-primary)';
  return readableTextColor(hex);
}

/** Resolve the background: 'auto' follows the theme live; null is transparent. */
function textBackground(item: TextItem): string {
  if (item.background === 'auto') return 'var(--new-text-bg, var(--panel-solid))';
  return item.background ?? 'transparent';
}

export const V_JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

/** Box-level styling (font, color, alignment, background) — not the content. */
export function textStyle(item: TextItem): React.CSSProperties {
  return {
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    color: textColor(item),
    textAlign: item.align,
    background: textBackground(item),
  };
}

/**
 * Markdown text item. Double-click edits the raw markdown source; leaving the
 * editor renders the markdown preview (commit text + measured height as one
 * command). While editing, keys stay local so canvas shortcuts don't fire.
 */
export function TextContent({ item }: { item: TextItem }) {
  const editing = useSessionStore((s) => s.editingItemId === item.id);
  // A peer typing in this box right now (team boards): show their keystrokes.
  const remoteDraft = useCollabStore((s) => s.remoteDrafts[item.id]?.text);
  useHighlightTick(); // re-render fences when the code highlighter (un)loads
  const streaming = useSessionStore((s) => s.aiGenerations[item.id] === 'streaming');
  const scrollRef = useRef<HTMLDivElement>(null);

  // While a response streams in, keep the newest text pinned to the bottom.
  useLayoutEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  if (editing) {
    return <TextEditor item={item} />;
  }

  // Display: rendered markdown, vertically aligned within the box.
  return (
    <div
      ref={scrollRef}
      className="text-item"
      style={{
        ...textStyle(item),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: V_JUSTIFY[item.verticalAlign],
      }}
    >
      {item.text.trim() === '' ? (
        <span className="text-empty">Double-click to write</span>
      ) : (
        <div
          className="md-rendered"
          // A click on a task checkbox toggles it instead of selecting/moving.
          onPointerDown={(e) => {
            if (taskIndexFromTarget(e.target) !== null) e.stopPropagation();
          }}
          onDoubleClick={(e) => {
            if (taskIndexFromTarget(e.target) !== null) e.stopPropagation();
          }}
          onClick={(e) => {
            const idx = taskIndexFromTarget(e.target);
            if (idx === null) return;
            e.stopPropagation();
            const next = toggleTaskAt(item.text, idx);
            if (next !== item.text) {
              updateItems([item.id], 'Toggle task', (d) => {
                if (d.type === 'text') d.text = next;
              });
            }
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(remoteDraft ?? item.text) }}
        />
      )}
    </div>
  );
}

function TextEditor({ item }: { item: TextItem }) {
  const [draft, setDraft] = useState(item.text);
  // The box height before this edit session — the floor the box never drops
  // below (item.height drifts live while auto-grow editing for alignment).
  // Mount-constant state (not a ref): it's read during render.
  const [baseHeight] = useState(item.height);

  // Keep item.height synced to the live editor height so the bounding box and
  // the content box stay aligned while typing (auto-height boxes only).
  const syncHeight = (h: number) => {
    const { doc, replaceDoc } = useDocumentStore.getState();
    const it = doc.items[item.id];
    if (!it || it.type !== 'text' || it.height === h) return;
    replaceDoc(
      produce(doc, (d) => {
        const t = d.items[item.id];
        if (t?.type === 'text') t.height = h;
      }),
    );
  };

  const commit = () => {
    collabNotifyDraft(item.id, null); // peers switch to the committed text
    useSessionStore.getState().setEditingItemId(null);
    const text = draft;
    // An empty box stays on the canvas (placeholder shows) — clicking away
    // before typing shouldn't destroy the area you just made.
    // Auto-height boxes fit their content (grow-only); fixed boxes keep size.
    const measured = measureMarkdownHeight(text, item.width, item.fontSize, item.fontFamily);
    const height = item.autoHeight ? Math.max(baseHeight, measured) : baseHeight;
    if (text !== item.text || height !== item.height) {
      updateItems([item.id], 'Edit text', (draftItem) => {
        if (draftItem.type !== 'text') return;
        draftItem.text = text;
        draftItem.height = height;
      });
    }
  };

  return (
    <MarkdownEditor
      value={draft}
      onChange={(v) => {
        setDraft(v);
        collabNotifyDraft(item.id, v); // live typing for team-board peers
      }}
      onDone={commit}
      autoFocus
      autoGrow={item.autoHeight}
      {...(item.autoHeight ? { onHeight: syncHeight } : {})}
      placeholder="Markdown (press / for commands)"
      className="text-item text-item-editing"
      // Auto-height: fill at least the box and grow with content. Fixed: fill
      // the box exactly and scroll, so editing never changes the box size.
      style={{
        ...textStyle(item),
        ...(item.autoHeight
          ? { minHeight: baseHeight }
          : { height: item.height, overflowY: 'auto' }),
      }}
      testId="text-editor"
    />
  );
}
