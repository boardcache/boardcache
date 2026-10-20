import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { ExpandIcon } from '../icons';
import { MarkdownToolbar } from './MarkdownToolbar';
import { TextBoxControls } from './TextBoxControls';

/** Floating controls for a selected text item: markdown formatting + box style. */
export function TextStylePanel() {
  // Selection subscribed REACTIVELY (switching item→item keeps length at 1,
  // so a length-only subscription leaves a stale panel behind).
  const selectedId = useSessionStore((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const item = useDocumentStore((s) => {
    const candidate = selectedId ? s.doc.items[selectedId] : undefined;
    return candidate?.type === 'text' && !candidate.locked ? candidate : null;
  });
  const editing = useSessionStore((s) => s.editingItemId === (item?.id ?? ''));

  if (!item) return null;

  return (
    <div className="text-style-panel" data-testid="text-style-panel">
      {/* Row 1: content — markdown formatting (active while editing the
          source) and the jump to the full lightbox editor. */}
      <div className="tsp-row">
        <MarkdownToolbar disabled={!editing} />
        <span className="tsp-spacer" aria-hidden />
        <button
          type="button"
          className="tsp-expand"
          title="Open in lightbox editor"
          aria-label="Open in lightbox editor"
          data-testid="text-open-lightbox"
          onClick={() => useSessionStore.getState().setLightbox(item.id)}
        >
          <ExpandIcon size={15} />
        </button>
      </div>
      {/* Row 2: the box — font, size, alignment, colors. */}
      <div className="tsp-row tsp-row-style">
        <TextBoxControls item={item} />
      </div>
    </div>
  );
}
