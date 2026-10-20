import type { LinkItem } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Floating editor for a selected link button: label, URL, background. */
export function LinkStylePanel() {
  // Selection subscribed REACTIVELY (switching item→item keeps length at 1,
  // so a length-only subscription leaves a stale panel behind).
  const selectedId = useSessionStore((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const item = useDocumentStore((s) => {
    const candidate = selectedId ? s.doc.items[selectedId] : undefined;
    return candidate?.type === 'link' && !candidate.locked ? (candidate as LinkItem) : null;
  });
  const sheetOpen = useSessionStore((s) => s.mobileStyleSheetOpen);

  if (!item) return null;

  const set = (label: string, recipe: (draft: LinkItem) => void) =>
    updateItems([item.id], label, (draft) => {
      if (draft.type === 'link') recipe(draft);
    });

  return (
    <div
      className={`link-style-panel${sheetOpen ? ' mobile-open' : ''}`}
      data-testid="link-style-panel"
    >
      <input
        className="lsp-input lsp-label"
        value={item.label}
        placeholder="Label"
        aria-label="Link label"
        data-testid="link-label"
        onChange={(e) => set('Link label', (d) => (d.label = e.target.value))}
      />
      <input
        className="lsp-input lsp-url"
        value={item.url}
        placeholder="https://…"
        spellCheck={false}
        aria-label="Link URL"
        data-testid="link-url"
        onChange={(e) => set('Link URL', (d) => (d.url = e.target.value))}
      />
      <label className="color-control" title="Background color">
        <input
          type="color"
          value={item.background}
          aria-label="Background color"
          data-testid="link-bg"
          onChange={(e) => set('Link background', (d) => (d.background = e.target.value))}
        />
      </label>
      <div className="lsp-sizes" role="group" aria-label="Label size">
        {(
          [
            { v: 's', label: 'S', title: 'Small' },
            { v: 'm', label: 'M', title: 'Medium' },
            { v: 'l', label: 'L', title: 'Large' },
          ] as const
        ).map(({ v, label, title }) => (
          <button
            key={v}
            type="button"
            className={item.size === v ? 'active' : ''}
            title={title}
            aria-pressed={item.size === v}
            data-testid={`link-size-${v}`}
            onClick={() => set('Link size', (d) => (d.size = v))}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="lsp-open"
        disabled={!item.url}
        title="Open link in a new tab"
        data-testid="link-open"
        onClick={() => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}
      >
        Open ↗
      </button>
    </div>
  );
}
