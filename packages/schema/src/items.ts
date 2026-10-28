import { z } from 'zod';

/**
 * One normalized item model (architectural rule 3.2).
 *
 * Every subsystem (selection, transform, history, serialization, layers,
 * export) is written once against ItemBase and switches on `type` only inside
 * the per-type renderer. Adding a new item type must never require touching
 * selection, history, or persistence code.
 */
/**
 * How an AI-generated item came to be. `provider` is the id shown in settings
 * ('openai', 'google', 'xai', 'comfyui'); `extra` carries provider-specific
 * detail (size, seed, negative prompt, workflow…) as display-ready strings.
 */
export const genInfoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  prompt: z.string().optional(),
  /** Board item the generation transformed (image-to-image / image-to-video). */
  sourceItemId: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});
export type GenInfo = z.infer<typeof genInfoSchema>;

/**
 * Where an item's content came from (research provenance): stamped by the
 * clipper on import, editable later. Drives the Source panel and the
 * board bibliography export.
 */
export const sourceInfoSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  /** ISO timestamp of when the content was captured. */
  capturedAt: z.string().optional(),
  /** Verbatim excerpt quoted from the source. */
  quote: z.string().optional(),
  siteName: z.string().optional(),
  author: z.string().optional(),
});
export type SourceInfo = z.infer<typeof sourceInfoSchema>;

export const itemBaseSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /** degrees */
  rotation: z.number(),
  zIndex: z.number(),
  locked: z.boolean(),
  /** Hidden from the canvas and every render (layers-panel eye). Optional —
   *  absent means visible, so older docs and fixtures don't churn. */
  hidden: z.boolean().optional(),
  /** 0..1 */
  opacity: z.number().min(0).max(1),
  groupId: z.string().nullable(),
  name: z.string().optional(),
  notes: z.string().optional(),
  /** ISO timestamp stamped when the item is added (used for gallery sorting). */
  createdAt: z.string().optional(),
  /** A user-attached URL (any item). Link/iframe/video-embed carry their own. */
  linkUrl: z.string().optional(),
  /** Page this item lives on (absent = the board's first page). */
  pageId: z.string().optional(),
  /** Free-form metadata tags for filtering (any item). */
  tags: z.array(z.string()).optional(),
  /** Evidence status (research boards): badge + dimmed-when-debunked. */
  status: z.enum(['confirmed', 'unverified', 'debunked']).optional(),
  /** Evidence strength, 1 (weak) to 5 (conclusive): how much a case may
   *  lean on this item. Absent = unrated, which counts for nothing. */
  weight: z.number().int().min(1).max(5).optional(),
  /** Provenance for AI-generated media: which model made it, from what. */
  genInfo: genInfoSchema.optional(),
  /** Provenance for captured content: where it came from (clipper imports). */
  source: sourceInfoSchema.optional(),
});

export type ItemBase = z.infer<typeof itemBaseSchema>;

/** Normalized rect in image space, all values 0..1. */
export const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export type Crop = z.infer<typeof cropSchema>;

/** Non-destructive image adjustments; defaults mean "untouched". */
export const imageFiltersSchema = z.object({
  brightness: z.number().default(1),
  contrast: z.number().default(1),
  saturation: z.number().default(1),
  grayscale: z.number().min(0).max(1).default(0),
  invert: z.boolean().default(false),
});
export type ImageFilters = z.infer<typeof imageFiltersSchema>;

export const imageItemSchema = itemBaseSchema.extend({
  type: z.literal('image'),
  /** SHA-256 key into the asset store; media never lives in the document. */
  assetId: z.string(),
  /** Downscaled display rendition (≤2048px WebP) used on the canvas/gallery;
   *  the original asset stays for the lightbox and exports. */
  previewAssetId: z.string().optional(),
  naturalWidth: z.number().positive(),
  naturalHeight: z.number().positive(),
  crop: cropSchema.nullable().default(null),
  filters: imageFiltersSchema.nullable().default(null),
  /** Text extracted from the image by OCR (editable in the lightbox). */
  ocrText: z.string().nullable().default(null),
  /** AI-generated (or hand-written) image description — search metadata
   *  ("Generate Description"); editable in the lightbox. */
  description: z.string().nullable().default(null),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  /** Caption overlay: shows `description` in a corner box on the image. */
  caption: z.boolean().default(false),
  captionCorner: z.enum(['tl', 'tr', 'bl', 'br']).default('bl'),
  /** Inside: a translucent box over the corner. Outside: a bar beside the
   *  image (above for t*, below for b*), the image sharing the box with it. */
  captionPlacement: z.enum(['inside', 'outside']).default('inside'),
  /** Outside captions: wrap onto several lines (up to half the box) or keep one line, clipped. */
  captionWrap: z.boolean().default(true),
  /** Caption backdrop opacity (0..1). */
  captionOpacity: z.number().min(0).max(1).default(0.7),
  /** 360° equirectangular panorama override: true/false forces the pano
   *  viewer on/off; absent = auto-detect (XMP at import, else 2:1 aspect). */
  pano: z.boolean().optional(),
});
export type ImageItem = z.infer<typeof imageItemSchema>;

export const videoProviderSchema = z.enum(['youtube', 'vimeo']);
export type VideoProvider = z.infer<typeof videoProviderSchema>;

