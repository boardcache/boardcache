import { CASE_CARD_W, caseDesignHeight } from '../structure/cases';
import type {
  StoryboardItem,
  TierlistItem,
  CaseItem,
  TasklistItem,
  ProjectItem,
  TreeItem,
  TitleItem,
  PathNode,
  CodeItem,
  HtmlEmbedItem,
  IframeItem,
  LinkItem,
  NormPoint,
  PaletteEntry,
  PaletteItem,
  QrItem,
  TimeItem,
  TimelineItem,
  TimelinePoint,
  RecipeItem,
  PollItem,
  ShapeItem,
  ShapeKind,
  SwatchItem,
  TextItem,
} from '@boardcache/schema';
import { DEFAULT_FONT_FAMILY, newId } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { storyboardHeight } from '../structure/storyboardAttach';
import { measureMarkdownHeight } from '../text/markdown';
import { captureIframePoster } from '../media/iframePoster';
import { putAsset } from '../board/assetStore';
import { addItems, topZIndex } from '../../state/commands';
import { findOpenSpot, openSpotNear } from '../canvas/placeSpot';
import { updateTree } from '../structure/treeAttach';
import { computeTreeLayout } from '../structure/treeLayout';
import { useDocumentStore } from '../../state/documentStore';
import { PROJECT_CARD_W } from '../structure/projects';
import type { ShapeStyle } from '../../state/sessionStore';
import { useSessionStore } from '../../state/sessionStore';

/** Factories for non-media items; each places one item as one command. */

export const TEXT_DEFAULTS = { width: 300, height: 420, fontSize: 18 } as const;

/** New text boxes get SENTINEL colors that follow the theme LIVE: 'auto'
 *  background + 'default' ink resolve against --new-text-bg/--new-text-ink
 *  (Corkboard = paper; the stylesheet defines light/dark defaults), so a
 *  mode or theme switch restyles them. Picking explicit colors later stamps
 *  hex values that stay fixed — that's the intended difference. */
function defaultTextColors(): { background: string; color: string } {
  return { background: 'auto', color: 'default' };
}

export function createTextItem(at: Point, startEditing = true): string {
  const { doc } = useDocumentStore.getState();
  const spot = findOpenSpot(
    doc,
    { x: at.x + TEXT_DEFAULTS.width / 2, y: at.y - 20 + TEXT_DEFAULTS.height / 2 },
    TEXT_DEFAULTS.width,
    TEXT_DEFAULTS.height,
  );
  const item: TextItem = {
    id: newId(),
    type: 'text',
    x: spot.x - TEXT_DEFAULTS.width / 2,
    y: spot.y - TEXT_DEFAULTS.height / 2,
    width: TEXT_DEFAULTS.width,
    height: TEXT_DEFAULTS.height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    text: '',
    fontSize: useSessionStore.getState().textDefaults.fontSize,
    fontFamily: useSessionStore.getState().textDefaults.fontFamily,
    ...defaultTextColors(),
    align: useSessionStore.getState().textDefaults.align,
    verticalAlign: 'top',
    autoHeight: true,
  };
  addItems([item], 'Add text');
  const session = useSessionStore.getState();
  session.setSelection([item.id]);
  if (startEditing) session.setEditingItemId(item.id);
  return item.id;
}

/** Build a document-style text-box item (placed, fixed height, scrolls). */
function buildTextBox(topLeft: Point, width: number, text: string, zIndex: number): TextItem {
  const fontSize = TEXT_DEFAULTS.fontSize;
  return {
    id: newId(),
    type: 'text',
    x: topLeft.x,
    y: topLeft.y,
    width,
    height: measureMarkdownHeight(text, width, fontSize, DEFAULT_FONT_FAMILY),
    rotation: 0,
    zIndex,
    locked: false,
    opacity: 1,
    groupId: null,
    text,
    fontSize,
    fontFamily: DEFAULT_FONT_FAMILY,
    ...defaultTextColors(),
    align: 'left',
    verticalAlign: 'top',
    // Document-style box: keep the set size and scroll instead of growing.
    autoHeight: false,
  };
}

/** Create one placed text box. Returns the item id. */
export function createTextBox(topLeft: Point, width: number, text: string, label: string): string {
  return createTextBoxes([{ topLeft, width, text }], label)[0]!;
}

