import { flipImageH, flipImageV } from '../../lib/media/imageActions';
import { isPanoImage } from '../../lib/media/pano';
import { DEFAULT_FILTERS, FILTER_CONTROLS, normalizeFilters } from '../../lib/media/imageFilters';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

type NumericFilterKey = (typeof FILTER_CONTROLS)[number]['key'];

/**
 * Adjustments for a single selected image: brightness/contrast/saturation/
 * grayscale sliders, invert, and flips. Slider drags write a live preview to
 * session state (no history) and commit ONE undo step on release.
 */
export function ImageAdjustmentsPanel() {
  const id = useSessionStore((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const item = useDocumentStore((s) => (id ? s.doc.items[id] : null));
  const preview = useSessionStore((s) => s.filterPreview);
  const setFilterPreview = useSessionStore((s) => s.setFilterPreview);
  const mobileOpen = useSessionStore((s) => s.mobileAdjustOpen);

  if (!item || item.type !== 'image' || item.locked) return null;

  const current = preview?.id === item.id ? preview.filters : (item.filters ?? DEFAULT_FILTERS);
  const pano = isPanoImage(item);

  const live = (key: NumericFilterKey, value: number) =>
    setFilterPreview({ id: item.id, filters: { ...current, [key]: value } });

  const commit = (label: string) => {
    const pending = useSessionStore.getState().filterPreview;
    setFilterPreview(null);
    if (pending?.id === item.id) {
      updateItems([item.id], label, (it) => {
        if (it.type === 'image') it.filters = normalizeFilters(pending.filters);
      });
    }
  };

  const setNow = (filters: typeof current, label: string) => {
    setFilterPreview(null);
    updateItems([item.id], label, (it) => {
      if (it.type === 'image') it.filters = normalizeFilters(filters);
    });
  };

  return (
    <div
      className={`image-adjust-panel${mobileOpen ? ' mobile-open' : ''}`}
      data-testid="image-adjust-panel"
    >
      {FILTER_CONTROLS.map((c) => (
        <label key={c.key} className="iap-slider">
          <span className="iap-label">{c.label}</span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={current[c.key]}
            onChange={(e) => live(c.key, Number(e.target.value))}
            onPointerUp={() => commit(c.label)}
            onKeyUp={() => commit(c.label)}
            data-testid={`iap-${c.key}`}
          />
        </label>
      ))}

      <div className="iap-group">
        <button
          type="button"
          className={`iap-btn${current.invert ? ' active' : ''}`}
          onClick={() => setNow({ ...current, invert: !current.invert }, 'Invert')}
          data-testid="iap-invert"
          title="Invert colors"
        >
          Invert
        </button>
      </div>

      {!pano && (
        <div className="iap-group">
          <button
            type="button"
            className={`iap-btn${item.flipH ? ' active' : ''}`}
            onClick={() => flipImageH(item.id)}
            data-testid="iap-flip-h"
            title="Flip horizontal"
          >
            Flip H
          </button>
          <button
            type="button"
            className={`iap-btn${item.flipV ? ' active' : ''}`}
            onClick={() => flipImageV(item.id)}
            data-testid="iap-flip-v"
            title="Flip vertical"
          >
            Flip V
          </button>
        </div>
      )}

      <button
        type="button"
        className="iap-btn iap-reset"
        onClick={() => setNow(DEFAULT_FILTERS, 'Reset adjustments')}
        data-testid="iap-reset"
        title="Reset adjustments"
      >
        Reset
      </button>

      {!pano && (
        <div className="iap-caption-group">
          <label className="iap-caption-toggle">
            <input
              type="checkbox"
              checked={item.caption}
              data-testid="iap-caption"
              onChange={(e) =>
                updateItems([item.id], 'Caption', (it) => {
                  if (it.type === 'image') it.caption = e.target.checked;
                })
              }
            />
            <span>Caption</span>
          </label>
          {item.caption && (
            <>
              <div className="iap-group iap-corners" role="group" aria-label="Caption corner">
                {(
                  [
                    ['tl', '◤'],
                    ['tr', '◥'],
                    ['bl', '◣'],
                    ['br', '◢'],
                  ] as const
                ).map(([corner, glyph]) => (
                  <button
                    key={corner}
                    type="button"
                    className={`iap-btn${item.captionCorner === corner ? ' active' : ''}`}
                    title={`Caption in the ${corner === 'tl' ? 'top left' : corner === 'tr' ? 'top right' : corner === 'bl' ? 'bottom left' : 'bottom right'}`}
                    data-testid={`iap-caption-${corner}`}
                    onClick={() =>
                      updateItems([item.id], 'Caption corner', (it) => {
                        if (it.type === 'image') it.captionCorner = corner;
                      })
                    }
                  >
                    {glyph}
                  </button>
                ))}
              </div>
              <div className="iap-group" role="group" aria-label="Caption placement">
                {(
                  [
                    ['inside', 'Inside'],
                    ['outside', 'Outside'],
                  ] as const
                ).map(([placement, label]) => (
                  <button
                    key={placement}
                    type="button"
                    className={`iap-btn${item.captionPlacement === placement ? ' active' : ''}`}
                    title={
                      placement === 'inside'
                        ? 'A translucent box over the corner of the image'
                        : 'A bar above or below the image, in the same box'
                    }
                    data-testid={`iap-caption-${placement}`}
                    onClick={() =>
                      updateItems([item.id], 'Caption placement', (it) => {
                        if (it.type === 'image') it.captionPlacement = placement;
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {item.captionPlacement === 'outside' && (
                <div className="iap-group" role="group" aria-label="Caption lines">
                  {(
                    [
                      [true, 'Wrap'],
                      [false, 'One line'],
                    ] as const
                  ).map(([wrap, label]) => (
                    <button
                      key={label}
                      type="button"
                      className={`iap-btn${item.captionWrap === wrap ? ' active' : ''}`}
                      title={
                        wrap
                          ? 'Long captions run onto more lines, up to half the box'
                          : 'One line, clipped to the width of the image'
                      }
                      data-testid={wrap ? 'iap-caption-wrap' : 'iap-caption-oneline'}
                      onClick={() =>
                        updateItems([item.id], 'Caption lines', (it) => {
                          if (it.type === 'image') it.captionWrap = wrap;
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {item.captionPlacement === 'inside' && (
                <label className="iap-slider">
                  <span className="iap-label">Backdrop</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={item.captionOpacity}
                    data-testid="iap-caption-opacity"
                    onChange={(e) =>
                      updateItems([item.id], 'Caption opacity', (it) => {
                        if (it.type === 'image') it.captionOpacity = Number(e.target.value);
                      })
                    }
                  />
                </label>
              )}
              {!item.description?.trim() && (
                <p className="iap-hint">
                  The caption shows the image description — write one in the lightbox’s metadata
                  panel (or Generate Description).
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