/** A provider-hosted video (YouTube/Vimeo) referenced by id, not a blob. */
export const videoEmbedSchema = z.object({
  provider: videoProviderSchema,
  /** Provider video id, e.g. 'dQw4w9WgXcQ' or '76979871'. */
  videoId: z.string(),
  /** Canonical watch URL, for "open original". */
  url: z.string(),
});
export type VideoEmbed = z.infer<typeof videoEmbedSchema>;

/** A labelled time bookmark on a video (file-backed or embed). */
/** One timed transcript segment (seconds); produced by STT verbose output. */
export const transcriptSegmentSchema = z.object({
  t0: z.number().min(0),
  t1: z.number().min(0),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const videoMarkerSchema = z.object({
  /** Seconds from the start. */
  time: z.number().min(0),
  label: z.string(),
});
export type VideoMarker = z.infer<typeof videoMarkerSchema>;

export const videoItemSchema = itemBaseSchema.extend({
  type: z.literal('video'),
  /** File-backed video: SHA-256 asset key. Null for provider embeds. */
  assetId: z.string().nullable().default(null),
  /** Poster/thumbnail frame asset (generated on import, or a provider thumb). */
  posterAssetId: z.string().nullable().default(null),
  /** Provider embed; null for file-backed videos. Exactly one of
   *  assetId / embed is set. */
  embed: videoEmbedSchema.nullable().default(null),
  naturalWidth: z.number().positive(),
  naturalHeight: z.number().positive(),
  muted: z.boolean().default(true),
  /** Playback volume 0..1 (independent of muted). */
  volume: z.number().min(0).max(1).default(1),
  loop: z.boolean().default(false),
  /** Playback speed (0.25..4; 1 = normal). */
  playbackRate: z.number().min(0.25).max(4).default(1),
  /** Speech-to-text transcript (manual per-item run; editable, searchable). */
  transcript: z.string().nullable().default(null),
  /** Timed transcript segments (when the STT run returned them) — the flat
   *  `transcript` stays canonical for search/editing; segments drive
   *  click-to-seek. Stale after manual text edits, refreshed on re-run. */
  transcriptSegments: z.array(transcriptSegmentSchema).nullable().default(null),
  /** Labelled time bookmarks, sorted by time. */
  markers: z.array(videoMarkerSchema).default([]),
});
export type VideoItem = z.infer<typeof videoItemSchema>;

export const audioEmbedSchema = z.object({
  provider: z.enum(['spotify', 'soundcloud']),
  /** The original page URL (also the link target in exports). */
  url: z.string(),
});
export type AudioEmbed = z.infer<typeof audioEmbedSchema>;

export const audioItemSchema = itemBaseSchema.extend({
  type: z.literal('audio'),
  /** Local file asset; null for provider embeds. */
  assetId: z.string().nullable(),
  /** Spotify/SoundCloud embed; null for file-backed audio. */
  embed: audioEmbedSchema.nullable().default(null),
  /** User-facing label (defaults to the imported filename). */
  title: z.string().nullable().default(null),
  /** Speech-to-text transcript (manual per-item run; editable, searchable). */
  transcript: z.string().nullable().default(null),
  /** Timed transcript segments — see the video item's field. */
  transcriptSegments: z.array(transcriptSegmentSchema).nullable().default(null),
  /** Labelled time bookmarks / podcast chapters, sorted by time. */
  markers: z.array(videoMarkerSchema).default([]),
  artist: z.string().nullable().default(null),
  album: z.string().nullable().default(null),
  coverAssetId: z.string().nullable().default(null),
  /** Playback volume 0..1 (independent of muted). */
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(false),
  loop: z.boolean().default(false),
  /** Playback speed multiplier. */
  playbackRate: z.number().min(0.25).max(4).default(1),
  /** Content zoom, set by uniform scales (corner drags). Absent = 1. */
  zoom: z.number().positive().optional(),
});
export type AudioItem = z.infer<typeof audioItemSchema>;

export const textAlignSchema = z.enum(['left', 'center', 'right']);
export type TextAlign = z.infer<typeof textAlignSchema>;

export const textVerticalAlignSchema = z.enum(['top', 'middle', 'bottom']);
export type TextVerticalAlign = z.infer<typeof textVerticalAlignSchema>;

/** Default font-family stack for new text. */
export const DEFAULT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

export const textItemSchema = itemBaseSchema.extend({
  type: z.literal('text'),
  /** Markdown source. Rendered for display; shown raw while editing. */
  text: z.string(),
  /** Base body font size; markdown headings scale up from here. */
  fontSize: z.number().positive(),
  /** CSS font-family stack (box-level). */
  fontFamily: z.string().default(DEFAULT_FONT_FAMILY),
  /** Box-level text color. */
  color: z.string(),
  align: textAlignSchema.default('left'),
  verticalAlign: textVerticalAlignSchema.default('top'),
  /** null = transparent card */
  background: z.string().nullable().default(null),
  /**
   * true (default): the box grows to fit its content. false: the box keeps its
   * set height and scrolls (e.g. AI generations capped at a document size, or a
   * box the user has resized).
   */
  autoHeight: z.boolean().default(true),
});
export type TextItem = z.infer<typeof textItemSchema>;

export const swatchItemSchema = itemBaseSchema.extend({
  type: z.literal('swatch'),
  /** CSS color, canonical form is #rrggbb or #rrggbbaa */
  color: z.string(),
});
export type SwatchItem = z.infer<typeof swatchItemSchema>;

export const paletteEntrySchema = z.object({
  color: z.string(),
  name: z.string().optional(),
});
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;

export const paletteItemSchema = itemBaseSchema.extend({
  type: z.literal('palette'),
  colors: z.array(paletteEntrySchema).min(1),
  /** Asset the palette was extracted from, if any. */
  sourceAssetId: z.string().nullable().default(null),
});
export type PaletteItem = z.infer<typeof paletteItemSchema>;

export const shapeKindSchema = z.enum([
  'rect',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'polygon',
  'star',
  'draw',
  'path',
]);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

/** Normalized point (0..1) within the shape's bounding box. */
export const normPointSchema = z.object({ x: z.number(), y: z.number() });
export type NormPoint = z.infer<typeof normPointSchema>;

/**
 * A pen-tool anchor, normalized within the shape box. Handle-out shapes the
 * curve leaving the anchor, handle-in the curve arriving; both are absolute
 * normalized positions. Absent handles mean a straight corner.
 */
export const pathNodeSchema = z.object({
  x: z.number(),
  y: z.number(),
  hix: z.number().optional(),
  hiy: z.number().optional(),
  hox: z.number().optional(),
  hoy: z.number().optional(),
});
export type PathNode = z.infer<typeof pathNodeSchema>;

/**
 * One box-based primitive type covers every drawn shape (rect, ellipse,
 * diamond, star, polygon), connectors (line, arrow), and freehand (draw).
 * Storing everything in the item box means move/resize/rotate/undo all work
 * through the one transform system with no per-kind special-casing.
 */
/** A gradient fill: 2+ stops; linear uses `angle` (degrees, 0 = →). */
export const gradientSchema = z.object({
  type: z.enum(['linear', 'radial']),
  angle: z.number().default(90),
  stops: z.array(z.object({ offset: z.number().min(0).max(1), color: z.string() })).min(2),
});
export type Gradient = z.infer<typeof gradientSchema>;

export const shapeItemSchema = itemBaseSchema.extend({
  type: z.literal('shape'),
  shape: shapeKindSchema,
  fill: z.string().nullable().default(null),
  /** Gradient fill; wins over `fill` when present. */
  fillGradient: gradientSchema.optional(),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().min(0).default(2),
  dashed: z.boolean().default(false),
  /** rect only */
  cornerRadius: z.number().min(0).default(0),
  /** polygon/star */
  sides: z.number().int().min(3).default(5),
  /** star only: inner/outer radius ratio 0..1 */
  innerRadiusRatio: z.number().min(0).max(1).default(0.5),
  /** line/arrow: false = ╲ (nw→se), true = ╱ (sw→ne) within the box */
  flipDiagonal: z.boolean().default(false),
  /** freehand (draw): normalized points within the box; null otherwise */
  points: z.array(normPointSchema).nullable().default(null),
  /** pen (path): bezier anchors within the box; null otherwise */
  pathNodes: z.array(pathNodeSchema).nullable().default(null),
  /** pen (path): join the last anchor back to the first */
  pathClosed: z.boolean().default(false),
});
export type ShapeItem = z.infer<typeof shapeItemSchema>;

/**
 * An arrow endpoint is either a free point (canvas coords) or an anchor on
 * another item (normalized position in that item's local space) so the arrow
 * follows when the item moves.
 */
export const arrowEndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), x: z.number(), y: z.number() }),
  z.object({
    kind: z.literal('item'),
    itemId: z.string(),
    nx: z.number().min(0).max(1),
    ny: z.number().min(0).max(1),
  }),
]);
export type ArrowEndpoint = z.infer<typeof arrowEndpointSchema>;

