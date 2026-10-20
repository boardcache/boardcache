import { safeHttpUrl } from '../../lib/text/safeUrl';
import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { isEditableTarget } from '../../hooks/useGlobalShortcuts';
import { usePluginItemSidePanel } from '../../plugins/registry';
import {
  colorSetFor,
  isLightboxable,
  lightboxList,
  mediaMeta,
  representativeId,
  swatchGroupMembers,
} from '../../lib/mediaItems';
import { isExportable } from '../../lib/media/imageExport';
import { itemDownloads } from '../../lib/export/downloadItem';
import { downloadViewerAsset } from '../../lib/export/exportViewer';
import { withExportStatus } from '../../lib/export/exportStatus';
import { VIEWER, OFFLINE_VIEWER } from '../../lib/viewerMode';
import { popOutItem } from '../../lib/canvas/popout';
import { updateItems } from '../../state/commands';
import { RelatedPanel } from '../panels/RelatedPanel';
import { CommentsPanel } from '../panels/CommentsPanel';
import { PeerAvatar } from '../chrome/PeerAvatar';
import { useCollabStore } from '../../state/collabStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { DownloadIcon, GalleryIcon, GridIcon, PopOutIcon } from '../icons';
import { TagEditor } from '../panels/TagEditor';
import { ChevronsLeftIcon, ChevronsRightIcon, PanelLeftIcon } from '../icons';
import { ThemeToggle } from '../chrome/ThemeToggle';
import { UiTooltip } from '../ui/Tooltip';
import { ColorDetails, GenericStage } from './stages';
import { itemType } from '../../itemTypes';
import type { StageContext } from '../../itemTypes';
import {
  LightboxNoteEditor,
  LightboxTitleEditor,
  LightboxUrlEditor,
  LightboxStrengthEditor,
  LightboxCasesEditor,
} from './editors';
import {
  AiModelPicker,
  LightboxDescribePanel,
  LightboxTranscriptPanel,
  LightboxOcrPanel,
} from './assistant';
import { isInsideGroup } from '../../lib/canvas/grouping';

const GEN_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  comfyui: 'ComfyUI',
};

/**
 * Fullscreen viewer for any canvas item. Cycles through every item (←/→), Esc
 * closes, images zoom on click, color items get a details sidebar. "Browse
 * all" jumps to the gallery index.
 */
