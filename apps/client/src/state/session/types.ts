import type { ShapeKind } from '@boardcache/schema';
import type { Point } from '../../lib/canvas/coords';
import type { BoundsPatch } from '../commands';
import type { Gradient } from '@boardcache/schema';

/**
 * Session store (rule 3.5): ephemeral interaction state. Never serialized,
 * never in undo history.
 *
 * Tools are a state machine (rule 3.6): exactly one tool is active at a time;
 * activating a tool exits the previous one by construction.
 */
export type DrawToolId =
  | 'shape:rect'
  | 'shape:ellipse'
  | 'shape:diamond'
  | 'shape:star'
  | 'shape:line'
  | 'shape:arrow'
  | 'shape:draw'
  | 'shape:path';

export type ToolId = 'select' | 'pan' | DrawToolId;

export type CaptureMode = 'photo' | 'video' | 'voice' | 'screen' | 'screenshot';

/** Map a draw tool to the ShapeKind it produces. */
export const DRAW_TOOL_SHAPE: Record<DrawToolId, ShapeKind> = {
  'shape:rect': 'rect',
  'shape:ellipse': 'ellipse',
  'shape:diamond': 'diamond',
  'shape:star': 'star',
  'shape:line': 'line',
  'shape:arrow': 'arrow',
  'shape:draw': 'draw',
  'shape:path': 'path',
};

export function isDrawTool(tool: ToolId): tool is DrawToolId {
  return tool.startsWith('shape:');
}

export type CommunitySort = 'hot' | 'top' | 'new' | 'popular' | 'favorites' | 'following';

/** Style applied to newly drawn shapes (and edited in the shape panel). */
export interface ShapeStyle {
  stroke: string | null;
  fill: string | null;
  /** Gradient fill; wins over `fill` when set. */
  fillGradient: Gradient | null;
  strokeWidth: number;
  dashed: boolean;
}

/** A pen anchor being built, in canvas coordinates. */
export interface PenDraftNode {
  x: number;
  y: number;
  hix?: number;
  hiy?: number;
  hox?: number;
  hoy?: number;
}

/** The pen tool's in-progress path; rendered by the overlay. */
export interface PenDraft {
  nodes: PenDraftNode[];
  /** Rubber-band target (cursor) in canvas coordinates. */
  cursor: { x: number; y: number } | null;
  /** True while press-dragging the closing anchor: preview the closed path. */
  closing?: boolean;
  style: ShapeStyle;
}

/** Live drawing preview (canvas coordinates); rendered by the overlay. */
export interface ShapeDraft {
  shape: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  flipDiagonal: boolean;
  style: ShapeStyle;
  /** freehand only: raw canvas points */
  points?: Point[];
}

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * An in-progress transform gesture. `overrides` holds the live geometry per
 * item at 60fps; the document is untouched until pointer-up commits ONE
 * command (rule 3.4). Item views and the selection overlay render
 * base-geometry ⊕ override.
 */
export interface Gesture {
  kind: 'move' | 'resize' | 'rotate';
  overrides: Record<string, BoundsPatch>;
  /** A resize that scales content uniformly (corner drag, mobile Scale lock). */
  uniform?: boolean;
}

export type AppView = 'canvas' | 'library' | 'gallery' | 'community' | 'plugin' | 'notfound';

/**
 * A media import shown on the canvas before it becomes a real item — e.g. a
 * HEIC being converted to JPEG. Ephemeral (never serialized); positioned in
 * canvas coordinates so it pans/zooms with everything else.
 */
export interface PendingImport {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Status message shown in the placeholder (e.g. "Loading video"). */
  label: string;
  /** Filename, shown under the label. */
  name: string;
  /** When true the box renders as an error (no spinner). */
  error?: boolean;
}

export type GallerySortMode = 'manual' | 'name' | 'date' | 'type' | 'weight';
export type SortDir = 'asc' | 'desc';