export const arrowheadSchema = z.enum(['none', 'arrow', 'dot']);

export const arrowItemSchema = itemBaseSchema.extend({
  type: z.literal('arrow'),
  start: arrowEndpointSchema,
  end: arrowEndpointSchema,
  stroke: z.string(),
  strokeWidth: z.number().positive().default(2),
  startHead: arrowheadSchema.default('none'),
  endHead: arrowheadSchema.default('arrow'),
  dashed: z.boolean().default(false),
});
export type ArrowItem = z.infer<typeof arrowItemSchema>;

/** A saved page bookmark inside a PDF. */
export const pdfBookmarkSchema = z.object({
  page: z.number().int().min(1),
  label: z.string(),
});
export type PdfBookmark = z.infer<typeof pdfBookmarkSchema>;

/** A text highlight inside a PDF: normalized rects on one page. */
export const pdfHighlightSchema = z.object({
  id: z.string(),
  page: z.number().int().min(1),
  /** Selection rectangles, all coordinates 0..1 of the page box. */
  rects: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })),
  color: z.string(),
  text: z.string(),
});
export type PdfHighlight = z.infer<typeof pdfHighlightSchema>;

export const pdfItemSchema = itemBaseSchema.extend({
  type: z.literal('pdf'),
  assetId: z.string(),
  /** 1-based current page */
  page: z.number().int().min(1).default(1),
  pageCount: z.number().int().min(1).nullable().default(null),
  bookmarks: z.array(pdfBookmarkSchema).default([]),
  highlights: z.array(pdfHighlightSchema).default([]),
});
export type PdfItem = z.infer<typeof pdfItemSchema>;

/** A saved reading bookmark inside an ePub (CFI + human label). */
export const epubBookmarkSchema = z.object({
  cfi: z.string(),
  label: z.string(),
});
export type EpubBookmark = z.infer<typeof epubBookmarkSchema>;

/** A saved text highlight inside an ePub (CFI range + color + excerpt). */
export const epubHighlightSchema = z.object({
  cfi: z.string(),
  color: z.string(),
  text: z.string(),
});
export type EpubHighlight = z.infer<typeof epubHighlightSchema>;

