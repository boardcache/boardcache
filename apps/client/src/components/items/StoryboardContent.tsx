import type { StoryboardItem } from '@boardcache/schema';
import { PencilIcon } from '../icons';
import { panelRects, SB_HEADER, SB_META_H, SB_PAD } from '../../lib/structure/storyboardAttach';
import { useSessionStore } from '../../state/sessionStore';
import { useDocumentStore } from '../../state/documentStore';
import type { Item } from '@boardcache/schema';
import { StageThumb } from './TimelineContent';

/**
 * The storyboard card. Panels are drop frames — framed items are ordinary
 * canvas items positioned over the frame by storyboardAttach, so this renders
 * only the chrome: title bar (with the summed runtime), aspect frames with
 * slate lines for empty shots, the metadata strip, and the drop highlight
 * while a drag hovers a panel.
 */

function runtime(sb: StoryboardItem): string | null {
  const secs = sb.panels.reduce((sum, p) => sum + (p.duration ?? 0), 0);
  if (secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function StoryboardContent({ item }: { item: StoryboardItem }) {
  const hover = useSessionStore((s) =>
    s.sbDropHover?.itemId === item.id ? s.sbDropHover.panelId : null,
  );
  const rects = panelRects(item);
  const total = runtime(item);

  const openEditor = () =>
    window.dispatchEvent(
      new CustomEvent('boardcache:edit-storyboard', { detail: { itemId: item.id } }),
    );

  return (
    <div className="storyboard-card" data-testid="storyboard-card">
      <div className="storyboard-header" style={{ height: SB_HEADER }}>
        <span className="storyboard-title">{item.title}</span>
        {total && (
          <span className="storyboard-runtime" data-testid="storyboard-runtime">
            {total}
          </span>
        )}
        <button
          type="button"
          className="storyboard-edit"
          data-testid="storyboard-edit"
          aria-label="Edit storyboard"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openEditor();
          }}
        >
          <PencilIcon size={14} />
        </button>
      </div>
      {item.panels.map((panel, i) => {
        const r = rects[i];
        if (!r) return null;
        const meta = [panel.move, panel.lens, panel.duration != null ? `${panel.duration}s` : '']
          .filter(Boolean)
          .join(' · ');
        return (
          <div
            key={panel.id}
            className={`storyboard-panel${hover === panel.id ? ' storyboard-panel-hover' : ''}`}
            style={{
              left: r.x - item.x,
              top: r.y - item.y,
              width: r.w,
              height: r.h,
            }}
            data-testid="storyboard-panel"
          >
            <div className="storyboard-frame" style={{ height: r.frameH }}>
              {panel.itemIds.length === 0 && (
                <span className="storyboard-frame-empty" aria-hidden>
                  <i />
                  <i />
                </span>
              )}
            </div>
            <div className="storyboard-meta" style={{ height: SB_META_H - 6 }}>
              <span className="storyboard-shot-label">
                <b>{panel.label}</b>
                {panel.scene && <span className="storyboard-scene"> · {panel.scene}</span>}
              </span>
              {panel.action && <span className="storyboard-action">{panel.action}</span>}
              {meta && <span className="storyboard-lens">{meta}</span>}
            </div>
          </div>
        );
      })}
      {item.panels.length === 0 && (
        <p className="storyboard-empty-note" style={{ marginTop: SB_HEADER + SB_PAD }}>
          No shots yet — tap the pencil to add panels.
        </p>
      )}
    </div>
  );
}

/** Lightbox stage: the board at reading size — framed thumbs above slates. */
export function StoryboardStage({ item }: { item: StoryboardItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  return (
    <div className="sb-stage" data-testid="storyboard-stage">
      <h2 className="sb-stage-title">{item.name ?? item.title}</h2>
      <div
        className="sb-stage-grid"
        style={{ gridTemplateColumns: `repeat(${item.columns}, 1fr)` }}
      >
        {item.panels.map((panel) => {
          const framed = panel.itemIds
            .map((id) => itemsById[id])
            .filter((it): it is Item => it !== undefined);
          const meta = [panel.move, panel.lens, panel.duration != null ? `${panel.duration}s` : '']
            .filter(Boolean)
            .join(' · ');
          return (
            <div className="sb-stage-panel" key={panel.id} data-testid="storyboard-stage-panel">
              <div className="sb-stage-frame">
                {framed.length === 0 ? (
                  <span className="sb-stage-empty">—</span>
                ) : (
                  framed.map((it) => <StageThumb key={it.id} item={it} returnTo={item.id} />)
                )}
              </div>
              <div className="sb-stage-meta">
                <b>{panel.label}</b>
                {panel.scene && <span> · {panel.scene}</span>}
                {panel.action && <p>{panel.action}</p>}
                {meta && <i>{meta}</i>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