/** Create several text boxes as ONE undo step. Returns their ids in order. */
export function createTextBoxes(
  specs: Array<{ topLeft: Point; width: number; text: string }>,
  label: string,
): string[] {
  const { doc } = useDocumentStore.getState();
  const baseZ = topZIndex(doc) + 1;
  const items = specs.map((s, i) => buildTextBox(s.topLeft, s.width, s.text, baseZ + i));
  addItems(items, label);
  useSessionStore.getState().setSelection(items.map((it) => it.id));
  return items.map((it) => it.id);
}

/** Create a placed (non-editing) text item from pasted/dropped text (markdown). */
export function createTextFromString(at: Point, text: string, label = 'Paste text'): string {
  const { doc } = useDocumentStore.getState();
  const width = TEXT_DEFAULTS.width;
  const fontSize = TEXT_DEFAULTS.fontSize;
  const height = measureMarkdownHeight(text, width, fontSize, DEFAULT_FONT_FAMILY);
  at = findOpenSpot(doc, at, width, height);
  const item: TextItem = {
    id: newId(),
    type: 'text',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    text,
    fontSize,
    fontFamily: DEFAULT_FONT_FAMILY,
    ...defaultTextColors(),
    align: 'left',
    verticalAlign: 'top',
    autoHeight: true,
  };
  addItems([item], label);
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A live code snippet item (see CodeContent) placed centered on `at`. */
export function createCodeItem(at: Point, code: string, language: string, fontSize = 13): string {
  const { doc } = useDocumentStore.getState();
  const lines = code.split('\n').length;
  const width = 480;
  const height = Math.min(640, Math.max(96, 30 + 18 + lines * fontSize * 1.5));
  at = findOpenSpot(doc, at, width, height);
  const item: CodeItem = {
    id: newId(),
    type: 'code',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    code,
    language,
    fontSize,
  };
  addItems([item], 'Add code snippet');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A clickable link button (label + URL + background; text auto-contrasts). */
export function createLinkItem(at: Point): string {
  const { doc } = useDocumentStore.getState();
  const width = 180;
  const height = 52;
  at = findOpenSpot(doc, at, width, height);
  const item: LinkItem = {
    id: newId(),
    type: 'link',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    url: '',
    label: 'Link',
    background: '#1971c2',
    size: 'm',
  };
  addItems([item], 'Add link');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A vector QR code: black modules on a white containing square by default. */
export interface HtmlEmbedOptions {
  /** Self-contained HTML string, or a ready text/html Blob. */
  html: string | Blob;
  /** Optional rasterized preview (thumbnails/gallery/PDF). */
  poster?: Blob;
  title?: string;
  width?: number;
  height?: number;
}

/**
 * Drop a generic HTML embed on the canvas. Provider-agnostic: any feature that
 * can produce standalone HTML uses this. Returns the item id.
 */
export async function createHtmlEmbed(at: Point, opts: HtmlEmbedOptions): Promise<string> {
  const htmlBlob =
    opts.html instanceof Blob ? opts.html : new Blob([opts.html], { type: 'text/html' });
  const htmlAssetId = await putAsset(htmlBlob);
  const posterAssetId = opts.poster ? await putAsset(opts.poster) : null;
  const width = opts.width ?? 560;
  const height = opts.height ?? 720;
  const { doc } = useDocumentStore.getState();
  at = findOpenSpot(doc, at, width, height);
  const item: HtmlEmbedItem = {
    id: newId(),
    type: 'htmlembed',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    htmlAssetId,
    posterAssetId,
    interactive: false,
    ...(opts.title ? { title: opts.title } : {}),
  };
  addItems([item], 'Add HTML embed');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

export function createQrItem(at: Point, text: string): string {
  const { doc } = useDocumentStore.getState();
  const size = 260;
  at = findOpenSpot(doc, at, size, size);
  const item: QrItem = {
    id: newId(),
    type: 'qr',
    x: at.x - size / 2,
    y: at.y - size / 2,
    width: size,
    height: size,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    text,
    color: '#000000',
    background: '#ffffff',
  };
  addItems([item], 'Add QR code');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A timeline axis with its starting points. */
export function createTimelineItem(
  at: Point,
  data: Partial<Omit<TimelineItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> & {
    points: TimelinePoint[];
  },
): string {
  const { doc } = useDocumentStore.getState();
  const horizontal = (data.orientation ?? 'horizontal') === 'horizontal';
  const length = Math.max(620, data.points.length * 210);
  const width = data.width ?? (horizontal ? length : 380);
  const height = data.height ?? (horizontal ? 240 : length);
  at = findOpenSpot(doc, at, width, height);
  const item: TimelineItem = {
    id: newId(),
    type: 'timeline',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    orientation: 'horizontal',
    scaleMode: 'even',
    style: { lineColor: '#98a2b3', lineWidth: 4, pointColor: '#608cff', pointSize: 12 },
    ...data,
  };
  addItems([item], 'Add timeline');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A storyboard card with six empty, numbered shot panels by default. */
export function createStoryboardItem(
  at: Point,
  data: Partial<Omit<StoryboardItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> = {},
): string {
  const { doc } = useDocumentStore.getState();
  const width = data.width ?? 720;
  const panels =
    data.panels ??
    Array.from({ length: 6 }, (_, i) => ({
      id: newId(),
      label: `Shot ${String(i + 1).padStart(2, '0')}`,
      scene: '',
      action: '',
      move: '',
      lens: '',
      duration: null,
      itemIds: [],
      freeArrange: false,
    }));
  const base: StoryboardItem = {
    id: newId(),
    type: 'storyboard',
    x: at.x,
    y: at.y,
    width,
    height: 400, // reflow computes the real height below
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    title: 'Storyboard',
    aspect: '16:9',
    columns: 3,
    ...data,
    panels,
  };
  base.height = storyboardHeight(base);
  const spot = findOpenSpot(doc, at, base.width, base.height);
  base.x = spot.x - base.width / 2;
  base.y = spot.y - base.height / 2;
  addItems([base], 'Add storyboard');
  useSessionStore.getState().setSelection([base.id]);
  return base.id;
}

/** Classic tier-list rows: S red through F gray. */
export const TIER_DEFAULT_ROWS: { label: string; color: string }[] = [
  { label: 'S', color: '#ff7f7f' },
  { label: 'A', color: '#ffbf7f' },
  { label: 'B', color: '#ffdf80' },
  { label: 'C', color: '#7fdf7f' },
  { label: 'D', color: '#7fbfff' },
  { label: 'F', color: '#b3b3bd' },
];

/** A tree / mind-map card with a starter root + two children. */
/** Task-list card with two starter tasks. */
export function createTasklistItem(at: { x: number; y: number }): string {
  const id = newId();
  const item: TasklistItem = {
    id,
    type: 'tasklist',
    x: at.x - 160,
    y: at.y - 140,
    width: 320,
    height: 280,
    rotation: 0,
    locked: false,
    opacity: 1,
    groupId: null,
    zIndex: topZIndex(useDocumentStore.getState().doc) + 1,
    title: 'Tasks',
    background: null,
    color: null,
    tasks: [
      { id: newId(), label: 'First task', done: false, note: '', due: null, notifiedAt: null },
      { id: newId(), label: 'Another task', done: false, note: '', due: null, notifiedAt: null },
    ],
  };
  addItems([item], 'Add task list');
  useSessionStore.getState().setSelection([id]);
  return id;
}

/** A project card (Projects suite). Milestones and tasks live on it (editors, tools). */
export function createProjectItem(
  at: Point,
  data: Partial<
    Pick<ProjectItem, 'title' | 'description' | 'startDate' | 'endDate' | 'status' | 'color'>
  > = {},
): string {
  const id = newId();
  const item: ProjectItem = {
    id,
    type: 'project',
    x: at.x - 170,
    y: at.y - 110,
    width: PROJECT_CARD_W,
    height: 300,
    rotation: 0,
    locked: false,
    opacity: 1,
    groupId: null,
    zIndex: topZIndex(useDocumentStore.getState().doc) + 1,
    title: data.title ?? 'Project',
    description: data.description ?? '',
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    status: data.status ?? 'active',
    color: data.color ?? null,
    tasks: [],
    columns: [],
    milestones: [],
    events: [],
    itemIds: [],
  };
  addItems([item], 'New project');
  useSessionStore.getState().setSelection([id]);
  return id;
}

export function createTreeItem(
  at: Point,
  data: Partial<Omit<TreeItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> = {},
): string {
  const { doc } = useDocumentStore.getState();
  let nodes = data.nodes;
  if (!nodes) {
    const rootId = newId();
    nodes = [
      { id: rootId, label: 'Root', parentId: null, itemIds: [] },
      { id: newId(), label: 'Branch A', parentId: rootId, itemIds: [] },
      { id: newId(), label: 'Branch B', parentId: rootId, itemIds: [] },
    ];
  }
  // Measure the intrinsic layout so the card starts at exactly 1:1 scale
  // (any other size would be preserved as a zoom by relayoutTree).
  const probe = { type: 'tree', mode: data.mode ?? 'tree', nodes } as TreeItem;
  const intrinsic = computeTreeLayout(probe);
  const width = intrinsic.width;
  const height = intrinsic.height;
  at = findOpenSpot(doc, at, width, height);
  const item: TreeItem = {
    id: newId(),
    type: 'tree',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    title: 'Tree',
    mode: 'tree',
    ...data,
    nodes,
  };
  addItems([item], 'Add tree');
  // Sizing is layout-driven — snap the fresh card to its content.
  updateTree(item.id, 'Add tree', () => {});
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A tier-list ranking card (drop canvas items onto its shelves). */
/** A case: a question with two starter conclusions and no evidence yet. */
export function createCaseItem(
  at: Point,
  data: Partial<Omit<CaseItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> = {},
): string {
  const { doc } = useDocumentStore.getState();
  const width = data.width ?? CASE_CARD_W;
  // Tall enough for every conclusion at this width's zoom; the list scrolls
  // once the card is made shorter.
  const conclusions = data.conclusions ?? [
    { id: newId(), label: 'Conclusion A' },
    { id: newId(), label: 'Conclusion B' },
  ];
  const height =
    data.height ??
    caseDesignHeight(conclusions.length, !!data.question) * (data.zoom ?? width / CASE_CARD_W);
  at = findOpenSpot(doc, at, width, height);
  const item: CaseItem = {
    id: newId(),
    type: 'case',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    title: 'Case',
    question: '',
    evidence: [],
    ...data,
    conclusions,
  };
  addItems([item], 'Add case');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

export function createTierListItem(
  at: Point,
  data: Partial<Omit<TierlistItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> = {},
): string {
  const { doc } = useDocumentStore.getState();
  const rows = data.rows ?? TIER_DEFAULT_ROWS.map((r) => ({ ...r, id: newId(), itemIds: [] }));
  const width = data.width ?? 720;
  const height = data.height ?? 40 + rows.length * 104;
  at = findOpenSpot(doc, at, width, height);
  const item: TierlistItem = {
    id: newId(),
    type: 'tierlist',
    description: '',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    title: 'Tier List',
    ...data,
    rows,
  };
  addItems([item], 'Add tier list');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A poll card (team voting). */
export function createPollItem(
  at: Point,
  data: Partial<Omit<PollItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> & {
    question: string;
    options: PollItem['options'];
  },
): string {
  const { doc } = useDocumentStore.getState();
  const width = data.width ?? 320;
  const height = data.height ?? Math.max(200, 120 + data.options.length * 46);
  at = findOpenSpot(doc, at, width, height);
  const item: PollItem = {
    id: newId(),
    type: 'poll',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    votes: {},
    multiple: false,
    closed: false,
    ...data,
  };
  addItems([item], 'Add poll');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A recipe card (schema.org recipe data). */
export function createRecipeItem(
  at: Point,
  data: Partial<Omit<RecipeItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> & { title: string },
): string {
  const { doc } = useDocumentStore.getState();
  const width = data.width ?? 360;
  const height = data.height ?? 460;
  at = findOpenSpot(doc, at, width, height);
  const item: RecipeItem = {
    id: newId(),
    type: 'recipe',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    description: null,
    imageAssetId: null,
    sourceUrl: null,
    author: null,
    prepMin: null,
    cookMin: null,
    totalMin: null,
    servings: null,
    cuisine: null,
    category: null,
    ingredients: [],
    steps: [],
    ...data,
  };
  addItems([item], 'Add recipe');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A live time widget (clock / countdown / stopwatch / pomodoro). */
export function createTimeItem(
  at: Point,
  config: Partial<Omit<TimeItem, 'id' | 'type' | 'x' | 'y' | 'zIndex'>> = {},
): string {
  const { doc } = useDocumentStore.getState();
  const width = config.width ?? 240;
  const height = config.height ?? (config.face === 'analog' ? 240 : 130);
  at = findOpenSpot(doc, at, width, height);
  const item: TimeItem = {
    id: newId(),
    type: 'time',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    mode: 'clock',
    face: 'digital',
    timezone: null,
    showSeconds: true,
    hour12: null,
    targetAt: null,
    startedAt: null,
    accumulatedMs: 0,
    workMin: 25,
    breakMin: 5,
    phase: 'work',
    phaseEndAt: null,
    phaseRemainingMs: null,
    cyclesDone: 0,
    ...config,
  };
  addItems([item], 'Add time widget');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

/** A resizable webpage embed with an editable address bar. */
export function createIframeItem(at: Point, url: string): string {
  const { doc } = useDocumentStore.getState();
  const width = 720;
  const height = 520;
  at = findOpenSpot(doc, at, width, height);
  const item: IframeItem = {
    id: newId(),
    type: 'iframe',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    url,
    interactive: false,
    posterAssetId: null,
  };
  addItems([item], 'Add webpage');
  useSessionStore.getState().setSelection([item.id]);
  if (url) void captureIframePoster(item.id);
  return item.id;
}

export interface ShapeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  flipDiagonal?: boolean;
  points?: NormPoint[];
  pathNodes?: PathNode[];
  pathClosed?: boolean;
}

/**
 * Create a shape/connector/freehand item. The draw gesture computes geometry;
 * style comes from the session default. Selects it and returns to the select
 * tool (one shape per tool activation, like Excalidraw).
 */
/** Create a title item at `at` (centered) and open it for editing. */
export function createTitleItem(at: Point, startEditing = true): string {
  const { doc } = useDocumentStore.getState();
  const width = 360;
  const height = 110;
  const spot = openSpotNear(at, width, height);
  const item: TitleItem = {
    id: newId(),
    type: 'title',
    x: spot.x - width / 2,
    y: spot.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    text: 'Title',
    fontFamily: 'Inter, system-ui, sans-serif',
    color: null,
    background: null,
    bold: true,
    italic: false,
    alignH: 'center',
    alignV: 'middle',
  };
  addItems([item], 'Add title');
  const session = useSessionStore.getState();
  session.setSelection([item.id]);
  if (startEditing) session.setEditingItemId(item.id);
  return item.id;
}

export function createShape(shape: ShapeKind, geom: ShapeGeometry, style: ShapeStyle): string {
  const { doc } = useDocumentStore.getState();
  const item: ShapeItem = {
    id: newId(),
    type: 'shape',
    x: geom.x,
    y: geom.y,
    width: geom.width,
    height: geom.height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    shape,
    fill: style.fill,
    ...(style.fillGradient ? { fillGradient: style.fillGradient } : {}),
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    dashed: style.dashed,
    cornerRadius: shape === 'rect' ? 6 : 0,
    sides: 5,
    innerRadiusRatio: 0.5,
    flipDiagonal: geom.flipDiagonal ?? false,
    points: geom.points ?? null,
    pathNodes: geom.pathNodes ?? null,
    pathClosed: geom.pathClosed ?? false,
  };
  addItems([item], `Add ${shape}`);
  const session = useSessionStore.getState();
  session.setSelection([item.id]);
  session.setTool('select');
  return item.id;
}

export function createSwatchItem(at: Point, color: string, name?: string): string {
  const { doc } = useDocumentStore.getState();
  at = findOpenSpot(doc, at, 96, 96);
  const item: SwatchItem = {
    id: newId(),
    type: 'swatch',
    x: at.x - 48,
    y: at.y - 48,
    width: 96,
    height: 96,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    ...(name !== undefined ? { name } : {}),
    color,
  };
  addItems([item], 'Add swatch');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}

export function createPaletteItem(
  at: Point,
  colors: PaletteEntry[],
  options: { name?: string; sourceAssetId?: string | null } = {},
): string {
  const { doc } = useDocumentStore.getState();
  const pw = Math.max(240, colors.length * 56);
  const spot = findOpenSpot(doc, { x: at.x + pw / 2, y: at.y + 36 }, pw, 72);
  const item: PaletteItem = {
    id: newId(),
    type: 'palette',
    x: spot.x - pw / 2,
    y: spot.y - 36,
    width: pw,
    height: 72,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    ...(options.name !== undefined ? { name: options.name } : {}),
    colors,
    sourceAssetId: options.sourceAssetId ?? null,
  };
  addItems([item], 'Add palette');
  useSessionStore.getState().setSelection([item.id]);
  return item.id;
}