export const epubItemSchema = itemBaseSchema.extend({
  type: z.literal('epub'),
  /** The .epub file in the asset store. */
  assetId: z.string(),
  /** Extracted cover image (rendered on canvas/gallery/viewer without epubjs). */
  coverAssetId: z.string().nullable().default(null),
  bookTitle: z.string().optional(),
  author: z.string().optional(),
  /** EPUB CFI of the last reading position. */
  location: z.string().nullable().default(null),
  bookmarks: z.array(epubBookmarkSchema).default([]),
  highlights: z.array(epubHighlightSchema).default([]),
});
export type EpubItem = z.infer<typeof epubItemSchema>;

/**
 * A display title: short text whose font size is never stored — it scales to
 * fit the box (contain, with padding), so resizing the box IS the type
 * control. Null colors follow the theme.
 */
export const titleItemSchema = itemBaseSchema.extend({
  type: z.literal('title'),
  text: z.string().default('Title'),
  fontFamily: z.string().default('Inter, system-ui, sans-serif'),
  color: z.string().nullable().default(null),
  background: z.string().nullable().default(null),
  bold: z.boolean().default(true),
  italic: z.boolean().default(false),
  alignH: z.enum(['left', 'center', 'right']).default('center'),
  alignV: z.enum(['top', 'middle', 'bottom']).default('middle'),
});
export type TitleItem = z.infer<typeof titleItemSchema>;

export const linkItemSchema = itemBaseSchema.extend({
  type: z.literal('link'),
  /** Destination opened on double-click / the open button. */
  url: z.string(),
  /** Button text. */
  label: z.string().default('Link'),
  /** Button background (#rrggbb); the label color auto-contrasts. */
  background: z.string().default('#1971c2'),
  /** Legacy label size (S/M/L). Superseded by `zoom`; read only to derive the
   *  zoom of buttons that have never been scaled. */
  size: z.enum(['s', 'm', 'l']).default('m'),
  /** Content zoom, set by uniform scales (corner drags). Absent = legacy: from `size`. */
  zoom: z.number().positive().optional(),
});
export type LinkItem = z.infer<typeof linkItemSchema>;

export const iframeItemSchema = itemBaseSchema.extend({
  type: z.literal('iframe'),
  url: z.string(),
  /** When false the iframe is covered by a shield so canvas gestures win. */
  interactive: z.boolean().default(false),
  /** Server-rendered page screenshot (asset id) — the gallery/export poster. */
  posterAssetId: z.string().nullable().default(null),
});

/**
 * Generic embed of self-contained local HTML — content-addressed like any
 * asset, rendered in a sandboxed iframe on the canvas. Provider-agnostic: any
 * feature/plugin that can produce standalone HTML (office-doc conversion,
 * reports, rendered markup…) can drop one on the board. The optional poster is
 * used only by the render-from-data contexts (board thumbnails, gallery, PDF
 * export) since those can't capture a live frame.
 */
export const htmlEmbedItemSchema = itemBaseSchema.extend({
  type: z.literal('htmlembed'),
  /** Self-contained HTML (inline CSS, data-URI images/fonts), stored as an
   *  asset with mime text/html so it renders offline. */
  htmlAssetId: z.string(),
  /** Rasterized preview for thumbnails/gallery/PDF export (optional). */
  posterAssetId: z.string().nullable().default(null),
  /** When false a shield covers the frame so canvas gestures win. */
  interactive: z.boolean().default(false),
  /** Display label (source filename, title…). */
  title: z.string().optional(),
});
export type HtmlEmbedItem = z.infer<typeof htmlEmbedItemSchema>;
/**
 * A live code snippet: real source text with a highlighting language, edited
 * in place with a code editor (CodeMirror) — NOT markdown. Rendering is
 * core; the Code Snippets plugin supplies fonts/themes and the add dialog.
 */
export const codeItemSchema = itemBaseSchema.extend({
  type: z.literal('code'),
  /** The source text. */
  code: z.string(),
  /** Highlight language id ('javascript', 'python', …); '' = plain text. */
  language: z.string().default(''),
  fontSize: z.number().min(8).max(40).default(13),
});
export type CodeItem = z.infer<typeof codeItemSchema>;

export const playlistTrackSchema = z.object({
  assetId: z.string(),
  title: z.string(),
  artist: z.string().nullable().default(null),
  coverAssetId: z.string().nullable().default(null),
});
export type PlaylistTrack = z.infer<typeof playlistTrackSchema>;

/** One player for several audio files (built by combining audio items). */
export const playlistItemSchema = itemBaseSchema.extend({
  type: z.literal('playlist'),
  tracks: z.array(playlistTrackSchema),
  /** Index of the active track. */
  current: z.number().int().min(0).default(0),
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(false),
  /** Cycle back to the first track after the last one ends. */
  loop: z.boolean().default(false),
});
export type PlaylistItem = z.infer<typeof playlistItemSchema>;

export const qrItemSchema = itemBaseSchema.extend({
  type: z.literal('qr'),
  /** The encoded content (URL or free text). */
  text: z.string(),
  /** Module (code) color. */
  color: z.string().default('#000000'),
  /** Fill of the containing square (the quiet zone shows this through). */
  background: z.string().default('#ffffff'),
});
export type QrItem = z.infer<typeof qrItemSchema>;
export type IframeItem = z.infer<typeof iframeItemSchema>;

