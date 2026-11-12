import type { ReactNode } from 'react';
import type { Item } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { itemType } from '../../itemTypes';
import {
  ArrowIcon,
  BookIcon,
  CalendarIcon,
  ChefHatIcon,
  ClockIcon,
  CodeIcon,
  ContactIcon,
  ContactListIcon,
  DotIcon,
  DropletIcon,
  FileDownIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  HeadingIcon,
  ImageIcon,
  KanbanIcon,
  ColumnsIcon,
  LayersIcon,
  LinkIcon,
  ListChecksIcon,
  MapPinIcon,
  MilestoneIcon,
  NetworkIcon,
  PaletteIcon,
  PlaylistIcon,
  QrIcon,
  RssIcon,
  ScaleIcon,
  ShapesIcon,
  StickyNoteIcon,
  TypeIcon,
  VideoIcon,
  VolumeIcon,
  VoteIcon,
} from '../icons';

/** The asset a small picture of an item comes from, if it has one. */
export function thumbAssetOf(item: Item): string | null {
  const def = itemType(item);
  if (item.type === 'image') return item.previewAssetId ?? item.assetId;
  if (item.type === 'contact') return item.photoAssetId;
  return def.cardAsset?.(item) ?? null;
}

/** A symbol for an item's kind, for items with no picture of their own. */
const KIND_ICONS: Record<string, ReactNode> = {
  image: <ImageIcon />,
  video: <VideoIcon />,
  audio: <VolumeIcon />,
  text: <StickyNoteIcon />,
  swatch: <DropletIcon />,
  palette: <PaletteIcon />,
  shape: <ShapesIcon />,
  point: <DotIcon />,
  arrow: <ArrowIcon />,
  pdf: <FileTextIcon />,
  epub: <BookIcon />,
  title: <HeadingIcon />,
  link: <LinkIcon />,
  iframe: <GlobeIcon />,
  htmlembed: <FileIcon />,
  file: <FileDownIcon />,
  code: <CodeIcon />,
  playlist: <PlaylistIcon />,
  qr: <QrIcon />,
  time: <ClockIcon />,
  event: <CalendarIcon />,
  contact: <ContactIcon />,
  contactlist: <ContactListIcon />,
  tree: <NetworkIcon />,
  tasklist: <ListChecksIcon />,
  project: <KanbanIcon />,
  tierlist: <LayersIcon />,
  kanban: <ColumnsIcon />,
  case: <ScaleIcon />,
  storyboard: <FilmIcon />,
  timeline: <MilestoneIcon />,
  poll: <VoteIcon />,
  recipe: <ChefHatIcon />,
  font: <TypeIcon />,
  rss: <RssIcon />,
  map: <MapPinIcon />,
};

export function kindIcon(item: Item): ReactNode {
  return KIND_ICONS[item.type] ?? <FileIcon />;
}

/** A small picture of an item: its image, its card's asset, its colour, or
 *  the symbol of its kind, centred. */
export function ItemThumb({ item }: { item: Item }) {
  const url = useAssetUrl(thumbAssetOf(item));
  if (url) return <img src={url} alt="" draggable={false} />;
  const color = itemType(item).cardColor?.(item);
  if (color) return <i style={{ background: color }} />;
  return (
    <i className="item-thumb-chip" aria-hidden>
      {kindIcon(item)}
    </i>
  );
}
