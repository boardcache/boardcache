import { useEffect, useMemo, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import type { RssItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  BoardsIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LoopIcon,
  MatchWidthIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  RenameIcon,
  RssIcon,
  SearchIcon,
  TextQuoteIcon,
  TextSizeIcon,
  TrashIcon,
} from '../../components/icons';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import { PopOutViewButton } from '../../components/chrome/PopOutViewButton';
import { ViewBarButton } from '../../components/chrome/ViewBarButton';
import { RssEntryList, toggleRssExcerpts } from '../../components/items/RssContent';
import { RadixEntries } from '../../components/menu/RadixEntries';
import { confirmDialog, promptText } from '../../components/ui/Prompt';
import { UiSelect } from '../../components/ui/Select';
import { useMobileViewport, usePhoneViewport } from '../../hooks/useMobileViewport';
import { revealItemPage } from '../../lib/board/pages';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import type { MenuEntry } from '../../lib/menuBuilders';
import { PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, TEXT_SCALES } from '../../lib/readerPrefs';
import { syncUrl } from '../../lib/router';
import { countItems } from '../../lib/structure/folders';
import { openUrl } from '../../lib/text/itemUrl';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import {
  editFeedUrl,
  exportFeedsOpml,
  importOpmlFiles,
  openAddFeed,
  refreshFeedsNow,
} from './actions';
import {
  allFeedFolders,
  createFeedFolder,
  deleteFeed,
  deleteFeedFolder,
  feedFolderOf,
  feedTitle,
  feedTree,
  feedsOf,
  moveFeedToFolder,
  renameFeedFolder,
  searchFeeds,
  setFeedOnCanvas,
  type FeedNode,
} from './feedsModel';
import { useFeedsUi } from './store';

/**
 * The board's feeds: every RSS item as a reader, the feeds in collapsible
 * folders on the left (drag a feed onto a folder to file it), the picked
 * feed's entries on the right at full width with the same headline /
 * excerpt switch as the card, a refresh button, and the switch that keeps
 * a feed's card off the canvas. A full-screen plugin view on the gallery
 * chassis (View → Feeds), with the shared view bar. Phones show one side
 * at a time.
 */

const DRAG_TYPE = 'application/x-boardcache-feed';
/** The root folder's value in the folder select. */
const ROOT = '/';

export function FeedsView() {
  const doc = useDocumentStore((s) => s.doc);
  const feeds = useMemo(() => feedsOf(doc), [doc]);
  const tree = useMemo(() => feedTree(doc), [doc]);
  const query = useFeedsUi((s) => s.query);
  const hits = useMemo(() => (query.trim() ? searchFeeds(doc, query) : null), [doc, query]);
  const selectedId = useFeedsUi((s) => s.selectedId);
  const busyAll = useFeedsUi((s) => s.busy.size > 0);
  const mobile = useMobileViewport();
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = feeds.find((f) => f.id === selectedId) ?? null;

  // A deleted feed leaves the stage; the first one takes it on a desktop.
  useEffect(() => {
    if (selectedId && !selected) useFeedsUi.getState().setSelected(null);
  }, [selectedId, selected]);
  const first = (hits ?? feeds)[0];
  useEffect(() => {
    if (!mobile && !selectedId && first) useFeedsUi.getState().setSelected(first.id);
  }, [mobile, selectedId, first]);
  useEffect(() => {
    syncUrl();
  }, [selectedId]);

  const back = () => useSessionStore.getState().setView('canvas');
  const addFeed = (folder = '') => openAddFeed(folder);
  const newFolder = async () => {
    const name = await promptText({ title: 'New folder', label: 'Name', placeholder: 'Folder' });
    if (name?.trim()) createFeedFolder('', name);
  };
  const showList = !mobile || !selected;
  const showDetail = !mobile || !!selected;

  return (
    <div className="gallery-screen feeds-screen" data-testid="feeds-screen">
      <header className="gallery-header view-bar feeds-bar">
        <div className="gallery-header-left">
          <ViewBarButton
            label="Back to canvas"
            icon={<BoardsIcon size={16} />}
            testId="feeds-back"
            onClick={back}
          />
          <h1>Feeds</h1>
          <span className="view-bar-count" data-testid="feeds-count">
            {feeds.length === 1 ? '1 feed' : `${feeds.length} feeds`}
          </span>
        </div>
        <div className="gallery-actions">
          <ViewBarButton
            label="Import an OPML file"
            icon={<FolderInputIcon size={16} />}
            testId="feeds-import"
            onClick={() => fileInput.current?.click()}
          />
          <ViewBarButton
            label="Export the feeds as OPML"
            icon={<DownloadIcon size={16} />}
            testId="feeds-export"
            disabled={feeds.length === 0}
            onClick={() => exportFeedsOpml()}
          />
          <PopOutViewButton testId="feeds-popout" />
          <ThemeToggle className="view-icon-btn" testId="feeds-theme-toggle" />
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".opml,.xml,text/x-opml,text/xml,application/xml"
        multiple
        hidden
        data-testid="feeds-opml-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importOpmlFiles(files);
        }}
      />
      <div className={`feeds-body${mobile ? ' feeds-one-pane' : ''}`}>
        {showList && (
          <aside className="feeds-side" data-testid="feeds-list">
            <div className="feeds-search">
              <SearchIcon size={14} />
              <input
                className="feeds-search-input"
                data-testid="feeds-search"
                placeholder="Search feeds"
                aria-label="Search feeds"
                value={query}
                onChange={(e) => useFeedsUi.getState().setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') useFeedsUi.getState().setQuery('');
                }}
              />
              {query && (
                <button
                  type="button"
                  className="feeds-search-clear"
                  aria-label="Clear search"
                  onClick={() => useFeedsUi.getState().setQuery('')}
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            <div className="feeds-side-actions">
              <button
                type="button"
                className="view-icon-btn"
                title="New feed"
                aria-label="New feed"
                data-testid="feeds-new"
                onClick={() => addFeed()}
              >
                <PlusIcon size={16} />
              </button>
              <button
                type="button"
                className="view-icon-btn"
                title="New folder"
                aria-label="New folder"
                data-testid="feeds-new-folder"
                onClick={() => void newFolder()}
              >
                <FolderPlusIcon size={16} />
              </button>
              <button
                type="button"
                className="view-icon-btn"
                title="Refresh every feed"
                aria-label="Refresh every feed"
                data-testid="feeds-refresh-all"
                disabled={feeds.length === 0 || busyAll}
                onClick={() => void refreshFeedsNow(feeds.map((f) => f.id))}
              >
                <span className={busyAll ? 'feeds-spin' : undefined}>
                  <LoopIcon size={16} />
                </span>
              </button>
            </div>
            <div className="feeds-tree" role="tree" aria-label="Feeds">
              {hits ? (
                <>
                  <div className="feeds-results-head">
                    {hits.length === 0
                      ? 'No feeds match'
                      : `${hits.length} ${hits.length === 1 ? 'feed' : 'feeds'} for “${query.trim()}”`}
                  </div>
                  {hits.map((f) => (
                    <FeedRow key={f.id} feed={f} depth={0} />
                  ))}
                </>
              ) : (
                <>
                  {tree.children.map((f) => (
                    <FolderRow key={f.path} node={f} depth={0} onAddFeed={addFeed} />
                  ))}
                  {tree.items.map((f) => (
                    <FeedRow key={f.id} feed={f} depth={0} />
                  ))}
                  {tree.children.length === 0 && tree.items.length === 0 && (
                    <p className="feeds-empty-hint" data-testid="feeds-empty">
                      No feeds yet. New feed adds one by its address; a feed on the board is a card
                      on the canvas and a reader here.
                    </p>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
        {showDetail && (
          <main className="feeds-detail" data-testid="feeds-detail">
            <div className="feeds-detail-scroll">
              {selected ? (
                <FeedPage key={selected.id} feed={selected} mobile={mobile} />
              ) : (
                <div className="feeds-detail-empty">
                  {feeds.length ? 'Pick a feed' : 'Add a feed to read it here'}
                </div>
              )}
            </div>
            <FeedsStatus feed={selected} />
          </main>
        )}
      </div>
    </div>
  );
}

function FolderRow({
  node,
  depth,
  onAddFeed,
}: {
  node: FeedNode;
  depth: number;
  onAddFeed: (folder: string) => void;
}) {
  const collapsed = useFeedsUi((s) => s.collapsed.has(node.path));
  const [over, setOver] = useState(false);
  const count = countItems(node);
  const rename = async () => {
    const name = await promptText({ title: 'Rename folder', label: 'Name', initial: node.name });
    if (name?.trim()) renameFeedFolder(node.path, name);
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete the folder “${node.name}”?`,
      body:
        count > 0
          ? `Its ${count === 1 ? 'feed stays' : `${count} feeds stay`} on the board and move up a level.`
          : 'The folder is empty.',
      confirmLabel: 'Delete folder',
    });
    if (ok) deleteFeedFolder(node.path);
  };
  return (
    <div className="feeds-folder" role="treeitem" aria-expanded={!collapsed}>
      <div
        className={`feeds-row feeds-folder-row${over ? ' drop' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        data-testid="feeds-folder"
        onClick={() => useFeedsUi.getState().toggleFolder(node.path)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id) {
            e.preventDefault();
            moveFeedToFolder(id, node.path);
          }
        }}
      >
        <span className="feeds-row-chevron">
          {collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
        </span>
        {collapsed ? <FolderIcon size={14} /> : <FolderOpenIcon size={14} />}
        <span className="feeds-row-label">{node.name}</span>
        <span className="feeds-row-count">{count}</span>
        <span className="feeds-row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="view-icon-btn small"
            title="Add a feed here"
            aria-label="Add a feed here"
            data-testid="feeds-folder-add"
            onClick={() => onAddFeed(node.path)}
          >
            <PlusIcon size={12} />
          </button>
          <button
            type="button"
            className="view-icon-btn small"
            title="Rename folder"
            aria-label="Rename folder"
            data-testid="feeds-folder-rename"
            onClick={() => void rename()}
          >
            <RenameIcon size={12} />
          </button>
          <button
            type="button"
            className="view-icon-btn small"
            title="Delete folder"
            aria-label="Delete folder"
            data-testid="feeds-folder-delete"
            onClick={() => void remove()}
          >
            <TrashIcon size={12} />
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="feeds-folder-children" role="group">
          {node.children.map((f) => (
            <FolderRow key={f.path} node={f} depth={depth + 1} onAddFeed={onAddFeed} />
          ))}
          {node.items.map((f) => (
            <FeedRow key={f.id} feed={f} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Rename the feed (its own name over the feed's title). */
async function renameFeed(feed: RssItem): Promise<void> {
  const name = await promptText({
    title: 'Rename feed',
    label: 'Name',
    initial: feedTitle(feed),
    confirmLabel: 'Rename',
  });
  if (name === null) return;
  updateItems([feed.id], 'Rename feed', (d) => {
    if (d.type !== 'rss') return;
    if (name.trim()) d.name = name.trim();
    else delete d.name;
  });
}

async function removeFeed(feed: RssItem): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete “${feedTitle(feed)}”?`,
    body: 'The feed leaves the board. Undo brings it back.',
    confirmLabel: 'Delete feed',
  });
  if (ok) deleteFeed(feed.id);
}

/** Leave for the canvas with the feed's card selected and in view (shown
 *  first when it was hidden). */
function showOnBoard(feed: RssItem): void {
  if (feed.hidden) setFeedOnCanvas(feed.id, true);
  const session = useSessionStore.getState();
  session.setLightbox(null);
  session.setView('canvas');
  session.setSelection([feed.id]);
  revealItemPage(feed.id);
  requestAnimationFrame(() => fitViewportTo(feed, getCanvasContainer()));
}

function FeedRow({ feed, depth }: { feed: RssItem; depth: number }) {
  const active = useFeedsUi((s) => s.selectedId === feed.id);
  const busy = useFeedsUi((s) => s.busy.has(feed.id));
  const mobile = useMobileViewport();
  const pick = () => useFeedsUi.getState().setSelected(feed.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const entries = (): MenuEntry[] => [
    { kind: 'action', label: 'Open', onSelect: pick },
    {
      kind: 'action',
      label: 'Refresh',
      icon: <LoopIcon />,
      onSelect: () => void refreshFeedsNow([feed.id]),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: feed.hidden ? 'Show on Canvas' : 'Hide from Canvas',
      icon: feed.hidden ? <EyeIcon /> : <EyeOffIcon />,
      onSelect: () => setFeedOnCanvas(feed.id, !!feed.hidden),
    },
    {
      kind: 'action',
      label: 'Show on Board',
      icon: <BoardsIcon />,
      onSelect: () => showOnBoard(feed),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Rename',
      icon: <RenameIcon />,
      onSelect: () => void renameFeed(feed),
    },
    {
      kind: 'action',
      label: 'Edit Address',
      icon: <PencilIcon />,
      onSelect: () => void editFeedUrl(feed.id),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Delete',
      icon: <TrashIcon />,
      danger: true,
      onSelect: () => void removeFeed(feed),
    },
  ];
  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        className={`feeds-row feeds-feed-row${active ? ' active' : ''}${feed.hidden ? ' off-canvas' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 + (mobile ? 0 : 16) }}
        data-testid="feeds-feed"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, feed.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={pick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className={busy ? 'feeds-spin' : undefined}>
          {busy ? <LoopIcon size={14} /> : <RssIcon size={14} />}
        </span>
        <span className="feeds-row-label">{feedTitle(feed)}</span>
        {feed.hidden && (
          <span className="feeds-row-off" title="Not on the canvas" data-testid="feeds-row-off">
            <EyeOffIcon size={12} />
          </span>
        )}
        <span className="feeds-row-count">{feed.entries.length}</span>
      </button>
      {menu && (
        <DM.Root open onOpenChange={(open) => !open && setMenu(null)}>
          <DM.Trigger asChild>
            <span
              style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }}
              aria-hidden
            />
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              className="menu-panel menu-list context-menu"
              data-testid="feeds-feed-menu"
              align="start"
              side="bottom"
              sideOffset={2}
              collisionPadding={8}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <RadixEntries entries={entries()} />
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
    </>
  );
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function FeedPage({ feed, mobile }: { feed: RssItem; mobile: boolean }) {
  const busy = useFeedsUi((s) => s.busy.has(feed.id));
  const folders = useDocumentStore(useShallow((s) => allFeedFolders(s.doc)));
  const fontFamily = useSessionStore((s) => s.textDefaults.fontFamily);
  const pageWidth = useFeedsUi((s) => s.pageWidth);
  const textScale = useFeedsUi((s) => s.textScale);
  const [error, setError] = useState<string | null>(null);
  const onCanvas = !feed.hidden;
  const refresh = async () => {
    setError(null);
    const failed = await refreshFeedsNow([feed.id]);
    if (failed.length) setError('The feed could not be fetched.');
  };
  // The select's empty value means "no choice", so the root has a name of its own.
  const folderOptions = [
    { value: ROOT, label: 'Feeds' },
    ...folders.map((p) => ({ value: p, label: p })),
  ];
  return (
    <div className="feeds-page">
      {mobile && (
        <button
          type="button"
          className="feeds-page-back"
          data-testid="feeds-page-back"
          onClick={() => useFeedsUi.getState().setSelected(null)}
        >
          <ChevronLeftIcon size={16} /> Feeds
        </button>
      )}
      <div className="feeds-page-head">
        <h2 data-testid="feeds-page-title">{feedTitle(feed)}</h2>
        <div className="feeds-page-sub">
          <a
            href={feed.url}
            data-testid="feeds-page-url"
            onClick={(e) => {
              e.preventDefault();
              openUrl(feed.url);
            }}
          >
            {host(feed.url)}
          </a>
          {' · '}
          {feed.fetchedAt
            ? `Updated ${new Date(feed.fetchedAt).toLocaleString()}`
            : 'Not fetched yet'}
          {' · '}
          {feed.entries.length === 1 ? '1 entry' : `${feed.entries.length} entries`}
        </div>
      </div>
      <div className="feeds-page-actions">
        <UiSelect
          value={feedFolderOf(feed) || ROOT}
          options={folderOptions}
          onChange={(v) => moveFeedToFolder(feed.id, v === ROOT ? '' : v)}
          ariaLabel="Folder"
          testId="feeds-page-folder"
        />
        <button
          type="button"
          className="btn btn-sm"
          data-testid="feeds-page-refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <span className={busy ? 'feeds-spin' : undefined}>
            <LoopIcon size={14} />
          </span>{' '}
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="feeds-page-excerpts"
          aria-pressed={feed.showExcerpts}
          onClick={() => toggleRssExcerpts(feed.id)}
        >
          <TextQuoteIcon size={14} /> {feed.showExcerpts ? 'Headlines only' : 'Show excerpts'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="feeds-page-canvas"
          aria-pressed={onCanvas}
          onClick={() => setFeedOnCanvas(feed.id, !onCanvas)}
        >
          {onCanvas ? (
            <>
              <EyeOffIcon size={14} /> Hide from Canvas
            </>
          ) : (
            <>
              <EyeIcon size={14} /> Show on Canvas
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="feeds-page-show"
          onClick={() => showOnBoard(feed)}
        >
          <BoardsIcon size={14} /> Show on Board
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="feeds-page-edit"
          onClick={() => void editFeedUrl(feed.id)}
        >
          <PencilIcon size={14} /> Edit Address
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-danger"
          data-testid="feeds-page-delete"
          onClick={() => void removeFeed(feed)}
        >
          <TrashIcon size={14} /> Delete
        </button>
      </div>
      {error && (
        <p className="rss-error" role="alert" data-testid="feeds-page-error">
          {error}
        </p>
      )}
      <div
        className="feeds-reader"
        data-testid="feeds-reader"
        style={{
          fontFamily,
          ['--rss-scale' as string]: textScale,
          ['--feeds-width' as string]: `${pageWidth}%`,
        }}
      >
        <RssEntryList item={feed} />
      </div>
    </div>
  );
}

/** The bar under the reader: what the feed holds, the text size steps and
 *  the page's width (a phone opens the slider in a small sheet). */
function FeedsStatus({ feed }: { feed: RssItem | null }) {
  const pageWidth = useFeedsUi((s) => s.pageWidth);
  const textScale = useFeedsUi((s) => s.textScale);
  const scaleAt = TEXT_SCALES.findIndex((v) => Math.abs(v - textScale) < 1e-6);
  const phone = usePhoneViewport();
  const [widthOpen, setWidthOpen] = useState(false);
  const slider = (
    <input
      type="range"
      min={PAGE_WIDTH_MIN}
      max={PAGE_WIDTH_MAX}
      step={1}
      value={pageWidth}
      aria-label="Page width"
      data-testid="feeds-width"
      onChange={(e) => useFeedsUi.getState().setPageWidth(Number(e.target.value))}
    />
  );
  return (
    <div className="feeds-status" data-testid="feeds-status">
      <span data-testid="feeds-status-counts">
        {feed
          ? `${feed.entries.length === 1 ? '1 entry' : `${feed.entries.length} entries`}${
              feed.fetchedAt ? ` · updated ${new Date(feed.fetchedAt).toLocaleString()}` : ''
            }`
          : ''}
      </span>
      <div className="feeds-text-size" role="group" aria-label="Text size">
        <button
          type="button"
          className="view-icon-btn small"
          title="Smaller text"
          aria-label="Smaller text"
          disabled={scaleAt === 0}
          data-testid="feeds-text-smaller"
          onClick={() => useFeedsUi.getState().stepTextScale(-1)}
        >
          <MinusIcon size={13} />
        </button>
        <span className="feeds-text-size-glyph" aria-hidden>
          <TextSizeIcon size={15} />
        </span>
        <button
          type="button"
          className="view-icon-btn small"
          title="Larger text"
          aria-label="Larger text"
          disabled={scaleAt === TEXT_SCALES.length - 1}
          data-testid="feeds-text-larger"
          onClick={() => useFeedsUi.getState().stepTextScale(1)}
        >
          <PlusIcon size={13} />
        </button>
      </div>
      {phone ? (
        <span className="feeds-width feeds-width-phone">
          <button
            type="button"
            className={`view-icon-btn small${widthOpen ? ' active' : ''}`}
            title="Page width"
            aria-label="Page width"
            aria-expanded={widthOpen}
            data-testid="feeds-width-toggle"
            onClick={() => setWidthOpen((v) => !v)}
          >
            <MatchWidthIcon size={13} />
          </button>
          {widthOpen && (
            <label className="feeds-width-pop" data-testid="feeds-width-pop">
              <span>Width</span>
              {slider}
            </label>
          )}
        </span>
      ) : (
        <label className="feeds-width">
          <span>Width</span>
          {slider}
        </label>
      )}
    </div>
  );
}