/**
 * Live time widget: clock (digital/analog, any IANA timezone), countdown,
 * stopwatch, or pomodoro. All running state is ABSOLUTE wall-clock time
 * (targetAt / startedAt / phaseEndAt), so widgets keep "running" across
 * reloads, sync, and team boards with no background process — rendering is
 * pure arithmetic against now().
 */
export const timeItemSchema = itemBaseSchema.extend({
  type: z.literal('time'),
  mode: z.enum(['clock', 'countdown', 'stopwatch', 'pomodoro']),
  /** Clock face; non-clock modes always render digital. */
  face: z.enum(['digital', 'analog']).default('digital'),
  /** IANA timezone for clocks; null = viewer's local zone. */
  timezone: z.string().nullable().default(null),
  showSeconds: z.boolean().default(true),
  /** 12-hour clock; null = locale default. */
  hour12: z.boolean().nullable().default(null),
  /** Countdown deadline (ISO). */
  targetAt: z.string().nullable().default(null),
  /** Stopwatch: running since (ISO, null = paused) + banked time. */
  startedAt: z.string().nullable().default(null),
  accumulatedMs: z.number().default(0),
  /** Pomodoro configuration + phase state. */
  workMin: z.number().default(25),
  breakMin: z.number().default(5),
  phase: z.enum(['work', 'break']).default('work'),
  /** Running phase deadline (ISO); null = paused. */
  phaseEndAt: z.string().nullable().default(null),
  /** Remaining ms while paused (null = full phase length). */
  phaseRemainingMs: z.number().nullable().default(null),
  /** Completed work phases (the pomodoro tally). */
  cyclesDone: z.number().default(0),
});
export type TimeItem = z.infer<typeof timeItemSchema>;

/** A calendar event as a canvas card: a dated leaf (year, weekday, day,
 *  month, hours, title), importable from and exportable to iCalendar.
 *  Times are local wall-clock strings (YYYY-MM-DDTHH:mm, no zone — a
 *  local-first board keeps floating times); all-day events hold dates
 *  (YYYY-MM-DD) with an inclusive end. */
export const eventItemSchema = itemBaseSchema.extend({
  type: z.literal('event'),
  title: z.string().default('Event'),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean().default(false),
  location: z.string().default(''),
  /** Plain text (iCalendar DESCRIPTION). */
  description: z.string().default(''),
  /** iCalendar UID, kept from an import so a re-export round-trips. */
  uid: z.string().nullable().default(null),
  /** Minutes before the start to notify; null = no reminder. */
  remindMinutes: z.number().int().min(0).nullable().default(null),
  /** Set when the reminder fired — prevents refiring, syncs. */
  notifiedAt: z.string().nullable().default(null),
  /** Content zoom, set by uniform scales (corner drags). Absent = width ÷ design width. */
  zoom: z.number().positive().optional(),
});
export type EventItem = z.infer<typeof eventItemSchema>;

export const pollOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type PollOption = z.infer<typeof pollOptionSchema>;

export const pollVoteSchema = z.object({
  /** Display name at vote time (peers/accounts can rename; this is a snapshot). */
  name: z.string(),
  optionIds: z.array(z.string()),
});
export type PollVote = z.infer<typeof pollVoteSchema>;

/** One node of a tree / mind map. Edges are INTERNAL (parentId), never
 *  doc-level connections — Graph View stays the free-form web's view. */
export const treeNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Parent node id; null marks the root (exactly one per tree). */
  parentId: z.string().nullable().default(null),
  /** Node card color (#rrggbb); absent = theme default. */
  color: z.string().optional(),
  /** Canvas items attached to this node (drop targets, like timeline points). */
  itemIds: z.array(z.string()).default([]),
});
export type TreeNode = z.infer<typeof treeNodeSchema>;

/**
 * A tree / mind-map card: hierarchical nodes with automatic layout. The card
 * auto-sizes to its content; attached items are real canvas items shelved
 * under their node.
 */
export const treeItemSchema = itemBaseSchema.extend({
  type: z.literal('tree'),
  title: z.string().default('Tree'),
  /** 'tree' = root on top, depth downward; 'mindmap' = root left, depth right. */
  mode: z.enum(['tree', 'mindmap']).default('tree'),
  nodes: z.array(treeNodeSchema).default([]),
});
export type TreeItem = z.infer<typeof treeItemSchema>;

/** One task on a task-list card. */
export const taskSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean().default(false),
  /** Small description shown under the label. */
  note: z.string().default(''),
  /** ISO datetime the task is due; drives browser notifications. */
  due: z.string().nullable().default(null),
  /** Set when the due notification fired — prevents refiring, syncs. */
  notifiedAt: z.string().nullable().default(null),
});
export type Task = z.infer<typeof taskSchema>;

/**
 * A WYSIWYG checklist card: centered title, custom background/text color,
 * tasks with due dates + notes. Due dates hook the browser Notification API.
 */
export const tasklistItemSchema = itemBaseSchema.extend({
  type: z.literal('tasklist'),
  title: z.string().default('Tasks'),
  /** Card background (#rrggbb); null follows the theme. */
  background: z.string().nullable().default(null),
  /** Text color; null = auto (contrast of background, else theme ink). */
  color: z.string().nullable().default(null),
  tasks: z.array(taskSchema).default([]),
  /** Content zoom, set by uniform scales (corner drags). Absent = legacy: width ÷ design width. */
  zoom: z.number().positive().optional(),
});
export type TasklistItem = z.infer<typeof tasklistItemSchema>;

