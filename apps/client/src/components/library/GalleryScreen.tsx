import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { lightboxList, mediaMeta } from '../../lib/mediaItems';
import { presentTypes, sortFilterGallery, TYPE_LABELS } from '../../lib/board/gallerySort';
import {
  exportGroupAsArchive,
  exportGroupAsPlainZip,
  exportGroupAsPng,
} from '../../lib/board/transfer';
import * as DM from '@radix-ui/react-dropdown-menu';
import { RadixEntries } from '../menu/RadixEntries';
import { isMobileViewport } from '../../lib/mobile';
import { effectiveUrl } from '../../lib/text/itemUrl';
import {
  LayersIcon,
  ExportIcon,
  BlogViewIcon,
  BoardsIcon,
  CaptionsIcon,
  FilterIcon,
  GridIcon,
  GridSmallIcon,
  ListIcon,
  MasonryIcon,
} from '../icons';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  PagesIcon,
  PlayIcon,
  SortIcon,
} from '../icons';
import { UiSelect } from '../ui/Select';
import { openLightbox } from '../lightbox/Lightbox';
import { ThemeToggle } from '../chrome/ThemeToggle';
import { AddMenuButton } from '../chrome/AddMenu';
import { FRAMED_VIEWER } from '../../lib/viewerMode';
import { PluginCornerButtons } from '../../plugins/registry';
import { UiTooltip } from '../ui/Tooltip';
import { updateBoardSettings, renameGroup } from '../../state/commands';
import { isInsideGroup } from '../../lib/canvas/grouping';
import { useDocumentStore } from '../../state/documentStore';
import { itemType } from '../../itemTypes';
import type { CardDnd, CardProps } from '../../itemTypes';
import { GALLERY_SCALE, useSessionStore, type GallerySortMode } from '../../state/sessionStore';

/** Card height ÷ width in masonry: the type's own rule, else the item's box (never flatter than 1:5). */
function cardHeightRatio(item: Item): number {
  const own = itemType(item).cardAspect;
  if (own) return own(item);
  return Math.max(0.2, item.height / Math.max(1, item.width));
}

/**
 * Gallery views, persisted per device. Desktop offers masonry + grid (both
 * sized by the thumbnail slider), list, and a blog-style detail view; mobile
 * swaps the slider-driven pair for fixed small (2-up) / large (1-up) grids.
 */
type GalleryView = 'masonry' | 'grid' | 'small' | 'large' | 'list' | 'blog';
const GALLERY_VIEW_KEY = 'boardcache:galleryView';
const ALL_VIEWS: GalleryView[] = ['masonry', 'grid', 'small', 'large', 'list', 'blog'];
const DESKTOP_VIEWS: { view: GalleryView; label: string }[] = [
  { view: 'masonry', label: 'Masonry' },
  { view: 'grid', label: 'Grid' },
  { view: 'list', label: 'List' },
  { view: 'blog', label: 'Detail view' },
];
const MOBILE_VIEWS: { view: GalleryView; label: string }[] = [
  { view: 'small', label: 'Small grid' },
  { view: 'large', label: 'Large grid' },
  { view: 'list', label: 'List' },
  { view: 'blog', label: 'Detail view' },
];
const VIEW_CELL: Record<'small' | 'large', number> = { small: 200, large: 400 };

const dateAdded = (item: Item): string =>
  item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';

function GalleryCard({ item, layout, captions, dnd }: CardProps) {
  const def = itemType(item);
  const url = useAssetUrl(def.cardAsset?.(item) ?? null);
  const doc = useDocumentStore.getState().doc;
  const meta = mediaMeta(item);
  // Captions carry the identity (shown via the Titles toggle); thumbs stay
  // clean — no overlay titles. Types may override (swatches show their hex,
  // QR codes their content, webpages their host).
  const caption = def.cardCaption?.(item, doc) ?? meta.title;
  const aspect = layout === 'grid' ? 1 : 1 / cardHeightRatio(item);
  const Card = def.card;

  const dndClass = dnd
    ? ` draggable${dnd.dragging ? ' dragging' : ''}${dnd.dropEdge ? ` drop-${dnd.dropEdge}` : ''}`
    : '';
  return (
    <button
      type="button"
      className={`gallery-card type-${item.type}${dndClass}`}
      onClick={() => openLightbox(item)}
      data-testid="gallery-card"
      data-item-id={item.id}
      title={caption}
      draggable={dnd ? true : undefined}
      onDragStart={dnd?.onDragStart}
      onDragOver={dnd?.onDragOver}
      onDrop={dnd?.onDrop}
      onDragEnd={dnd?.onDragEnd}
    >
      <div
        className="gallery-thumb"
        style={{
          aspectRatio: layout === 'grid' ? '1 / 1' : `${aspect}`,
          ...def.cardFrameStyle?.(item),
        }}
      >
        {url ? (
          <img src={url} alt="" draggable={false} />
        ) : Card ? (
          <Card item={item} />
        ) : (
          <span className="gallery-generic">{meta.typeLabel}</span>
        )}
        {def.cardPlayBadge && (
          <span className="gallery-play">
            <PlayIcon size={13} />
          </span>
        )}
      </div>
      {captions && <span className="gallery-caption">{caption}</span>}
    </button>
  );
}

