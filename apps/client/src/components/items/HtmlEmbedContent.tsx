import { useState } from 'react';
import type { HtmlEmbedItem } from '@boardcache/schema';
import { useAssetText } from '../../hooks/useAssetUrl';
import { FileTextIcon } from '../icons';

/**
 * Generic local-HTML embed. The self-contained HTML asset renders in a
 * sandboxed iframe (scripts disabled, null origin — safe for static document
 * markup). A shield covers it so canvas gestures (pan/select/drag) win until
 * the user taps "Interact"; in the lightbox it's always live.
 */
export function HtmlEmbedContent({
  item,
  lightbox = false,
}: {
  item: HtmlEmbedItem;
  lightbox?: boolean;
}) {
  const html = useAssetText(item.htmlAssetId);
  const [interactive, setInteractive] = useState(false);
  const live = lightbox || interactive;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="htmlembed" data-testid="htmlembed">
      <div className="htmlembed-bar" onPointerDown={stop} onDoubleClick={stop}>
        <span className="htmlembed-title">
          <FileTextIcon size={13} />
          {item.title ?? 'Document'}
        </span>
        {!lightbox && (
          <button
            type="button"
            className={interactive ? 'active' : ''}
            data-testid="htmlembed-interact"
            title={interactive ? 'Stop interacting' : 'Scroll the document'}
            onPointerDown={stop}
            onClick={() => setInteractive((v) => !v)}
          >
            {interactive ? 'Done' : 'Interact'}
          </button>
        )}
      </div>
      <div className="htmlembed-frame-wrap">
        {html !== null ? (
          <iframe
            className="htmlembed-frame"
            data-testid="htmlembed-frame"
            // Inlined via srcdoc: a sandbox="" iframe has an opaque origin and
            // Chromium refuses blob:/local URLs there ("Not allowed to load
            // local resource"). srcdoc keeps the zero-privilege sandbox.
            srcDoc={html}
            sandbox=""
            title={item.title ?? 'Document'}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="htmlembed-loading">Loading</div>
        )}
        {!live && <div className="htmlembed-shield" data-testid="htmlembed-shield" />}
      </div>
    </div>
  );
}