// --- Projects (project management suite; docs/archive/PROJECTS_PLAN.md) ---------------
// Project + milestone are canvas items; tasks live on the project. Board items
// are associated by reference (`itemIds`) — many-to-many, nothing stored on
// the item. Milestone dependencies are ordinary connections (depends/follows).

export const projectTaskStatusSchema = z.enum(['todo', 'doing', 'done', 'blocked', 'missed']);
export type ProjectTaskStatus = z.infer<typeof projectTaskStatusSchema>;

/** A comment on a task or milestone (same shape as board comments, minus itemId). */
export const projectCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  color: z.string().optional(),
  userId: z.string().optional(),
  text: z.string(),
  createdAt: z.string(),
});
export type ProjectComment = z.infer<typeof projectCommentSchema>;

export const projectSubtaskSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean().default(false),
  /** ISO date (YYYY-MM-DD) or datetime. */
  due: z.string().nullable().default(null),
});
export type ProjectSubtask = z.infer<typeof projectSubtaskSchema>;

export const projectTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Markdown. */
  description: z.string().default(''),
  status: projectTaskStatusSchema.default('todo'),
  /** At most one milestone; null = the project backlog ("Unscheduled"). */
  milestoneId: z.string().nullable().default(null),
  start: z.string().nullable().default(null),
  due: z.string().nullable().default(null),
  end: z.string().nullable().default(null),
  /** Team-board identity (userId) or free text; null = unassigned. */
  assignee: z.string().nullable().default(null),
  /** Set when the due reminder fired — prevents refiring, syncs. */
  notifiedAt: z.string().nullable().default(null),
  /** ISO creation time (drives "Created" sorting). Optional: older tasks sort last. */
  createdAt: z.string().optional(),
  subtasks: z.array(projectSubtaskSchema).default([]),
  /** Kanban column (see projectColumnSchema); null = the column whose id or
   *  status matches the task's status (the built-in columns). */
  columnId: z.string().nullable().default(null),
  comments: z.array(projectCommentSchema).default([]),
  /** Timer: accumulated seconds, and when the running stint started (syncs). */
  timeSpent: z.number().nonnegative().default(0),
  timerStartedAt: z.string().nullable().default(null),
  /** Associated board items (references; pruned when items are deleted). */
  itemIds: z.array(z.string()).default([]),
});
export type ProjectTask = z.infer<typeof projectTaskSchema>;

export const projectStatusSchema = z.enum(['planning', 'active', 'on-hold', 'done']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** A project card: the anchor for a body of work — dates, status, its tasks. */
export const milestoneStatusSchema = z.enum(['planned', 'active', 'done']);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

/** A milestone: a dated goal inside its project (embedded, not a card).
 *  `dependsOn` lists predecessor milestones (Timeline arrows). */
export const projectMilestoneSchema = z.object({
  id: z.string(),
  title: z.string().default('Milestone'),
  /** Markdown. */
  description: z.string().default(''),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  status: milestoneStatusSchema.default('planned'),
  /** Associated board items (references). */
  itemIds: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  comments: z.array(projectCommentSchema).default([]),
});
export type ProjectMilestone = z.infer<typeof projectMilestoneSchema>;

/** A calendar event on a project: a timed entry (local wall-clock
 *  YYYY-MM-DDTHH:mm, no zone — a local-first board keeps floating times). */
export const projectEventSchema = z.object({
  id: z.string(),
  title: z.string().default('Event'),
  description: z.string().default(''),
  start: z.string(),
  end: z.string(),
});
export type ProjectEvent = z.infer<typeof projectEventSchema>;

/** A Kanban column: a named lane whose `status` is what tasks in it mean.
 *  Empty `columns` = the four built-in lanes (ids equal the statuses). */
export const projectColumnSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: projectTaskStatusSchema,
});
export type ProjectColumn = z.infer<typeof projectColumnSchema>;

export const projectItemSchema = itemBaseSchema.extend({
  type: z.literal('project'),
  title: z.string().default('Project'),
  /** Markdown. */
  description: z.string().default(''),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  status: projectStatusSchema.default('active'),
  /** Accent (#rrggbb); null follows the theme accent. */
  color: z.string().nullable().default(null),
  tasks: z.array(projectTaskSchema).default([]),
  columns: z.array(projectColumnSchema).default([]),
  milestones: z.array(projectMilestoneSchema).default([]),
  events: z.array(projectEventSchema).default([]),
  /** Content zoom, set by uniform scales (corner drags). Absent = legacy: width ÷ design width. */
  zoom: z.number().positive().optional(),
  /** Associated board items (references). */
  itemIds: z.array(z.string()).default([]),
});
export type ProjectItem = z.infer<typeof projectItemSchema>;

/** One shelf row of a tier list (classic S–F ranking card). */
export const tierRowSchema = z.object({
  id: z.string(),
  /** Row label shown in the colored cell ("S", "A", …). */
  label: z.string(),
  /** Label-cell color (#rrggbb). */
  color: z.string(),
  /** Canvas items ranked into this row, in shelf order. */
  itemIds: z.array(z.string()).default([]),
});
export type TierRow = z.infer<typeof tierRowSchema>;

/**
 * A tier-list card: drop canvas items onto its shelves to rank them. Ranked
 * items stay real canvas items — attached ids live here (like timeline
 * points), and the attach code sizes them to the shelf.
 */
export const tierlistItemSchema = itemBaseSchema.extend({
  type: z.literal('tierlist'),
  title: z.string().default('Tier List'),
  /** Optional blurb shown under the title (card + lightbox). */
  description: z.string().default(''),
  rows: z.array(tierRowSchema).default([]),
});
export type TierlistItem = z.infer<typeof tierlistItemSchema>;

