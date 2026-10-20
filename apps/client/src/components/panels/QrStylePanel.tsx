import type { QrItem } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Floating editor for a selected QR code: content, code color, background. */
export function QrStylePanel() {
  // Selection subscribed REACTIVELY (switching item→item keeps length at 1,
  // so a length-only subscription leaves a stale panel behind).
  const selectedId = useSessionStore((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const item = useDocumentStore((s) => {
    const candidate = selectedId ? s.doc.items[selectedId] : undefined;
    return candidate?.type === 'qr' && !candidate.locked ? (candidate as QrItem) : null;
  });
  const sheetOpen = useSessionStore((s) => s.mobileStyleSheetOpen);

  if (!item) return null;

  const set = (label: string, recipe: (draft: QrItem) => void) =>
    updateItems([item.id], label, (draft) => {
      if (draft.type === 'qr') recipe(draft);
    });

  return (
    <div
      className={`link-style-panel${sheetOpen ? ' mobile-open' : ''}`}
      data-testid="qr-style-panel"
    >
      <input
        className="lsp-input lsp-url"
        value={item.text}
        placeholder="Text or URL"
        spellCheck={false}
        aria-label="QR content"
        data-testid="qr-text"
        onChange={(e) => set('QR content', (d) => (d.text = e.target.value))}
      />
      <label className="color-control" title="Code color">
        ▦
        <input
          type="color"
          value={item.color}
          data-testid="qr-color"
          onChange={(e) => set('QR color', (d) => (d.color = e.target.value))}
        />
      </label>
      <label className="color-control" title="Background color">
        ▢
        <input
          type="color"
          value={item.background}
          data-testid="qr-bg"
          onChange={(e) => set('QR background', (d) => (d.background = e.target.value))}
        />
      </label>
    </div>
  );
}
