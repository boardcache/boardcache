import { useEffect, useRef } from 'react';
import type { TitleItem } from '@boardcache/schema';
import { titleFontSize, titlePadding, TITLE_LINE_HEIGHT } from '../../lib/text/titleFit';
import { updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Title item: display text with no stored font size — it scales to fit the
 * box, so the resize handles ARE the size control. Double-click edits in
 * place; the textarea inherits the fitted size so editing feels live.
 */

const JUSTIFY: Record<TitleItem['alignV'], string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

function TitleEditor({ item, fontSize }: { item: TitleItem; fontSize: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const draft = useRef(item.text);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const commit = () => {
    const text = draft.current.replace(/\n+$/g, '');
    useSessionStore.getState().setEditingItemId(null);
    if (text !== item.text) {
      updateItems([item.id], 'Edit title', (d) => {
        if (d.type === 'title') d.text = text || 'Title';
      });
    }
  };

  return (
    <textarea
      ref={ref}
      className="title-editor"
      wrap="off"
      defaultValue={item.text}
      data-testid="title-editor"
      style={{
        fontSize,
        lineHeight: TITLE_LINE_HEIGHT,
        fontFamily: item.fontFamily,
        fontWeight: item.bold ? 700 : 400,
        fontStyle: item.italic ? 'italic' : 'normal',
        textAlign: item.alignH,
        color: item.color ?? 'var(--text-primary)',
      }}
      onChange={(e) => (draft.current = e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          commit();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

export function TitleContent({ item }: { item: TitleItem }) {
  const editing = useSessionStore((s) => s.editingItemId === item.id);
  // Track the live resize gesture so the type scales WITH the box instead of
  // jumping to the new fit on release.
  const override = useSessionStore((s) => s.gesture?.overrides[item.id]);
  const w = override?.width ?? item.width;
  const h = override?.height ?? item.height;
  const pad = titlePadding(w, h);
  const fontSize = titleFontSize(item, w, h);

  return (
    <div
      className="title-item"
      data-testid="title-item"
      style={{
        padding: pad,
        background: item.background ?? 'transparent',
        justifyContent: JUSTIFY[item.alignV],
      }}
    >
      {editing ? (
        <TitleEditor item={item} fontSize={fontSize} />
      ) : (
        <div
          className="title-text"
          style={{
            fontSize,
            lineHeight: TITLE_LINE_HEIGHT,
            fontFamily: item.fontFamily,
            fontWeight: item.bold ? 700 : 400,
            fontStyle: item.italic ? 'italic' : 'normal',
            textAlign: item.alignH,
            color: item.color ?? 'var(--text-primary)',
          }}
        >
          {item.text || 'Title'}
        </div>
      )}
    </div>
  );
}