export function Lightbox() {
  const lightboxId = useSessionStore((s) => s.lightboxId);
  const lightboxReturn = useSessionStore((s) => s.lightboxReturn);
  // Viewing one group in the gallery confines ←/→ to that group's members.
  const groupScope = useSessionStore((s) => s.lightboxGroupScope);
  // Team peers looking at this same item right now (presence lightbox field).
  const viewers = useCollabStore(
    useShallow((s) =>
      Object.values(s.peers).filter((p) => p.lightbox != null && p.lightbox === lightboxId),
    ),
  );
  const commentCount = useDocumentStore((s) =>
    lightboxId ? Object.values(s.doc.comments).filter((c) => c.itemId === lightboxId).length : 0,
  );
  // Links open their URL straight from the gallery — they have no detail view.
  const list = useDocumentStore(
    useShallow((s) =>
      lightboxList(s.doc).filter(
        (i) => i.type !== 'link' && (!groupScope || isInsideGroup(s.doc, i, groupScope)),
      ),
    ),
  );
  const doc = useDocumentStore((s) => s.doc);
  const [colorIndex, setColorIndex] = useState(0);
  const [barCenter, setBarCenter] = useState<HTMLElement | null>(null);
  // Always starts CLOSED — even if it was open when the last lightbox view
  // closed. Opening the sidebar is an explicit per-view choice.
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'details' | 'comments' | 'related' | 'assistant'>(
    'details',
  );
  const toggleSide = () => setSideOpen((open) => !open);

  const index = useMemo(() => list.findIndex((m) => m.id === lightboxId), [list, lightboxId]);
  const current = index >= 0 ? list[index] : null;

  // Reset per-item view state when the shown item changes (the React-docs
  // "adjust state during render from a previous value" pattern). The image
  // viewer resets via its own remount (keyed by item id).
  const [shownId, setShownId] = useState(lightboxId);
  if (lightboxId !== shownId) {
    setShownId(lightboxId);
    setColorIndex(0);
    // A fresh lightbox SESSION (was closed, now open) always starts with the
    // sidebar closed — it never persists from the previous view. Navigating
    // between items while open keeps the current choice.
    if (shownId === null && lightboxId !== null) setSideOpen(false);
    // Comment affordances (canvas badge / context menu) land directly on
    // the Comments tab.
    if (useSessionStore.getState().lightboxCommentsHint) {
      useSessionStore.getState().setLightboxCommentsHint(false);
      setSideOpen(true);
      setSideTab('comments');
    }
  }

  useEffect(() => {
    if (index < 0) return;
    const onKey = (e: KeyboardEvent) => {
      // Typing in the palette-name field owns the keyboard (arrows, Esc).
      if (isEditableTarget(e.target)) return;
      const step = (delta: number) => {
        const next = list[(index + delta + list.length) % list.length];
        if (!next) return;
        setNav((p) => ({ n: p.n + 1, from: delta > 0 ? 'right' : 'left' }));
        useSessionStore.getState().setLightbox(next.id);
      };
      // An open ePub owns the arrows (they flip pages in the reader), as
      // does a video (they scrub the timeline); this handler registered
      // first, so it must yield rather than rely on the stage stopping
      // propagation.
      const readerOwnsArrows =
        list[index]?.type === 'epub' ||
        list[index]?.type === 'video' ||
        (list[index]?.type === 'pdf' && !OFFLINE_VIEWER);
      if (e.key === 'Escape') {
        // A dialog opened OVER the lightbox (e.g. tree settings from the
        // stage) owns this Escape — it closes itself; the lightbox stays.
        if (document.querySelector('.dlg-veil')) return;
        const session = useSessionStore.getState();
        const ret = session.lightboxReturn;
        if (ret && ret !== list[index]?.id && useDocumentStore.getState().doc.items[ret]) {
          session.setLightboxReturn(null);
          session.setLightbox(ret);
        } else {
          session.setLightbox(null);
        }
      } else if (e.key === 'ArrowRight' && !readerOwnsArrows) {
        useSessionStore.getState().setLightboxReturn(null);
        step(1);
      } else if (e.key === 'ArrowLeft' && !readerOwnsArrows) {
        useSessionStore.getState().setLightboxReturn(null);
        step(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
        return; // reader handles
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, list]);

  // The target can disappear (undo/delete) — close cleanly.
  useEffect(() => {
    if (lightboxId && index < 0) useSessionStore.getState().setLightbox(null);
  }, [lightboxId, index]);

  // Every step between items slides the new one in from the side it came
  // from (`n` re-keys the stage so back-to-back steps each animate).
  const [nav, setNav] = useState<{ n: number; from: 'left' | 'right' | null }>({
    n: 0,
    from: null,
  });

  // Touch swipe on the stage: a sideways drag follows the finger and, past
  // the threshold, flies out while the neighbour slides in (nav arrows hide
  // on mobile); a vertical flick on an image, which also follows and fades,
  // closes the lightbox.
  const swipeRef = useRef<{
    x: number;
    y: number;
    id: number;
    at: number;
    /** Started on the image stage — the only stage that dismisses vertically. */
    image: boolean;
    /** Started on a zoomed-in image: the finger pans the picture, so the
     *  stage neither follows nor swipes — only a clean tap counts. */
    zoomedPan: boolean;
    /** The axis the stage is following (locked by the first clear movement). */
    following: 'x' | 'y' | null;
  } | null>(null);
  /** What moves with a gesture: the picture itself on the image stage (the
   *  zoom pill floating over it stays put), otherwise the whole stage. */
  const motionTarget = (stage: HTMLElement): HTMLElement =>
    stage.querySelector<HTMLElement>(':scope > .lightbox-zoom-wrap > .lightbox-zoomable') ?? stage;
  const settleStage = (stage: HTMLElement) => {
    const el = motionTarget(stage);
    el.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
    el.style.transform = '';
    el.style.opacity = '';
    window.setTimeout(() => {
      el.style.transition = '';
    }, 200);
  };
  /** Finish a sideways swipe: the stage leaves the way the finger went, then
   *  the neighbour steps in from the other side. */
  const flyOut = (stage: HTMLElement, delta: 1 | -1) => {
    const el = motionTarget(stage);
    el.style.transition = 'transform 0.16s ease-in, opacity 0.16s ease-in';
    el.style.transform = `translateX(${-delta * stage.clientWidth}px)`;
    el.style.opacity = '0';
    window.setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      go(delta);
    }, 150);
  };

  // A clean single tap on the picture hides or shows the chrome (bar, zoom
  // pill), as a tap on blank canvas does. Deferred a beat so a double-tap
  // (zoom) never flickers it.
  const [chromeHidden, setChromeHidden] = useState(false);
  const tapTimer = useRef<number | null>(null);
  const tapOnImage = () => {
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current); // second tap: a double-tap zoom
      tapTimer.current = null;
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      setChromeHidden((h) => !h);
    }, 260);
  };

  const itemPanel = usePluginItemSidePanel();
  // Sidebar: overlay with tabs (Details | Assistant) and a draggable width.
  const [sideW, setSideW] = useState(() => {
    const raw = Number(localStorage.getItem('boardcache:lightboxSideW'));
    return Number.isFinite(raw) && raw >= 240 ? Math.min(raw, 640) : 300;
  });
  // Phones: the drawer can take the whole screen (the tabs and long notes
  // get room); the choice is remembered. Desktop ignores it.
  const [sideWide, setSideWide] = useState(
    () => localStorage.getItem('boardcache:lightboxSideWide') === '1',
  );
  const toggleSideWide = () =>
    setSideWide((wide) => {
      localStorage.setItem('boardcache:lightboxSideWide', wide ? '0' : '1');
      return !wide;
    });
  const sideDrag = useRef<{ startX: number; startW: number } | null>(null);
  const onSideResize = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sideDrag.current = { startX: e.clientX, startW: sideW };
  };
  const onSideResizeMove = (e: React.PointerEvent) => {
    const d = sideDrag.current;
    if (!d) return;
    const w = Math.max(240, Math.min(640, d.startW + (e.clientX - d.startX)));
    setSideW(w);
  };
  const endSideResize = () => {
    if (!sideDrag.current) return;
    sideDrag.current = null;
    localStorage.setItem('boardcache:lightboxSideW', String(sideW));
  };

  if (!current) return null;

  const close = () => useSessionStore.getState().setLightbox(null);
  const go = (delta: number) => {
    // Stepping away leaves the timeline context behind.
    useSessionStore.getState().setLightboxReturn(null);
    const next = list[(index + delta + list.length) % list.length];
    if (!next) return;
    setNav((p) => ({ n: p.n + 1, from: delta > 0 ? 'right' : 'left' }));
    useSessionStore.getState().setLightbox(next.id);
  };
  const browseAll = () => {
    useSessionStore.getState().setLightbox(null);
    useSessionStore.getState().setView('gallery');
  };

  const colorSet = colorSetFor(doc, current);
  const activeColor = colorSet?.colors[Math.min(colorIndex, colorSet.colors.length - 1)];
  const meta = mediaMeta(current);

  const Stage = itemType(current).stage;
  const stageCtx: StageContext = {
    controlsHost: barCenter,
    close,
    colorIndex,
    onColorIndex: setColorIndex,
  };
  const stage = Stage ? (
    <Stage key={current.id} item={current} ctx={stageCtx} />
  ) : (
    <GenericStage item={current} />
  );

  return (
    <div
      className={`lightbox${chromeHidden ? ' chrome-hidden' : ''}`}
      data-testid="lightbox"
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox-backdrop" onClick={close} />

      <div className="lightbox-top">
        <header className="lightbox-bar">
          <UiTooltip label="Back to the item index">
            <button
              type="button"
              className="lightbox-browse lightbox-index-btn"
              onClick={browseAll}
              aria-label="Back to the item index"
              data-testid="lightbox-index-btn"
            >
              <GridIcon />
            </button>
          </UiTooltip>
          <UiTooltip label="Details, tags & actions">
            <button
              type="button"
              className={`lightbox-browse lightbox-side-toggle${sideOpen ? ' active' : ''}`}
              onClick={toggleSide}
              aria-label="Toggle details sidebar"
              data-testid="lightbox-side-toggle"
              aria-pressed={sideOpen}
            >
              <PanelLeftIcon />
            </button>
          </UiTooltip>
          <div className="lightbox-title">
            <LightboxTitleEditor key={current.id} item={current} />
            <span className="lightbox-sub">
              {meta.typeLabel}
              {colorSet?.multi
                ? ` · ${colorSet.colors.length} colors`
                : meta.detail
                  ? ` · ${meta.detail}`
                  : ''}{' '}
              · {index + 1}/{list.length}
            </span>
          </div>
          {lightboxReturn && lightboxReturn !== current.id && doc.items[lightboxReturn] && (
            <button
              type="button"
              className="lightbox-back-timeline"
              data-testid="lightbox-back-timeline"
              onClick={() => {
                const session = useSessionStore.getState();
                session.setLightboxReturn(null);
                session.setLightbox(lightboxReturn);
              }}
            >
              ‹ Back to {mediaMeta(doc.items[lightboxReturn]!).typeLabel}
            </button>
          )}
          {/* Centered slot — peer viewers + the image zoom pill portal. */}
          <div className="lightbox-bar-center">
            {viewers.length > 0 && (
              <div
                className="lightbox-viewers"
                data-testid="lightbox-viewers"
                title={`Also viewing: ${viewers.map((p) => p.name).join(', ')}`}
              >
                {viewers.slice(0, 5).map((p) => (
                  <PeerAvatar key={p.id} peer={p} className="lightbox-viewer-chip" />
                ))}
                <span className="lightbox-viewers-label">
                  {viewers.length === 1
                    ? `${viewers[0]!.name} is viewing`
                    : `${viewers.length} viewing`}
                </span>
              </div>
            )}
            <div ref={setBarCenter} />
          </div>
          <div className="lightbox-actions">
            <ThemeToggle
              className="lightbox-browse lightbox-theme-toggle"
              testId="lightbox-theme-toggle"
            />
            <UiTooltip label="Close (Esc)">
              <button
                type="button"
                className="lightbox-close"
                onClick={close}
                aria-label="Close"
                data-testid="lightbox-close"
              >
                ✕
              </button>
            </UiTooltip>
          </div>
        </header>
      </div>

      <div
        className="lightbox-body"
        style={{ ['--lb-side-w' as string]: sideOpen ? `${sideW}px` : '0px' }}
      >
        {sideOpen && (
          <div
            className="lightbox-side-backdrop"
            data-testid="lightbox-side-backdrop"
            onClick={toggleSide}
          />
        )}
        {sideOpen && (
          <aside
            className={`lightbox-side-panel${sideWide ? ' lightbox-side-wide' : ''}`}
            data-testid="lightbox-side-panel"
            style={{ width: sideW }}
          >
            <div className="lsp-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'details'}
                className={sideTab === 'details' ? 'active' : ''}
                data-testid="lsp-tab-details"
                onClick={() => setSideTab('details')}
              >
                Details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'comments'}
                className={sideTab === 'comments' ? 'active' : ''}
                data-testid="lsp-tab-comments"
                onClick={() => setSideTab('comments')}
              >
                Comments{commentCount > 0 ? ` (${commentCount})` : ''}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'related'}
                className={sideTab === 'related' ? 'active' : ''}
                data-testid="lsp-tab-related"
                onClick={() => setSideTab('related')}
              >
                Related
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'assistant'}
                className={sideTab === 'assistant' ? 'active' : ''}
                data-testid="lsp-tab-assistant"
                onClick={() => setSideTab('assistant')}
              >
                Assistant
              </button>
              <button
                type="button"
                className="lsp-wide-toggle"
                aria-label={sideWide ? 'Narrow the panel' : 'Widen the panel'}
                aria-pressed={sideWide}
                data-testid="lsp-wide-toggle"
                onClick={toggleSideWide}
              >
                {sideWide ? <ChevronsLeftIcon size={16} /> : <ChevronsRightIcon size={16} />}
              </button>
            </div>
            <div
              className="lsp-resize"
              data-testid="lsp-resize"
              onPointerDown={onSideResize}
              onPointerMove={onSideResizeMove}
              onPointerUp={endSideResize}
              onPointerCancel={endSideResize}
            />
            {sideTab === 'comments' ? (
              <CommentsPanel key={current.id} item={current} />
            ) : sideTab === 'related' ? (
              <RelatedPanel key={current.id} item={current} />
            ) : sideTab === 'assistant' ? (
              itemPanel ? (
                createElement(itemPanel, { itemId: current.id })
              ) : (
                <p className="chat-empty">
                  Enable the AI Generation plugin (Settings → Plugins) to chat with this item.
                </p>
              )
            ) : (
              <>
                <div className="lsp-section">
                  <div className="lsp-field">
                    <span className="lsp-field-label">Link</span>
                    <LightboxUrlEditor key={`url-${current.id}`} item={current} />
                  </div>
                  <div className="lsp-field">
                    <span className="lsp-field-label">Tags</span>
                    <TagEditor
                      key={`tags-${current.id}`}
                      itemIds={[current.id]}
                      testId="lightbox-tags"
                    />
                  </div>
                  <div className="lsp-field">
                    <span className="lsp-field-label">Note</span>
                    <LightboxNoteEditor key={`note-${current.id}`} item={current} />
                  </div>
                  {current.type !== 'case' && (
                    <>
                      <div className="lsp-field">
                        <span className="lsp-field-label">Strength</span>
                        <LightboxStrengthEditor key={`weight-${current.id}`} item={current} />
                      </div>
                      <div className="lsp-field">
                        <span className="lsp-field-label">Cases</span>
                        <LightboxCasesEditor key={`cases-${current.id}`} item={current} />
                      </div>
                    </>
                  )}
                  {current.type === 'image' && (
                    <>
                      <div className="lsp-ai-heading" data-testid="lightbox-ai-heading">
                        AI Assistant
                      </div>
                      <AiModelPicker />
                      <LightboxOcrPanel key={`ocr-${current.id}`} item={current} />
                      <LightboxDescribePanel key={`desc-${current.id}`} item={current} />
                    </>
                  )}
                  {(current.type === 'audio' || current.type === 'video') && (
                    <LightboxTranscriptPanel key={`tr-${current.id}`} item={current} />
                  )}
                </div>
                {current.genInfo && (
                  <div className="lsp-section" data-testid="lightbox-geninfo">
                    <span className="lsp-field-label">AI generation</span>
                    <dl className="lsp-gen">
                      <dt>Provider</dt>
                      <dd>
                        {GEN_PROVIDER_LABELS[current.genInfo.provider] ?? current.genInfo.provider}
                      </dd>
                      <dt>Model</dt>
                      <dd data-testid="lightbox-geninfo-model">{current.genInfo.model}</dd>
                      {current.genInfo.prompt && (
                        <>
                          <dt>Prompt</dt>
                          <dd className="lsp-gen-prompt">{current.genInfo.prompt}</dd>
                        </>
                      )}
                      {current.genInfo.sourceItemId && (
                        <>
                          <dt>Source</dt>
                          <dd>
                            {doc.items[current.genInfo.sourceItemId]?.name ??
                              (doc.items[current.genInfo.sourceItemId]
                                ? 'item on this board'
                                : 'item no longer on this board')}
                          </dd>
                        </>
                      )}
                      {Object.entries(current.genInfo.extra ?? {}).map(([k, v]) => (
                        <Fragment key={k}>
                          <dt>{k.replace(/^./, (c) => c.toUpperCase())}</dt>
                          <dd>{v}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  </div>
                )}
                {current.source && (
                  <div className="lsp-section" data-testid="lightbox-source">
                    <span className="lsp-field-label">Source</span>
                    <dl className="lsp-gen">
                      <dt>Page</dt>
                      <dd>
                        <a
                          href={safeHttpUrl(current.source.url) ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {current.source.title ?? current.source.url}
                        </a>
                      </dd>
                      {current.source.capturedAt && (
                        <>
                          <dt>Captured</dt>
                          <dd>{new Date(current.source.capturedAt).toLocaleDateString()}</dd>
                        </>
                      )}
                      {current.source.author && (
                        <>
                          <dt>Author</dt>
                          <dd>{current.source.author}</dd>
                        </>
                      )}
                      {current.source.quote && (
                        <>
                          <dt>Quote</dt>
                          <dd className="lsp-gen-prompt">{current.source.quote}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                )}
                <div className="lsp-section lsp-actions">
                  {VIEWER ? (
                    // The viewer has no asset store: its own download path.
                    isExportable(current) && (
                      <button
                        type="button"
                        className="lightbox-browse"
                        onClick={() => downloadViewerAsset(current)}
                        data-testid="lightbox-export"
                        title="Download this item"
                      >
                        <DownloadIcon /> Download
                      </button>
                    )
                  ) : (
                    // Every type downloads: the item's own file, Markdown for
                    // the cards, the type's extras, and a PNG of the item.
                    <div className="lsp-downloads" data-testid="lightbox-downloads">
                      {itemDownloads(current, doc).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="lightbox-browse"
                          data-testid={`lightbox-download-${d.id}`}
                          title={`Download: ${d.label}`}
                          onClick={() =>
                            void withExportStatus('Downloading', () => d.run()).catch(
                              () => undefined,
                            )
                          }
                        >
                          <DownloadIcon /> {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="lightbox-browse"
                    onClick={() => void popOutItem(current, doc)}
                    data-testid="lightbox-popout"
                    title="Open this item in a new window"
                  >
                    <PopOutIcon /> Pop Out
                  </button>
                  <button
                    type="button"
                    className="lightbox-browse"
                    onClick={browseAll}
                    data-testid="lightbox-browse-all"
                    title="Browse all items"
                  >
                    <GalleryIcon /> All items
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
        <div
          key={nav.n}
          className={`lightbox-stage${nav.from ? ` slide-from-${nav.from}` : ''}`}
          onClick={(e) => {
            // A click on the empty stage area (not the media) closes.
            if (e.target === e.currentTarget) close();
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'touch') return;
            // A gesture that starts inside a horizontally scrollable region
            // (the markdown toolbar chips, a zoomed PDF page) or a text
            // field is a scroll/selection, not an item-to-item swipe.
            for (
              let el = e.target as HTMLElement | null;
              el && el !== e.currentTarget;
              el = el.parentElement
            ) {
              const tag = el.tagName;
              if (tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable) {
                swipeRef.current = null;
                return;
              }
              const cs = getComputedStyle(el);
              if (
                (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
                el.scrollWidth > el.clientWidth + 1
              ) {
                swipeRef.current = null;
                return;
              }
            }
            // A second finger means pinch, not swipe.
            if (swipeRef.current) {
              if (swipeRef.current.following) settleStage(e.currentTarget);
              swipeRef.current = null;
              return;
            }
            swipeRef.current = {
              x: e.clientX,
              y: e.clientY,
              id: e.pointerId,
              at: Date.now(),
              image: !!(e.target as HTMLElement).closest('.lightbox-zoomable'),
              zoomedPan: !!(e.target as HTMLElement).closest('.lightbox-zoomable.zoomed'),
              following: null,
            };
          }}
          onPointerMove={(e) => {
            const start = swipeRef.current;
            if (!start || e.pointerId !== start.id || start.zoomedPan) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (!start.following) {
              // Lock an axis on the first clear movement: vertical only
              // dismisses an image; sideways only steps when there is a
              // neighbour to step to.
              if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
              if (Math.abs(dy) > Math.abs(dx)) {
                if (!start.image) return;
                start.following = 'y';
              } else {
                if (list.length < 2) return;
                start.following = 'x';
              }
            }
            const el = motionTarget(e.currentTarget);
            if (start.following === 'y') {
              el.style.transform = `translateY(${dy}px)`;
              el.style.opacity = String(Math.max(0.3, 1 - Math.abs(dy) / 360));
            } else {
              el.style.transform = `translateX(${dx}px)`;
              el.style.opacity = String(
                Math.max(0.35, 1 - Math.abs(dx) / e.currentTarget.clientWidth),
              );
            }
          }}
          onPointerUp={(e) => {
            const start = swipeRef.current;
            swipeRef.current = null;
            if (!start || e.pointerType !== 'touch' || e.pointerId !== start.id) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (start.zoomedPan) {
              // Panned the picture; a clean tap on it still toggles the chrome.
              if (Math.hypot(dx, dy) < 10 && Date.now() - start.at < 400) tapOnImage();
              return;
            }
            if (start.image && Math.abs(dy) > 80 && Math.abs(dy) > 2 * Math.abs(dx)) {
              close();
              return;
            }
            const el = e.currentTarget;
            if (list.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
              flyOut(el, dx < 0 ? 1 : -1);
              return;
            }
            if (start.following) settleStage(el);
            else if (start.image && Math.hypot(dx, dy) < 10 && Date.now() - start.at < 400) {
              tapOnImage();
            }
          }}
          onPointerCancel={(e) => {
            if (swipeRef.current?.following) settleStage(e.currentTarget);
            swipeRef.current = null;
          }}
        >
          {stage}
        </div>
        {activeColor && (
          <ColorDetails
            color={activeColor.color}
            {...(activeColor.name !== undefined ? { name: activeColor.name } : {})}
            onChange={(c) => {
              // Write to whichever item owns the active color cell.
              if (current.type === 'palette') {
                updateItems([current.id], 'Edit color', (d) => {
                  if (d.type === 'palette' && d.colors[colorIndex]) {
                    d.colors[colorIndex]!.color = c;
                  }
                });
              } else if (current.type === 'swatch' && current.groupId) {
                const member = swatchGroupMembers(doc, current.groupId)[colorIndex];
                if (member) {
                  updateItems([member.id], 'Edit color', (d) => {
                    if (d.type === 'swatch') d.color = c;
                  });
                }
              } else if (current.type === 'swatch') {
                updateItems([current.id], 'Edit color', (d) => {
                  if (d.type === 'swatch') d.color = c;
                });
              }
            }}
          />
        )}
      </div>

      {list.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav prev"
            onClick={() => go(-1)}
            aria-label="Previous"
            title="Previous (←)"
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-nav next"
            onClick={() => go(1)}
            aria-label="Next"
            title="Next (→)"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}

/** Open the lightbox on an item (resolving swatch-group members to the group). */
export function openLightbox(item: Item): boolean {
  if (!isLightboxable(item)) return false;
  const { doc } = useDocumentStore.getState();
  useSessionStore.getState().setLightbox(representativeId(doc, item.id));
  return true;
}