/** Pick the card variant for an item (links get their own behavior). */
function GalleryItemCard(props: CardProps) {
  const Card = itemType(props.item).cardComponent;
  return Card ? <Card {...props} /> : <GalleryCard {...props} />;
}

/** Left sidebar: filter the gallery by media type, then group, then tag. */
function GallerySidebar({
  items,
  hiddenTypes,
  selectedTags,
  open,
  groups,
  activeGroup,
  onSelectGroup,
}: {
  items: Item[];
  hiddenTypes: string[];
  selectedTags: string[];
  /** Mobile flyout state; ignored on desktop where the sidebar is static. */
  open: boolean;
  groups: { group: { id: string; name?: string | undefined }; members: Item[] }[];
  activeGroup: string | null;
  onSelectGroup: (id: string | null) => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.type, (m.get(it.type) ?? 0) + 1);
    return m;
  }, [items]);
  const types = useMemo(() => presentTypes(items), [items]);
  const tags = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const it of items)
      for (const tag of it.tags ?? []) {
        const key = tag.toLowerCase();
        const e = m.get(key);
        if (e) e.count++;
        else m.set(key, { label: tag, count: 1 });
      }
    return [...m.values()].sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
    );
  }, [items]);
  const shownCount = types.filter((t) => !hiddenTypes.includes(t)).length;
  const allShown = shownCount === types.length;
  const noneShown = shownCount === 0;
  const selected = (label: string) =>
    selectedTags.some((s) => s.toLowerCase() === label.toLowerCase());

  return (
    <aside className={`gallery-sidebar${open ? ' open' : ''}`} data-testid="gallery-sidebar">
      <div className="gallery-sidebar-head">Type</div>
      <label className="gallery-filter-row gallery-filter-all" data-testid="gallery-filter-all">
        <input
          type="checkbox"
          checked={allShown}
          ref={(el) => {
            if (el) el.indeterminate = !allShown && !noneShown;
          }}
          onChange={() =>
            useSessionStore.getState().setGalleryHiddenTypes(allShown ? [...types] : [])
          }
        />
        <span className="gallery-filter-label">{allShown ? 'All types' : 'Select all'}</span>
      </label>
      {types.map((type) => (
        <label key={type} className="gallery-filter-row" data-testid={`gallery-filter-${type}`}>
          <input
            type="checkbox"
            checked={!hiddenTypes.includes(type)}
            onChange={() => useSessionStore.getState().toggleGalleryType(type)}
          />
          <span className="gallery-filter-label">{TYPE_LABELS[type] ?? type}</span>
          <span className="gallery-filter-count">{counts.get(type) ?? 0}</span>
        </label>
      ))}

      {groups.length > 0 && (
        <>
          <div className="gallery-sidebar-head gallery-sidebar-subhead">
            <span>Groups</span>
            {activeGroup && (
              <button
                type="button"
                className="gallery-tag-clear"
                onClick={() => onSelectGroup(null)}
                data-testid="gallery-group-clear"
              >
                Clear
              </button>
            )}
          </div>
          {groups.map(({ group, members }) => (
            <button
              key={group.id}
              type="button"
              className={`gallery-filter-row gallery-tag-row${activeGroup === group.id ? ' active' : ''}`}
              onClick={() => onSelectGroup(activeGroup === group.id ? null : group.id)}
              data-testid="gallery-sidebar-group"
            >
              <span className="gallery-filter-label">{group.name ?? 'Group'}</span>
              <span className="gallery-filter-count">{members.length}</span>
            </button>
          ))}
        </>
      )}

      {tags.length > 0 && (
        <>
          <div className="gallery-sidebar-head gallery-sidebar-subhead">
            <span>Tags</span>
            {selectedTags.length > 0 && (
              <button
                type="button"
                className="gallery-tag-clear"
                onClick={() => useSessionStore.getState().setGalleryTags([])}
                data-testid="gallery-tag-clear"
              >
                Clear
              </button>
            )}
          </div>
          {tags.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`gallery-filter-row gallery-tag-row${selected(t.label) ? ' active' : ''}`}
              onClick={() => useSessionStore.getState().toggleGalleryTag(t.label)}
              data-testid={`gallery-tag-${t.label}`}
            >
              <span className="gallery-filter-label">{t.label}</span>
              <span className="gallery-filter-count">{t.count}</span>
            </button>
          ))}
        </>
      )}
    </aside>
  );
}

