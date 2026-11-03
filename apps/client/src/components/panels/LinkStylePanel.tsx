import type { LinkItem } from '@boardcache/schema';
import { SunMoonIcon } from '../icons';
import { isThemeLink, linkPaintColors } from '../../lib/color/linkColors';
import { openUrl } from '../../lib/text/itemUrl';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { BackgroundWell } from './colorWells';

/** Floating editor for a selected link button: label, URL, background. The
 *  background well is the text boxes' one, with "Theme color" as its reset. */
export function LinkStylePanel() {
  // Selection subscribed REACTIVELY (switching item→item keeps length at 1,
  // so a length-only subscription leaves a stale panel behind).
  const selectedId = useSessionStore((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const item = useDocumentStore((s) => {
    const candidate = selectedId ? s.doc.items[selectedId] : undefined;
    return candidate?.type === 'link' && !candidate.locked ? (candidate as LinkItem) : null;
  });
  const sheetOpen = useSessionStore((s) => s.mobileStyleSheetOpen);
  const dark = resolveTheme(useSessionStore((s) => s.theme)) === 'dark';

  if (!item) return null;

  const set = (label: string, recipe: (draft: LinkItem) => void) =>
    updateItems([item.id], label, (draft) => {
      if (draft.type === 'link') recipe(draft);
    });
  const themed = isThemeLink(item);

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
        placeholder="https://"
        spellCheck={false}
        aria-label="Link URL"
        data-testid="link-url"
        onChange={(e) => set('Link URL', (d) => (d.url = e.target.value))}
      />
      <BackgroundWell
        hex={linkPaintColors(item, dark).background}
        alpha={1}
        opacity={false}
        onChange={(hex) => set('Link background', (d) => (d.background = hex))}
        onReset={() => set('Link background', (d) => (d.background = 'auto'))}
        resetLabel="Theme color"
        resetTestId="link-bg-auto"
        label="Button color"
        testId="link-bg"
        historyLabel="Link background"
      />
      {!themed && (
        <button
          type="button"
          className="lsp-theme"
          onClick={() => set('Link background', (d) => (d.background = 'auto'))}
          title="Reset to the theme color"
          aria-label="Reset to the theme color"
          data-testid="link-theme-reset"
        >
          <SunMoonIcon size={16} />
        </button>
      )}
      <button
        type="button"
        className="lsp-open"
        disabled={!item.url}
        title="Open link in a new tab"
        data-testid="link-open"
        onClick={() => openUrl(item.url)}
      >
        Open ↗
      </button>
    </div>
  );
}