/** One possible conclusion a case weighs ("The butler did it"). */
export const caseConclusionSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type CaseConclusion = z.infer<typeof caseConclusionSchema>;

/** One link from a canvas item to a conclusion: the side it takes, and how
 *  much of the item's strength bears on that conclusion. The same item may
 *  link to several conclusions, once each. */
export const caseEvidenceSchema = z.object({
  itemId: z.string(),
  conclusionId: z.string(),
  stance: z.enum(['supports', 'contradicts']).default('supports'),
  /** Kept for boards from before 2026-10: it no longer scores (a link counts
   *  the item's full strength) and is always written as 1. */
  relevance: z.number().min(0).max(1).default(1),
});
export type CaseEvidence = z.infer<typeof caseEvidenceSchema>;

/**
 * A case: a question with competing conclusions, scored by the evidence
 * linked to each. Evidence is a reference — the items stay wherever they
 * sit on the canvas; the card is the scoreboard and the lightbox shows the
 * linked items per conclusion. Score per conclusion = Σ strength, signed
 * by stance.
 */
export const caseItemSchema = itemBaseSchema.extend({
  type: z.literal('case'),
  title: z.string().default('Case'),
  /** The question the conclusions answer. */
  question: z.string().default(''),
  conclusions: z.array(caseConclusionSchema).default([]),
  evidence: z.array(caseEvidenceSchema).default([]),
  /** Content zoom, set by uniform scales (corner drags). Absent = legacy: width ÷ design width. */
  zoom: z.number().positive().optional(),
});
export type CaseItem = z.infer<typeof caseItemSchema>;

/** One storyboard shot panel. `itemIds` holds the FRAME content (usually one
 *  image; the first attached item renders inside the aspect frame). */
export const storyboardPanelSchema = z.object({
  id: z.string(),
  /** "Shot 01" — auto-numbered on creation, freely editable. */
  label: z.string(),
  /** Slug line: "EXT. HARBOR — DAWN". */
  scene: z.string().default(''),
  /** What happens in the shot. */
  action: z.string().default(''),
  /** Camera move (dolly / locked / pan…). */
  move: z.string().default(''),
  /** Lens ("24mm"). */
  lens: z.string().default(''),
  /** Planned duration in seconds; panels sum to the card's runtime. */
  duration: z.number().min(0).nullable().default(null),
  itemIds: z.array(z.string()).default([]),
  /** Skip auto-fitting attached items into the frame. */
  freeArrange: z.boolean().default(false),
});
export type StoryboardPanel = z.infer<typeof storyboardPanelSchema>;

/**
 * Storyboard container (fourth of the container family): an ordered grid of
 * aspect-locked shot panels. Panels are drop targets — a dropped item becomes
 * the panel's frame, sized into the aspect box; metadata renders beneath.
 */
export const storyboardItemSchema = itemBaseSchema.extend({
  type: z.literal('storyboard'),
  title: z.string().default('Storyboard'),
  aspect: z.enum(['16:9', '9:16', '4:3', '2.39:1']).default('16:9'),
  /** Panels per row; the grid wraps and the card height follows. */
  columns: z.number().int().min(1).max(8).default(3),
  panels: z.array(storyboardPanelSchema).default([]),
  /** Content zoom, set by uniform scales (corner drags). Absent = 1. */
  zoom: z.number().positive().optional(),
});
export type StoryboardItem = z.infer<typeof storyboardItemSchema>;

/** One milestone on a timeline. Points are drop targets in phase 2: itemIds
 *  records canvas items shelved under this point (kept in schema now so
 *  attachments won't need another version bump). */
export const timelinePointSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Longer text; folded on the canvas until the point is expanded. */
  description: z.string().default(''),
  /** Display-only date/era text ("2019", "Q3", "May 4") — no parsing. */
  date: z.string().default(''),
  /** Accent override for this point; null falls back to the timeline style. */
  color: z.string().nullable().default(null),
  /** Description folded on the canvas? */
  collapsed: z.boolean().default(true),
  /** Items attached to this point (dropped onto the point's capture zone). */
  itemIds: z.array(z.string()).default([]),
  /** Skip auto-shelf stacking: attached items keep wherever they're dropped. */
  freeArrange: z.boolean().default(false),
});
export type TimelinePoint = z.infer<typeof timelinePointSchema>;

/** Base-timeline styling (per-point color overrides live on the points). */
export const timelineStyleSchema = z.object({
  lineColor: z.string().default('#98a2b3'),
  lineWidth: z.number().min(1).max(12).default(4),
  pointColor: z.string().default('#608cff'),
  pointSize: z.number().min(4).max(24).default(12),
});
export type TimelineStyle = z.infer<typeof timelineStyleSchema>;

export const timelineItemSchema = itemBaseSchema.extend({
  type: z.literal('timeline'),
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  /** 'even' spaces points uniformly (weighted by shelf size); 'date' spaces
   *  them proportionally to their parsed dates when every point has one. */
  scaleMode: z.enum(['even', 'date']).default('even'),
  /** Ordered along the axis. */
  points: z.array(timelinePointSchema).default([]),
  style: timelineStyleSchema.default({
    lineColor: '#98a2b3',
    lineWidth: 4,
    pointColor: '#608cff',
    pointSize: 12,
  }),
});
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const pollItemSchema = itemBaseSchema.extend({
  type: z.literal('poll'),
  question: z.string(),
  options: z.array(pollOptionSchema).default([]),
  /** Keyed by voter identity (account id when signed in, else display name). */
  votes: z.record(z.string(), pollVoteSchema).default({}),
  /** Allow picking more than one option. */
  multiple: z.boolean().default(false),
  /** Closed polls show results only; voting is disabled. */
  closed: z.boolean().default(false),
});
export type PollItem = z.infer<typeof pollItemSchema>;

