import { safeHttpUrl } from '../../lib/text/safeUrl';
import { useState } from 'react';
import type { IframeItem } from '@boardcache/schema';
import { captureIframePoster } from '../../lib/media/iframePoster';
import { updateItems } from '../../state/commands';
import { useAssetUrl } from '../../hooks/useAssetUrl';

/** Add https:// when the user types a bare host. */
function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  // Only web pages embed; a scheme that could run script in our origin is dropped.
  return safeHttpUrl(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`) ?? '';
}

/**
 * Resizable webpage embed. The address bar (always interactive, above the page)
 * navigates the iframe. A server-rendered poster is captured on load (and
 * refreshable via 📷) for the gallery thumbnail and exports — and it stands in
 * for the page on the canvas until "Interact" mounts the live iframe (a live
 * page per item is what runs phones out of memory); Done unmounts it again.
 * Without a poster the live page shows from the start behind a shield, so
 * canvas gestures still win. Sites that forbid framing (X-Frame-Options/CSP)
 * won't load live but can still be captured server-side.
 */
export function IframeContent({
  item,
  lightbox = false,
}: {
  item: IframeItem;
  /** In the lightbox there's no canvas to guard, so the page is always live
   *  (no shield / Interact toggle). */
  lightbox?: boolean;
}) {
  const [draft, setDraft] = useState(item.url);
  const [interactive, setInteractive] = useState(false);
  const [shooting, setShooting] = useState(false);
  const isInteractive = lightbox || interactive;
  const posterUrl = useAssetUrl(item.posterAssetId);
  // A poster whose bytes never arrived (a preview of an older publication,
  // a device missing the asset) must not leave a broken image: go live.
  const [posterBroken, setPosterBroken] = useState(false);
  const live = isInteractive || !posterUrl || posterBroken;

  // Keep the address bar in sync when the URL changes elsewhere (undo, etc.).
  // Render-phase reset when the stored URL changes (no setState-in-effect).
  const [seenUrl, setSeenUrl] = useState(item.url);
  if (seenUrl !== item.url) {
    setSeenUrl(item.url);
    setDraft(item.url);
  }

  const navigate = () => {
    const url = normalizeUrl(draft);
    setDraft(url);
    if (url !== item.url) {
      updateItems([item.id], 'Set webpage URL', (d) => {
        if (d.type === 'iframe') d.url = url;
      });
      void captureIframePoster(item.id);
    }
  };

  // Refresh the server-rendered poster.
  const screenshot = async () => {
    setShooting(true);
    try {
      await captureIframePoster(item.id);
    } finally {
      setShooting(false);
    }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="iframe-embed" data-testid="iframe-embed">
      <div className="iframe-bar" onPointerDown={stop} onDoubleClick={stop}>
        <input
          className="iframe-url"
          value={draft}
          placeholder="https://…"
          spellCheck={false}
          data-testid="iframe-url"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') navigate();
          }}
        />
        <button type="button" onClick={navigate} title="Go" data-testid="iframe-go">
          Go
        </button>
        {!lightbox && (
          <button
            type="button"
            className={interactive ? 'active' : ''}
            data-view-ok=""
            onClick={() => setInteractive((v) => !v)}
            title={interactive ? 'Stop interacting' : 'Interact with the page'}
            data-testid="iframe-interact"
          >
            {interactive ? 'Done' : 'Interact'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void screenshot()}
          disabled={shooting}
          title="Refresh the page snapshot (used in the gallery + exports)"
          data-testid="iframe-shot"
        >
          {shooting ? '…' : '📷'}
        </button>
      </div>

      <div className="iframe-frame-wrap">
        {!item.url ? (
          <div className="iframe-empty">Enter a URL above to load a page</div>
        ) : live ? (
          <iframe
            className="iframe-frame"
            src={safeHttpUrl(item.url) ?? 'about:blank'}
            title={item.url}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-popups"
          />
        ) : (
          <img
            className="iframe-poster"
            src={posterUrl}
            alt={item.url}
            draggable={false}
            onError={() => setPosterBroken(true)}
          />
        )}
        {live && !isInteractive && <div className="iframe-shield" data-testid="iframe-shield" />}
      </div>
    </div>
  );
}
