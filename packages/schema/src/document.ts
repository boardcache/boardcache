import { z } from 'zod';
import { itemSchema } from './items';

export const SCHEMA_VERSION = 84;

export const viewportSchema = z.object({
  /** screen-space translation in px */
  x: z.number(),
  y: z.number(),
  scale: z.number().positive(),
});
export type Viewport = z.infer<typeof viewportSchema>;

/** A background image (board or group): stored asset + fit + opacity. */
export const backgroundImageSchema = z.object({
  assetId: z.string(),
  mode: z.enum(['cover', 'contain', 'tile', 'center']).default('cover'),
  opacity: z.number().min(0).max(1).default(1),
});
export type BackgroundImage = z.infer<typeof backgroundImageSchema>;

export const boardSettingsSchema = z.object({
  /** CSS color or the literal 'default' (theme-driven) */
  background: z.string(),
  /** Optional wallpaper image behind the canvas (viewport-fixed). */
  backgroundImage: backgroundImageSchema.nullable().default(null),
  gridVisible: z.boolean(),
  gridOpacity: z.number().min(0).max(1),
  /** Grid pattern; parse-time default keeps older documents valid. */
  gridType: z.enum(['square', 'dots', 'diagonal', 'isometric', 'checker']).default('square'),
  /** Item ids in the user's manual gallery order (empty = no manual order). */
  galleryOrder: z.array(z.string()).default([]),
  /** Item whose region renders the board's cover/thumbnail (null = whole board). */
  coverItemId: z.string().nullable().default(null),
  /** Board-specific theme family override (absent = the app's global theme).
   *  Unknown/custom ids missing on a device fall back to the default family. */
  themeId: z.string().optional(),
  /** Personal template: hidden from the library grid, offered in the
   *  template picker; "use" duplicates it into a fresh board. */
  isTemplate: z.boolean().default(false),
});
export type BoardSettings = z.infer<typeof boardSettingsSchema>;

/**
 * A page (Figma-style sheet) inside the board: items partition by
 * `item.pageId` (absent = the FIRST page); each page keeps its own viewport
 * and optional appearance OVERRIDES (absent field = inherit board settings).
 */
export const boardPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  viewport: z.object({ x: z.number(), y: z.number(), scale: z.number() }),
  background: z.string().optional(),
  backgroundImage: backgroundImageSchema.nullable().optional(),
  gridVisible: z.boolean().optional(),
  gridOpacity: z.number().min(0).max(1).optional(),
  gridType: z.enum(['square', 'dots', 'diagonal', 'isometric', 'checker']).optional(),
  themeId: z.string().optional(),
});
export type BoardPage = z.infer<typeof boardPageSchema>;

export const groupSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  /** The group this one nests inside (absent = top level). Items carry the
   *  innermost group; a group's members are every item whose chain passes
   *  through it. */
  parentId: z.string().optional(),
  /** Optional container background behind the grouped items (#rrggbb). */
  background: z.string().optional(),
  /** Background opacity 0..1 (absent = fully opaque). */
  backgroundOpacity: z.number().min(0).max(1).optional(),
  /** Optional image behind the grouped items (own fit + opacity). */
  backgroundImage: backgroundImageSchema.optional(),
});
export type Group = z.infer<typeof groupSchema>;

/** One end of a connection: a canvas item or a whole group. */
export const connectionEndpointSchema = z.object({
  kind: z.enum(['item', 'group']),
  id: z.string(),
});
export type ConnectionEndpoint = z.infer<typeof connectionEndpointSchema>;

/**
 * A visual + semantic link between two things on the canvas. Rendered as a
 * connector line; kept in the document so other features (search, chat, RAG,
 * export) can walk the relationship graph.
 */
/** Semantic relation a connection expresses (research vocabulary). */
export const connectionRelSchema = z.enum([
  'relates',
  'supports',
  'contradicts',
  'causes',
  'cites',
  'depends',
  'partof',
  'follows',
  'inspires',
  'duplicates',
]);
export type ConnectionRel = z.infer<typeof connectionRelSchema>;

export const connectionSchema = z.object({
  id: z.string(),
  from: connectionEndpointSchema,
  to: connectionEndpointSchema,
  /** Optional short label shown at the line's midpoint. */
  label: z.string().optional(),
  /** What the link MEANS — colors the line and drives graph filters. */
  rel: connectionRelSchema.default('relates'),
});
export type Connection = z.infer<typeof connectionSchema>;

/**
 * A comment attached to a canvas item. Doc-level record (like connections)
 * so item duplication doesn't clone threads and pruning is central. Author
 * fields are display-only snapshots (name + presence color at post time).
 */
export const commentSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  author: z.string(),
  /** Presence/author color at post time (#rrggbb); optional for older data. */
  color: z.string().optional(),
  /** Author's account id when signed in — lets team UIs show their avatar. */
  userId: z.string().optional(),
  text: z.string(),
  createdAt: z.string(),
});
export type BoardComment = z.infer<typeof commentSchema>;

export const presentationStepSchema = z.object({
  /** An item id or a group id — the camera frames it. */
  id: z.string(),
  /** A custom camera for the step: world-space centre + scale (absent =
   *  auto-framed). Centre-based so it lands the same on any screen size. */
  view: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }).optional(),
});
export type PresentationView = NonNullable<z.infer<typeof presentationStepSchema>['view']>;
export type PresentationStep = z.infer<typeof presentationStepSchema>;
export const presentationSchema = z.object({
  steps: z.array(presentationStepSchema).default([]),
});

export const canvasDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  viewport: viewportSchema,
  settings: boardSettingsSchema,
  /** Pages (absent/empty = a single-page board). The first entry is the
   *  default page that `item.pageId`-less items belong to. */
  pages: z.array(boardPageSchema).default([]),
  /** ONE map — never per-type arrays (architectural rule 3.2). */
  items: z.record(z.string(), itemSchema),
  groups: z.record(z.string(), groupSchema),
  /** Connector lines between items/groups (defaulted for older docs). */
  connections: z.record(z.string(), connectionSchema).default({}),
  /** Comments on items (defaulted for older docs). */
  comments: z.record(z.string(), commentSchema).default({}),
  /** Presentation Mode: the ordered steps (item or group ids). */
  presentation: presentationSchema.default({ steps: [] }),
});
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
