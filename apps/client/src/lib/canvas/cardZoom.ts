import type {
  AudioItem,
  CaseItem,
  EventItem,
  Item,
  LinkItem,
  ProjectItem,
  StoryboardItem,
  TasklistItem,
} from '@boardcache/schema';
import { CASE_CARD_W } from '../structure/cases';
import { EVENT_CARD_W } from '../structure/events';
import { PROJECT_CARD_W } from '../structure/projects';
import { tasklistBaseW } from '../structure/tasklist';

/**
 * Zoomed cards (Task List, Project, Case, Link button, Storyboard, Event, Audio
 * player): content renders at a design width and is zoomed by `zoom`. Only UNIFORM scales change the zoom — a corner drag or
 * the mobile Scale lock; edge drags change just the box, so the content
 * reflows into it. Cards saved before `zoom` existed derive it from their
 * width (the old rule), so they look unchanged until first resized.
 */
export type ZoomCard =
  | TasklistItem
  | ProjectItem
  | CaseItem
  | LinkItem
  | StoryboardItem
  | EventItem
  | AudioItem;

export function isZoomCard(item: Item | undefined): item is ZoomCard {
  return (
    item?.type === 'tasklist' ||
    item?.type === 'project' ||
    item?.type === 'case' ||
    item?.type === 'link' ||
    item?.type === 'storyboard' ||
    item?.type === 'event' ||
    item?.type === 'audio'
  );
}

/** The zoom a link button had under the retired S/M/L sizes (15px = 1). */
const LINK_SIZE_ZOOM = { s: 12 / 15, m: 1, l: 20 / 15 } as const;

function cardBaseW(item: Exclude<ZoomCard, LinkItem | StoryboardItem | AudioItem>): number {
  if (item.type === 'tasklist') return tasklistBaseW(item);
  if (item.type === 'event') return EVENT_CARD_W;
  return item.type === 'case' ? CASE_CARD_W : PROJECT_CARD_W;
}

export function cardZoom(item: ZoomCard): number {
  if (item.type === 'link') return item.zoom ?? LINK_SIZE_ZOOM[item.size];
  if (item.type === 'storyboard' || item.type === 'audio') return item.zoom ?? 1;
  return item.zoom ?? item.width / Math.max(1, cardBaseW(item));
}
