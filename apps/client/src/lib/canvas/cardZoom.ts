import type { CaseItem, Item, ProjectItem, TasklistItem } from '@boardcache/schema';
import { CASE_CARD_W } from '../structure/cases';
import { PROJECT_CARD_W } from '../structure/projects';
import { tasklistBaseW } from '../structure/tasklist';

/**
 * Zoomed cards (Task List, Project): content renders at a design width and
 * is zoomed by `zoom`. Only UNIFORM scales change the zoom — a corner drag or
 * the mobile Scale lock; edge drags change just the box, so the content
 * reflows into it. Cards saved before `zoom` existed derive it from their
 * width (the old rule), so they look unchanged until first resized.
 */
export type ZoomCard = TasklistItem | ProjectItem | CaseItem;

export function isZoomCard(item: Item | undefined): item is ZoomCard {
  return item?.type === 'tasklist' || item?.type === 'project' || item?.type === 'case';
}

function cardBaseW(item: ZoomCard): number {
  if (item.type === 'tasklist') return tasklistBaseW(item);
  return item.type === 'case' ? CASE_CARD_W : PROJECT_CARD_W;
}

export function cardZoom(item: ZoomCard): number {
  return item.zoom ?? item.width / Math.max(1, cardBaseW(item));
}
