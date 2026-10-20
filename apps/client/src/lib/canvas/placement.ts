import type { CanvasDocument } from '@boardcache/schema';
import type { Point } from './coords';
import { activePageId, pageItems } from '../board/pages';
import { contentBounds } from '../media/thumbnail';

/** Breathing room between a newly-placed box and existing content. */
const GAP = 120;

export interface BesidePlacement {
  /** Top-left for the new box. */
  topLeft: Point;
  /** Placed above the content → grow upward (pin the bottom) as it fills. */
  growUp: boolean;
  /** Placed left of the content → widen leftward (pin the right edge). */
  growLeft: boolean;
}

/**
 * Place a `width`×`height` box just outside the existing content on a random
 * side (right / left / below / above), centered along that edge — so it never
 * lands on top of items. With no content yet, it falls back to `fallbackCenter`.
 */
export function placeBesideContent(
  doc: CanvasDocument,
  width: number,
  height: number,
  fallbackCenter: Point,
): BesidePlacement {
  // Beside the ACTIVE page's content; other pages are elsewhere.
  const bounds = contentBounds(doc, pageItems(doc, activePageId(doc)));
  if (!bounds) {
    return {
      topLeft: { x: fallbackCenter.x - width / 2, y: fallbackCenter.y - height / 2 },
      growUp: false,
      growLeft: false,
    };
  }
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  switch (Math.floor(Math.random() * 4)) {
    case 0: // right
      return {
        topLeft: { x: bounds.x + bounds.width + GAP, y: cy - height / 2 },
        growUp: false,
        growLeft: false,
      };
    case 1: // left — widen leftward so it never grows into the content
      return {
        topLeft: { x: bounds.x - GAP - width, y: cy - height / 2 },
        growUp: false,
        growLeft: true,
      };
    case 2: // below
      return {
        topLeft: { x: cx - width / 2, y: bounds.y + bounds.height + GAP },
        growUp: false,
        growLeft: false,
      };
    default: // above — grow upward, away from the content
      return {
        topLeft: { x: cx - width / 2, y: bounds.y - GAP - height },
        growUp: true,
        growLeft: false,
      };
  }
}