export const recipeItemSchema = itemBaseSchema.extend({
  type: z.literal('recipe'),
  /** Recipe name (schema.org name). */
  title: z.string(),
  description: z.string().nullable().default(null),
  /** Hero image, content-addressed like all media. */
  imageAssetId: z.string().nullable().default(null),
  sourceUrl: z.string().nullable().default(null),
  author: z.string().nullable().default(null),
  /** Times in minutes; null = not stated. */
  prepMin: z.number().nullable().default(null),
  cookMin: z.number().nullable().default(null),
  totalMin: z.number().nullable().default(null),
  /** As written on the site ("4 servings", "12 cookies"). */
  servings: z.string().nullable().default(null),
  cuisine: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  ingredients: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
});
export type RecipeItem = z.infer<typeof recipeItemSchema>;

export const fontItemSchema = itemBaseSchema.extend({
  type: z.literal('font'),
  /** The font binary (TTF/OTF/WOFF/WOFF2), content-addressed like all media. */
  assetId: z.string(),
  /** CSS font-family name the file registers as (from the file name). */
  family: z.string(),
  /** Specimen line shown on the preview card. */
  previewText: z.string().default('Aa Bb Cc'),
});
export type FontItem = z.infer<typeof fontItemSchema>;

export const rssEntrySchema = z.object({
  title: z.string(),
  link: z.string(),
  excerpt: z.string().default(''),
  /** Remote thumbnail URL from the feed (not a stored asset). */
  thumbnail: z.string().nullable().default(null),
  published: z.string().nullable().default(null),
});
export type RssEntry = z.infer<typeof rssEntrySchema>;

export const rssItemSchema = itemBaseSchema.extend({
  type: z.literal('rss'),
  /** The feed URL the box was created from. */
  url: z.string(),
  feedTitle: z.string().nullable().default(null),
  /** ISO timestamp of the last successful fetch. */
  fetchedAt: z.string().nullable().default(null),
  /** Cached entries so the box renders offline / in the viewer. */
  entries: z.array(rssEntrySchema).default([]),
  /** Reader text size multiplier (A− / A+). */
  fontScale: z.number().min(0.6).max(2.2).default(1),
});
export type RssItem = z.infer<typeof rssItemSchema>;

/**
 * An embedded map: a centered place view or an A→B directions view from one
 * of several providers. Provider API keys live in client-side plugin settings
 * — NEVER on the item — so embed URLs are built at render time, and shared /
 * exported boards fall back to the rasterized poster. OSM needs no key.
 */
export const mapItemSchema = itemBaseSchema.extend({
  type: z.literal('map'),
  provider: z.enum(['osm', 'google', 'mapbox']).default('osm'),
  /** view = centered map; directions = routed A→B (Google Embed API). */
  mapMode: z.enum(['view', 'directions']).default('view'),
  style: z.enum(['streets', 'satellite']).default('streets'),
  lat: z.number().default(0),
  lng: z.number().default(0),
  zoom: z.number().min(0).max(21).default(13),
  /** The searched place (marker label, card title, metadata). */
  query: z.string().default(''),
  /** Drop a pin at the center. */
  marker: z.boolean().default(true),
  /** Directions endpoints (mapMode 'directions'). */
  origin: z.string().default(''),
  destination: z.string().default(''),
  travelMode: z.enum(['driving', 'walking', 'bicycling', 'transit']).default('driving'),
  /** interactive = live embed iframe; static = the poster image. */
  display: z.enum(['interactive', 'static']).default('interactive'),
  /** Rasterized snapshot (asset) for thumbnails/gallery/PDF/static display. */
  posterAssetId: z.string().nullable().default(null),
});
export type MapItem = z.infer<typeof mapItemSchema>;

export const itemSchema = z.discriminatedUnion('type', [
  timelineItemSchema,
  pollItemSchema,
  recipeItemSchema,
  imageItemSchema,
  videoItemSchema,
  audioItemSchema,
  textItemSchema,
  swatchItemSchema,
  paletteItemSchema,
  shapeItemSchema,
  arrowItemSchema,
  pdfItemSchema,
  epubItemSchema,
  titleItemSchema,
  linkItemSchema,
  iframeItemSchema,
  htmlEmbedItemSchema,
  codeItemSchema,
  qrItemSchema,
  playlistItemSchema,
  fontItemSchema,
  rssItemSchema,
  timeItemSchema,
  eventItemSchema,
  mapItemSchema,
  tierlistItemSchema,
  caseItemSchema,
  storyboardItemSchema,
  treeItemSchema,
  tasklistItemSchema,
  projectItemSchema,
]);
export type Item = z.infer<typeof itemSchema>;
export type ItemType = Item['type'];

export const ITEM_TYPES = [
  'timeline',
  'poll',
  'recipe',
  'image',
  'video',
  'audio',
  'text',
  'swatch',
  'palette',
  'shape',
  'arrow',
  'pdf',
  'link',
  'iframe',
  'font',
  'rss',
  'time',
  'event',
  'map',
] as const satisfies readonly ItemType[];
