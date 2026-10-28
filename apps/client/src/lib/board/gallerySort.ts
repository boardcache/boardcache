import type { Item } from '@boardcache/schema';
import { mediaMeta } from '../mediaItems';
import { hasTag } from '../text/tags';
import type { GallerySortMode, SortDir } from '../../state/sessionStore';

export interface GalleryView {
  mode: GallerySortMode;
  dir: SortDir;
  hiddenTypes: string[];
  /** Tags to include (any-match). Empty means no tag filtering. */
  tags: string[];
  /** Manual order (item ids); only used when mode === 'manual'. */
  order: string[];
}

/** Human label per media type, for the filter sidebar. */
export const TYPE_LABELS: Record<string, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  pdf: 'PDFs',
  epub: 'ePubs',
  title: 'Titles',
  text: 'Text',
  swatch: 'Colors',
  palette: 'Palettes',
  shape: 'Shapes',
  arrow: 'Arrows',
  link: 'Links',
  iframe: 'Webpages',
  htmlembed: 'Documents',
  code: 'Code',
  qr: 'QR Codes',
  playlist: 'Playlists',
  font: 'Fonts',
  rss: 'RSS Feeds',
  time: 'Time Widgets',
  event: 'Events',
  map: 'Maps',
  recipe: 'Recipes',
  poll: 'Polls',
  tasklist: 'Task Lists',
  project: 'Projects',
  timeline: 'Timelines',
  tierlist: 'Tier Lists',
  case: 'Cases',
  storyboard: 'Storyboards',
  tree: 'Trees',
};

const TYPE_ORDER = Object.keys(TYPE_LABELS);

/** The distinct media types present, in a stable display order. */
export function presentTypes(items: Item[]): string[] {
  const present = new Set<string>(items.map((it) => it.type));
  return TYPE_ORDER.filter((t) => present.has(t));
}

function galleryName(item: Item): string {
  return (item.name ?? mediaMeta(item).title).toLowerCase();
}

/** Apply the gallery type filter and sort. Shared by the grid and masonry. */
export function sortFilterGallery(items: Item[], view: GalleryView): Item[] {
  const visible = items.filter(
    (it) =>
      !view.hiddenTypes.includes(it.type) &&
      (view.tags.length === 0 || view.tags.some((t) => hasTag(it, t))),
  );

  if (view.mode === 'manual') {
    const rank = new Map(view.order.map((id, i) => [id, i]));
    // Items not yet in the manual order keep their incoming order, after the rest.
    return visible
      .map((it, i) => ({ it, key: rank.has(it.id) ? rank.get(it.id)! : view.order.length + i }))
      .sort((a, b) => a.key - b.key)
      .map((d) => d.it);
  }

  const decorated = visible.map((it) => ({
    it,
    name: galleryName(it),
    date: it.createdAt ?? '',
    type: it.type,
    weight: it.weight ?? 0,
  }));
  decorated.sort((a, b) => {
    let c: number;
    if (view.mode === 'name') c = a.name.localeCompare(b.name);
    else if (view.mode === 'date') c = a.date.localeCompare(b.date);
    // Strength: strongest first within the chosen direction; unrated last either way.
    else if (view.mode === 'weight') c = b.weight - a.weight || a.name.localeCompare(b.name);
    else c = a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
    return c;
  });
  const sorted = decorated.map((d) => d.it);
  return view.dir === 'desc' ? sorted.reverse() : sorted;
}