const GALLERY_GAP = 16;

/** Spread items across `cols` columns, always adding to the shortest one. */
function toColumns(items: Item[], cols: number): Item[][] {
  const buckets = Array.from({ length: Math.max(1, cols) }, () => ({ items: [] as Item[], h: 0 }));
  for (const item of items) {
    let shortest = buckets[0]!;
    for (const b of buckets) if (b.h < shortest.h) shortest = b;
    shortest.items.push(item);
    // Relative rendered height for a fixed column width (capped to match the thumb).
    shortest.h += cardHeightRatio(item);
  }
  return buckets.map((b) => b.items);
}

/**
 * Responsive masonry: column count is derived from the live container width and
 * the thumbnail scale, so it reflows and reorders as the window resizes.
 */
function MasonryLayout({
  items,
  cell,
  captions,
}: {
  items: Item[];
  cell: number;
  captions: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCols(Math.max(1, Math.floor((el.clientWidth + GALLERY_GAP) / (cell + GALLERY_GAP))));
    });
    ro.observe(el); // fires once immediately, then on every resize
    return () => ro.disconnect();
  }, [cell]);

  // Never more columns than items (avoids squished thumbs + empty columns).
  const columns = useMemo(
    () => toColumns(items, Math.min(cols, Math.max(1, items.length))),
    [items, cols],
  );

  return (
    <div
      ref={ref}
      className="gallery-masonry"
      data-testid="gallery-layout"
      style={{ ['--gallery-cell' as string]: `${cell}px` }}
    >
      {columns.map((col, i) => (
        <div className="gallery-col" key={i}>
          {col.map((item) => (
            <GalleryItemCard key={item.id} item={item} layout="masonry" captions={captions} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Blog-style detail row: big thumb left, title + metadata right. */
function GalleryBlogRow({ item }: { item: Item }) {
  const doc = useDocumentStore.getState().doc;
  const meta = mediaMeta(item);
  const title = itemType(item).cardCaption?.(item, doc) ?? meta.title;
  const url = effectiveUrl(item);
  const groupName = item.groupId ? doc.groups[item.groupId]?.name : null;

  return (
    <div className="gallery-blogrow" data-testid="gallery-blogrow">
      <div className="gallery-blog-thumb">
        <GalleryItemCard item={item} layout="grid" captions={false} />
      </div>
      <button type="button" className="gallery-blog-body" onClick={() => openLightbox(item)}>
        <h3 className="gallery-blog-title">{title}</h3>
        <div className="gallery-blog-meta">
          <span className="gallery-blog-type">{meta.typeLabel}</span>
          {dateAdded(item) && <span>Added {dateAdded(item)}</span>}
          {groupName && <span>Group: {groupName}</span>}
          {(item.tags ?? []).length > 0 && <span>#{(item.tags ?? []).join(' #')}</span>}
        </div>
        {url && (
          <a
            className="gallery-blog-url"
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {url}
          </a>
        )}
        {item.notes?.trim() && <p className="gallery-blog-note">{item.notes}</p>}
      </button>
    </div>
  );
}

const SORT_MODES: { value: GallerySortMode; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Date created' },
  { value: 'type', label: 'Type' },
  { value: 'weight', label: 'Strength' },
];

/** A quarter tile of a group card's collage: image thumb, color, or type chip. */
function GroupMiniThumb({ item }: { item: Item }) {
  const def = itemType(item);
  // Images show their raw asset here (the card bakes crops; a collage tile needn't).
  const assetId =
    item.type === 'image' ? (item.previewAssetId ?? item.assetId) : (def.cardAsset?.(item) ?? null);
  const url = useAssetUrl(assetId);
  if (url) return <img src={url} alt="" draggable={false} />;
  const color = def.cardColor?.(item);
  if (color) return <i style={{ background: color }} />;
  return <i className="gallery-group-chip">{mediaMeta(item).typeLabel}</i>;
}

/** Gallery index: every item in a masonry or grid layout, click to open. */
export function GalleryScreen() {
  const items = useDocumentStore(useShallow((s) => lightboxList(s.doc)));
  const order = useDocumentStore(useShallow((s) => s.doc.settings.galleryOrder ?? []));
  const boardName = useDocumentStore((s) => s.doc.name);
  const [view, setView] = useState<GalleryView>(() => {
    const stored = localStorage.getItem(GALLERY_VIEW_KEY) as GalleryView | null;
    if (stored && ALL_VIEWS.includes(stored)) return stored;
    return isMobileViewport() ? 'small' : 'masonry';
  });
  const [sideOpen, setSideOpen] = useState(false); // mobile filter flyout
  const captions = useSessionStore((s) => s.galleryCaptions);
  const scale = useSessionStore((s) => s.galleryScale);
  const sortMode = useSessionStore((s) => s.gallerySortMode);
  const sortDir = useSessionStore((s) => s.gallerySortDir);
  const hiddenTypes = useSessionStore((s) => s.galleryHiddenTypes);
  const selectedTags = useSessionStore((s) => s.galleryTags);
  const groups = useDocumentStore(useShallow((s) => s.doc.groups));
  // 'off' = normal index · 'list' = the groups grid · other = one group's index
  const [groupMode, setGroupMode] = useState<'off' | 'list' | string>('off');
  // Pages: the ids to show (empty = every page). Only offered on multi-page boards.
  const [pageFilter, setPageFilter] = useState<string[]>([]);
  const pages = useDocumentStore(useShallow((s) => s.doc.pages));
  const firstPg = pages[0]?.id ?? null;
  // Double-clicking the header title while viewing a group renames it in place.
  const [renamingGroup, setRenamingGroup] = useState(false);
  const renameCancelled = useRef(false);
  // While one group is on screen, the lightbox arrows cycle only its members.
  const scopedGroup = groupMode !== 'off' && groupMode !== 'list' ? groupMode : null;
  useEffect(() => {
    useSessionStore.getState().setLightboxGroupScope(scopedGroup);
    return () => useSessionStore.getState().setLightboxGroupScope(null);
  }, [scopedGroup]);
  const groupsWithMembers = useMemo(
    () =>
      Object.values(groups)
        .map((g) => ({
          group: g,
          members: items.filter((i) => isInsideGroup(useDocumentStore.getState().doc, i, g.id)),
        }))
        .filter((g) => g.members.length > 0),
    [groups, items],
  );
  // The viewed group can vanish (ungrouped elsewhere) — adjust during render
  // (the React-docs "derived state from previous render" pattern).
  if (
    groupMode !== 'off' &&
    groupMode !== 'list' &&
    !groupsWithMembers.some((g) => g.group.id === groupMode)
  ) {
    setGroupMode(groupsWithMembers.length ? 'list' : 'off');
  }

  const displayed = useMemo(() => {
    const sorted = sortFilterGallery(items, {
      mode: sortMode,
      dir: sortDir,
      hiddenTypes,
      tags: selectedTags,
      order,
    });
    const paged = pageFilter.length
      ? sorted.filter((i) => pageFilter.includes(i.pageId ?? firstPg ?? ''))
      : sorted;
    return groupMode !== 'off' && groupMode !== 'list'
      ? paged.filter((i) => i.groupId === groupMode)
      : paged;
  }, [items, sortMode, sortDir, hiddenTypes, selectedTags, order, groupMode, pageFilter, firstPg]);

  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; before: boolean } | null>(null);
  const clearDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDropInfo(null);
  };
  const reorder = (targetId: string, before: boolean) => {
    const dragged = dragIdRef.current;
    if (!dragged || dragged === targetId) return;
    const ids = displayed.map((i) => i.id).filter((id) => id !== dragged);
    let ti = ids.indexOf(targetId);
    if (ti < 0) return;
    if (!before) ti += 1;
    ids.splice(ti, 0, dragged);
    const hidden = items.map((i) => i.id).filter((id) => !ids.includes(id));
    updateBoardSettings({ galleryOrder: [...ids, ...hidden] });
  };
  // A view persisted on the other form factor maps to its nearest equivalent.
  const mobile = isMobileViewport();
  // The page picker's summary: all, one name, or a count.
  const pagesLabel =
    pageFilter.length === 0
      ? 'All pages'
      : pageFilter.length === 1
        ? (pages.find((p) => p.id === pageFilter[0])?.name ?? '1 page')
        : `${pageFilter.length} pages`;
  const effView: GalleryView = mobile
    ? view === 'masonry' || view === 'grid'
      ? 'small'
      : view
    : view === 'small' || view === 'large'
      ? 'grid'
      : view;
  const manualGrid = effView !== 'list' && effView !== 'blog' && sortMode === 'manual';
  const dndFor = (id: string): CardDnd => ({
    dragging: dragId === id,
    dropEdge: dropInfo?.id === id ? (dropInfo.before ? 'before' : 'after') : null,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      dragIdRef.current = id;
      setDragId(id);
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIdRef.current === id) {
        setDropInfo(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      setDropInfo((prev) => (prev?.id === id && prev.before === before ? prev : { id, before }));
    },
    onDrop: (e) => {
      e.preventDefault();
      reorder(id, dropInfo?.before ?? true);
      clearDrag();
    },
    onDragEnd: () => clearDrag(),
  });

  // Framed under a host bar that names the board, the heading is just the view.
  const titlePrefix = FRAMED_VIEWER ? '' : `${boardName} · `;

  return (
    <div className="gallery-screen" data-testid="gallery-screen">
      <header className="gallery-header">
        <div className="gallery-header-left">
          <UiTooltip label="Filter by type & tags">
            <button
              type="button"
              className="gallery-filter-btn"
              onClick={() => setSideOpen(true)}
              aria-label="Filters"
              data-testid="gallery-filter-btn"
            >
              <FilterIcon size={17} />
            </button>
          </UiTooltip>
          {groupMode !== 'off' && (
            <button
              type="button"
              className="gallery-group-back"
              onClick={() => setGroupMode(groupMode === 'list' ? 'off' : 'list')}
              data-testid="gallery-group-back"
            >
              {groupMode === 'list' ? '‹ All Items' : '‹ Groups'}
            </button>
          )}
          <h1 data-testid="gallery-title">
            {groupMode === 'off' || groupMode === 'list' ? (
              `${titlePrefix}${groupMode === 'list' ? 'Groups' : 'Gallery'}`
            ) : (
              <>
                {titlePrefix}
                {renamingGroup ? (
                  <input
                    className="gallery-title-input"
                    data-testid="gallery-group-name-input"
                    defaultValue={groups[groupMode]?.name ?? ''}
                    placeholder="Group name"
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      if (!renameCancelled.current) renameGroup(groupMode, e.currentTarget.value);
                      setRenamingGroup(false);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') {
                        renameCancelled.current = true;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <span
                    className="gallery-title-group"
                    data-testid="gallery-group-title"
                    title="Double-click to rename this group"
                    onDoubleClick={() => {
                      renameCancelled.current = false;
                      setRenamingGroup(true);
                    }}
                  >
                    {groups[groupMode]?.name ?? 'Group'}
                  </span>
                )}
              </>
            )}
          </h1>
          {groupMode !== 'off' && groupMode !== 'list' && !import.meta.env.VIEWER && (
            <DM.Root>
              <DM.Trigger asChild>
                <button
                  type="button"
                  className="gallery-group-export"
                  data-testid="gallery-group-export"
                  title="Export this group"
                >
                  <ExportIcon size={14} /> Export
                </button>
              </DM.Trigger>
              <DM.Portal>
                <DM.Content
                  className="menu-panel menu-list menubar-dropdown"
                  align="start"
                  sideOffset={4}
                  collisionPadding={8}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <RadixEntries
                    entries={[
                      {
                        kind: 'action',
                        label: 'Files (.zip)',
                        onSelect: () => void exportGroupAsPlainZip(groupMode),
                      },
                      {
                        kind: 'action',
                        label: 'Image (.png)',
                        onSelect: () => void exportGroupAsPng(groupMode),
                      },
                      {
                        kind: 'action',
                        label: 'Board archive (.boardcache)',
                        onSelect: () => void exportGroupAsArchive(groupMode),
                      },
                    ]}
                  />
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          )}
        </div>
        <div className="gallery-actions">
          {groupsWithMembers.length > 0 && (
            <UiTooltip label={groupMode === 'off' ? 'View groups' : 'Back to all items'}>
              <button
                type="button"
                className={`gallery-filter-btn gallery-groups-btn${groupMode !== 'off' ? ' active' : ''}`}
                onClick={() => setGroupMode(groupMode === 'off' ? 'list' : 'off')}
                aria-pressed={groupMode !== 'off'}
                data-testid="gallery-groups-btn"
              >
                <LayersIcon size={17} />
              </button>
            </UiTooltip>
          )}
          {/* A view-only board (the viewer) has nothing to add. */}
          {!import.meta.env.VIEWER && <AddMenuButton className="gallery-add-btn" />}
          {pages.length > 1 && (
            <DM.Root>
              <DM.Trigger asChild>
                <button
                  type="button"
                  className={`ui-select-trigger gallery-pages-btn${mobile ? ' ui-select-icon' : ''}${pageFilter.length ? ' active' : ''}`}
                  aria-label="Pages"
                  title={pagesLabel}
                  data-testid="gallery-page-filter"
                >
                  {mobile ? (
                    <PagesIcon size={16} />
                  ) : (
                    <>
                      <span>{pagesLabel}</span>
                      <span className="ui-select-caret">
                        <ChevronDownIcon size={16} />
                      </span>
                    </>
                  )}
                </button>
              </DM.Trigger>
              <DM.Portal>
                <DM.Content
                  className="menu-panel menu-list menubar-dropdown"
                  align="start"
                  sideOffset={6}
                  collisionPadding={8}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <RadixEntries
                    entries={[
                      {
                        kind: 'action',
                        label: 'All pages',
                        checked: pageFilter.length === 0,
                        keepOpen: true,
                        onSelect: () => setPageFilter([]),
                      },
                      { kind: 'separator' },
                      ...pages.map((p) => ({
                        kind: 'action' as const,
                        label: p.name,
                        checked: pageFilter.includes(p.id),
                        keepOpen: true,
                        onSelect: () =>
                          setPageFilter((cur) =>
                            cur.includes(p.id) ? cur.filter((id) => id !== p.id) : [...cur, p.id],
                          ),
                      })),
                    ]}
                  />
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          )}
          <div className="gallery-sort">
            <UiSelect
              value={sortMode}
              options={SORT_MODES}
              onChange={(v) => useSessionStore.getState().setGallerySortMode(v as GallerySortMode)}
              ariaLabel="Sort by"
              testId="gallery-sort-mode"
              {...(mobile ? { trigger: <SortIcon size={16} /> } : {})}
            />
            <UiTooltip label={sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'}>
              <button
                type="button"
                className="gallery-sort-dir"
                disabled={sortMode === 'manual'}
                onClick={() =>
                  useSessionStore.getState().setGallerySortDir(sortDir === 'asc' ? 'desc' : 'asc')
                }
                data-testid="gallery-sort-dir"
                aria-label="Sort direction"
              >
                {sortDir === 'asc' ? <ArrowUpIcon size={14} /> : <ArrowDownIcon size={14} />}
              </button>
            </UiTooltip>
          </div>
          <label className="gallery-scale" title="Thumbnail size">
            <input
              type="range"
              min={GALLERY_SCALE.min}
              max={GALLERY_SCALE.max}
              step={20}
              value={scale}
              onChange={(e) => useSessionStore.getState().setGalleryScale(Number(e.target.value))}
              data-testid="gallery-scale"
              aria-label="Thumbnail size"
            />
          </label>
          <UiTooltip label="Show item titles">
            <button
              type="button"
              className={`gallery-captions-btn${captions ? ' active' : ''}`}
              onClick={() => useSessionStore.getState().setGalleryCaptions(!captions)}
              data-testid="gallery-captions-toggle"
              aria-label="Show item titles"
              aria-pressed={captions}
            >
              <CaptionsIcon size={16} />
            </button>
          </UiTooltip>
          <div className="seg seg-icons layout-toggle" role="group" aria-label="View">
            {(mobile ? MOBILE_VIEWS : DESKTOP_VIEWS).map((v) => (
              <UiTooltip key={v.view} label={v.label}>
                <button
                  type="button"
                  className={effView === v.view ? 'active' : ''}
                  aria-pressed={effView === v.view}
                  aria-label={v.label}
                  data-testid={`gallery-view-${v.view}`}
                  onClick={() => {
                    setView(v.view);
                    localStorage.setItem(GALLERY_VIEW_KEY, v.view);
                  }}
                >
                  {v.view === 'masonry' ? (
                    <MasonryIcon size={15} />
                  ) : v.view === 'grid' || v.view === 'small' ? (
                    <GridSmallIcon size={15} />
                  ) : v.view === 'large' ? (
                    <GridIcon size={15} />
                  ) : v.view === 'list' ? (
                    <ListIcon size={15} />
                  ) : (
                    <BlogViewIcon size={15} />
                  )}
                </button>
              </UiTooltip>
            ))}
          </div>
          <ThemeToggle className="gallery-theme-toggle" testId="gallery-theme-toggle" />
          <UiTooltip label="Back to the canvas">
            <button
              type="button"
              className="gallery-back"
              onClick={() => useSessionStore.getState().setView('canvas')}
              aria-label="Back to canvas"
              data-testid="gallery-back"
            >
              <BoardsIcon size={17} />
            </button>
          </UiTooltip>
        </div>
      </header>

      <div className="corner-controls gallery-corners">
        <PluginCornerButtons />
      </div>

      <div className="gallery-body">
        {sideOpen && (
          <div
            className="gallery-side-backdrop"
            data-testid="gallery-side-backdrop"
            onClick={() => setSideOpen(false)}
          />
        )}
        <GallerySidebar
          items={items}
          hiddenTypes={hiddenTypes}
          selectedTags={selectedTags}
          open={sideOpen}
          groups={groupsWithMembers}
          activeGroup={groupMode !== 'off' && groupMode !== 'list' ? groupMode : null}
          onSelectGroup={(id) => setGroupMode(id ?? 'off')}
        />
        <div className="gallery-main">
          {groupMode === 'list' ? (
            <div className="gallery-groups" data-testid="gallery-groups">
              {groupsWithMembers.map(({ group, members }) => (
                <button
                  key={group.id}
                  type="button"
                  className="gallery-group-card"
                  data-testid="gallery-group-card"
                  onClick={() => setGroupMode(group.id)}
                >
                  <span className="gallery-group-collage">
                    {members.slice(0, 4).map((m) => (
                      <GroupMiniThumb key={m.id} item={m} />
                    ))}
                  </span>
                  <span className="gallery-group-name">{group.name ?? 'Group'}</span>
                  <span className="gallery-group-count">
                    {members.length} item{members.length === 1 ? '' : 's'}
                  </span>
                </button>
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="gallery-empty">This board is empty.</p>
          ) : displayed.length === 0 ? (
            <p className="gallery-empty">No items match the filter.</p>
          ) : effView === 'masonry' ? (
            <MasonryLayout items={displayed} cell={scale} captions={captions} />
          ) : effView === 'list' ? (
            <div className="gallery-list" data-testid="gallery-layout">
              {displayed.map((item) => (
                <div className="gallery-list-row" key={item.id}>
                  <GalleryItemCard item={item} layout="grid" captions={true} />
                  <span className="gallery-list-date">{dateAdded(item)}</span>
                </div>
              ))}
            </div>
          ) : effView === 'blog' ? (
            <div className="gallery-blog" data-testid="gallery-layout">
              {displayed.map((item) => (
                <GalleryBlogRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div
              className={`gallery-grid size-${effView === 'grid' ? 'grid' : effView}`}
              data-testid="gallery-layout"
              style={{
                ['--gallery-cell' as string]: `${
                  effView === 'grid' ? scale : VIEW_CELL[effView as 'small' | 'large']
                }px`,
              }}
            >
              {displayed.map((item) => (
                <GalleryItemCard
                  key={item.id}
                  item={item}
                  layout="grid"
                  captions={captions}
                  {...(manualGrid ? { dnd: dndFor(item.id) } : {})}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
