import type {
  AudioItem,
  CaseItem,
  ContactItem,
  ContactlistItem,
  EmailItem,
  EventItem,
  Item,
  KanbanItem,
  LinkItem,
  ProjectItem,
  RecipeItem,
  StoryboardItem,
  TasklistItem,
  TierlistItem,
} from '@boardcache/schema';
import { CASE_CARD_W } from '../structure/cases';
import { CONTACT_CARD_W, CONTACT_LIST_W } from '../structure/contacts';
import { EMAIL_CARD_W } from '../mail/email';
import { EVENT_CARD_W } from '../structure/events';
import { PROJECT_CARD_W } from '../structure/projects';
import { tasklistBaseW } from '../structure/tasklist';

/**
 * Zoomed cards (Task List, Project, Case, Link button, Storyboard, Event, Contact, Contact List, Email,
 * Tier List, Recipe, Audio player): content renders at a design width and is zoomed by `zoom`. Only UNIFORM scales change the zoom — a corner drag or
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
  | ContactItem
  | ContactlistItem
  | EmailItem
  | TierlistItem
  | KanbanItem
  | RecipeItem
  | AudioItem;

export function isZoomCard(item: Item | undefined): item is ZoomCard {
  return (
    item?.type === 'tasklist' ||
    item?.type === 'project' ||
    item?.type === 'case' ||
    item?.type === 'link' ||
    item?.type === 'storyboard' ||
    item?.type === 'event' ||
    item?.type === 'contact' ||
    item?.type === 'contactlist' ||
    item?.type === 'email' ||
    item?.type === 'tierlist' ||
    item?.type === 'kanban' ||
    item?.type === 'recipe' ||
    item?.type === 'audio'
  );
}

/** The zoom a link button had under the retired S/M/L sizes (15px = 1). */
const LINK_SIZE_ZOOM = { s: 12 / 15, m: 1, l: 20 / 15 } as const;

/** The recipe card's design width: the summary (hero, title, chips, a few
 *  ingredients) is laid out at 360 and zoomed. */
export const RECIPE_CARD_W = 360;

function cardBaseW(
  item: Exclude<ZoomCard, LinkItem | StoryboardItem | AudioItem | TierlistItem | KanbanItem>,
): number {
  if (item.type === 'tasklist') return tasklistBaseW(item);
  if (item.type === 'event') return EVENT_CARD_W;
  if (item.type === 'contact') return CONTACT_CARD_W;
  if (item.type === 'contactlist') return CONTACT_LIST_W;
  if (item.type === 'email') return EMAIL_CARD_W;
  if (item.type === 'recipe') return RECIPE_CARD_W;
  return item.type === 'case' ? CASE_CARD_W : PROJECT_CARD_W;
}

export function cardZoom(item: ZoomCard): number {
  if (item.type === 'link') return item.zoom ?? LINK_SIZE_ZOOM[item.size];
  if (
    item.type === 'storyboard' ||
    item.type === 'audio' ||
    item.type === 'tierlist' ||
    item.type === 'kanban'
  )
    return item.zoom ?? 1;
  return item.zoom ?? item.width / Math.max(1, cardBaseW(item));
}
