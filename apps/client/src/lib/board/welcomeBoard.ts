import { DEFAULT_FONT_FAMILY, newId } from '@boardcache/schema';
import type { ConnectionRel } from '@boardcache/schema';
import {
  createCaseItem,
  createLinkItem,
  createPaletteItem,
  createQrItem,
  createShape,
  createTasklistItem,
  createTextFromString,
  createTierListItem,
  createTimelineItem,
  createTitleItem,
  createTreeItem,
} from '../import/createItems';
import { setPresentationSteps } from '../canvas/presentation';
import { measureMarkdownHeight } from '../text/markdown';
import { linkEvidence } from '../structure/cases';
import { updateTasklist } from '../structure/tasklist';
import { attachItemsToTierRow } from '../structure/tierAttach';
import { addConnection, groupItems, setConnectionLabel, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * The welcome board: a tour of the canvas, built with the same creators the
 * UI uses (like the example templates) so it can never drift from the
 * schema. Each stop is a short card beside the thing it talks about; the two
 * are grouped, and the board's Presentation Mode sequence frames one group
 * per step, so "Present" IS the tour. Seeded once into a new library as an
 * ordinary, deletable board; View → Welcome board brings it back.
 */

export const WELCOME_NAME = 'Welcome to boardCache';
const SEEDED_KEY = 'boardcache:welcomeSeeded';
const BOARD_KEY = 'boardcache:welcomeBoardId';
const LABEL = 'Welcome board';

/** A card with its top-left at (x, y), as wide as asked and as tall as its
 *  text needs there (the creator measures at a default width and dodges
 *  other items; the layout here is deliberate). */
function card(x: number, y: number, text: string, width = 320, name?: string): string {
  const id = createTextFromString({ x, y }, text, LABEL);
  updateItems([id], LABEL, (d) => {
    if (d.type !== 'text') return;
    d.x = x;
    d.y = y;
    d.width = width;
    d.height = measureMarkdownHeight(text, width, d.fontSize, DEFAULT_FONT_FAMILY);
    if (name) d.name = name;
  });
  return id;
}

const wire = (from: string, to: string, rel: ConnectionRel, label?: string): void => {
  const id = addConnection({ kind: 'item', id: from }, { kind: 'item', id: to }, rel);
  if (id && label) setConnectionLabel(id, label);
};

/** A stop on the tour: the card and what it points at, as one group. */
function stop(name: string, ids: string[]): string {
  return groupItems(ids, name) ?? ids[0]!;
}

/** Place an item's top-left corner; creators centre and dodge, this layout is deliberate. */
function put(id: string, x: number, y: number, size?: { width?: number; height?: number }): void {
  updateItems([id], LABEL, (d) => {
    d.x = x;
    d.y = y;
    if (size?.width) d.width = size.width;
    if (size?.height) d.height = size.height;
  });
}

const heightOf = (id: string): number => useDocumentStore.getState().doc.items[id]?.height ?? 0;

export function buildWelcomeBoard(): void {
  const steps: string[] = [];
  const GAP = 48;
  // Two columns of stops: the left one reads top to bottom, the right one
  // holds the containers (they are wide). Each stop's feature sits beside
  // or under its card, and the next stop starts under whichever is taller.
  const L = 60;
  const R = 1180;
  let ly = 40;
  let ry = 40;

  // 1. The board itself.
  const title = createTitleItem({ x: 420, y: 60 }, false);
  updateItems([title], LABEL, (d) => {
    if (d.type === 'title') d.text = 'Welcome to boardCache';
  });
  put(title, L, ly, { width: 560, height: 90 });
  ly += 90 + 16;
  const intro = card(
    L,
    ly,
    '# An infinite board for the things you collect while you think\n\nThis board is a tour. Press **Present** (bottom right corner, or View → Present) and step through it, or just wander: drag the canvas to pan, pinch or Ctrl-scroll to zoom, double-click anything to open it.\n\nIt is yours to edit or delete. You can bring it back any time from View → Welcome board.',
    560,
    'Start here',
  );
  ly += heightOf(intro) + GAP;
  steps.push(stop('Start here', [title, intro]));

  // 2. Text: Markdown cards.
  const mdCard = card(
    L,
    ly,
    '## Cards are Markdown\n\nDouble-click a card to edit it. Headings, **bold**, lists, tables, links and `code` all work, and math like $e^{i\\pi} + 1 = 0$.\n\n- Paste text anywhere on the canvas to make a card\n- Drag a corner to resize; the text reflows',
    340,
    'Markdown',
  );
  const mdSample = card(
    L + 340 + 120,
    ly + 20,
    '| Item | Type |\n| --- | --- |\n| A photo | image |\n| A PDF | pdf |\n| A web page | iframe |\n\n> Tables, quotes and task lists render on the card.',
    300,
    'A table',
  );
  wire(mdCard, mdSample, 'relates', 'for example');
  ly += Math.max(heightOf(mdCard), heightOf(mdSample) + 20) + GAP;
  steps.push(stop('Markdown cards', [mdCard, mdSample]));

  // 3. Color: palette and shapes.
  const colorCard = card(
    L,
    ly,
    '## Color and shapes\n\nDrop an image and **extract its palette**, or add swatches by hand. Shapes, arrows and freehand lines come from the toolbar; connections between items can carry a label.',
    340,
    'Color',
  );
  const palette = createPaletteItem(
    { x: 0, y: 0 },
    [
      { color: '#1d3557', name: 'Ink' },
      { color: '#457b9d', name: 'Sea' },
      { color: '#a8dadc', name: 'Mist' },
      { color: '#e63946', name: 'Accent' },
    ],
    { name: 'A palette' },
  );
  put(palette, L + 340 + 60, ly + 10);
  const shape = createShape(
    'ellipse',
    { x: L + 340 + 60 + 260 + 40, y: ly + 4, width: 150, height: 110 },
    { stroke: '#457b9d', fill: '#a8dadc', fillGradient: null, strokeWidth: 2, dashed: false },
  );
  ly += Math.max(heightOf(colorCard), heightOf(palette) + 10, 120) + GAP;
  steps.push(stop('Color and shapes', [colorCard, palette, shape]));

  // 4. Links and QR codes.
  const linkCard = card(
    L,
    ly,
    '## Links and codes\n\nA **link button** opens a page in one click. A **QR code** item turns any text or address into a code you can scan from the screen. The browser clipper sends pages, selections and images straight to a board.',
    340,
    'Links',
  );
  const link = createLinkItem({ x: 0, y: 0 });
  updateItems([link], LABEL, (d) => {
    if (d.type === 'link') {
      d.url = 'https://docs.boardcache.com';
      d.label = 'Read the docs';
    }
  });
  put(link, L + 340 + 60, ly + 16);
  const qr = createQrItem({ x: 0, y: 0 }, 'https://boardcache.com');
  put(qr, L + 340 + 60 + 220, ly, { width: 180, height: 180 });
  ly += Math.max(heightOf(linkCard), 180) + GAP;
  steps.push(stop('Links and codes', [linkCard, link, qr]));

  // 5. A case with weighed evidence.
  const caseCard = card(
    L,
    ly,
    '## Cases: a question, its conclusions, the evidence\n\nLink any item to a conclusion as evidence **for** or **against** it, and rate its strength from 1 to 5. The case scores every conclusion from what is linked, so the board keeps the argument honest. Evidence never moves: it stays where you put it.',
    400,
    'Cases',
  );
  const yes = { id: newId(), label: 'Yes, a board helps you think' };
  const no = { id: newId(), label: 'No, a list would do' };
  const theCase = createCaseItem(
    { x: 0, y: 0 },
    {
      title: 'Does a canvas beat a list?',
      question: 'When does laying things out on a board help?',
      conclusions: [yes, no],
    },
  );
  put(theCase, L + 400 + 60, ly);
  const evY = ly + Math.max(heightOf(caseCard), heightOf(theCase)) + 24;
  const ev1 = card(
    L,
    evY,
    'Seeing two things side by side is how you notice they relate.',
    260,
    'Evidence: side by side',
  );
  const ev2 = card(
    L + 290,
    evY,
    'Space carries meaning: near means related, far means unrelated.',
    260,
    'Evidence: space',
  );
  const ev3 = card(
    L + 580,
    evY,
    'For a plain checklist, a board is more than you need.',
    260,
    'Evidence: checklists',
  );
  updateItems([ev1], LABEL, (d) => {
    d.weight = 5;
  });
  updateItems([ev2], LABEL, (d) => {
    d.weight = 4;
  });
  updateItems([ev3], LABEL, (d) => {
    d.weight = 3;
  });
  linkEvidence(theCase, [ev1, ev2], yes.id, 'supports');
  linkEvidence(theCase, [ev3], no.id, 'supports');
  ly = evY + Math.max(heightOf(ev1), heightOf(ev2), heightOf(ev3)) + GAP;
  steps.push(stop('Cases', [caseCard, theCase, ev1, ev2, ev3]));

  // 6. Where it goes from here.
  const next = card(
    L,
    ly,
    '## Where to go from here\n\n- **Add** (top left) lists every item type: images, video, audio, PDFs, web pages, code, polls, recipes, maps and more\n- **Settings** holds themes, plugins, the assistant and backups\n- **Sync** keeps boards on every device, end-to-end encrypted; **Publish** puts a board in the Community; **Share** sends a read-only link\n\nThe library has a short tour of its own: Take the tour, in the sidebar.',
    560,
    'Next',
  );

  // Right column: the containers.
  // 7. Timeline.
  const timelineCard = card(
    R,
    ry,
    '## Timelines\n\nPoints carry a date, a label and a note. Drag items onto a point to shelve them there: photos, documents, anything. Click a point to expand it.',
    320,
    'Timelines',
  );
  const pt = (label: string, date: string, description: string) => ({
    id: newId(),
    label,
    date,
    description,
    color: null,
    collapsed: true,
    itemIds: [],
    freeArrange: false,
  });
  const timeline = createTimelineItem(
    { x: 0, y: 0 },
    {
      name: 'How a board comes together',
      points: [
        pt('Collect', 'Day 1', 'Drop in everything that might matter.'),
        pt('Arrange', 'Day 2', 'Group what belongs together; connect what relates.'),
        pt('Weigh', 'Day 3', 'Rate the evidence; let the case keep score.'),
        pt('Share', 'Day 4', 'Present it, publish it, or send a link.'),
      ],
    },
  );
  put(timeline, R, ry + heightOf(timelineCard) + 20, { width: 760 });
  ry += heightOf(timelineCard) + 20 + heightOf(timeline) + GAP;
  steps.push(stop('Timelines', [timelineCard, timeline]));

  // 8. Tasks.
  const tasksCard = card(
    R,
    ry,
    '## Tasks and projects\n\nA task list lives on the board next to the work. Projects add milestones, a Kanban, a calendar and a Gantt chart, and reminders when a date comes.',
    320,
    'Tasks',
  );
  const tasks = createTasklistItem({ x: 0, y: 0 });
  updateTasklist(tasks, LABEL, (t) => {
    t.title = 'Try these';
    t.tasks = [
      'Drag this list somewhere else',
      'Double-click a card and change a word',
      'Add an image: paste one, or drop a file',
      'Press Present and step through the tour',
    ].map((label) => ({ id: newId(), label, done: false, note: '', due: null, notifiedAt: null }));
  });
  put(tasks, R + 320 + 60, ry);
  ry += Math.max(heightOf(tasksCard), heightOf(tasks)) + GAP;
  steps.push(stop('Tasks', [tasksCard, tasks]));

  // 9. A mind map.
  const treeCard = card(
    R,
    ry,
    '## Trees and mind maps\n\nA tree branches from a root. Drag items onto a node to attach them. The same item can also be laid out as an outline.',
    320,
    'Trees',
  );
  const node = (label: string, parentId: string | null, color?: string) => ({
    id: newId(),
    label,
    parentId,
    itemIds: [],
    ...(color ? { color } : {}),
  });
  const root = node('A question', null, '#1d3557');
  const evidence = node('Evidence', root.id, '#457b9d');
  const sources = node('Sources', root.id, '#2a9d8f');
  const tree = createTreeItem(
    { x: 0, y: 0 },
    {
      title: 'Branches',
      mode: 'mindmap',
      nodes: [
        root,
        evidence,
        node('For', evidence.id),
        node('Against', evidence.id),
        sources,
        node('Primary', sources.id),
        node('Secondary', sources.id),
      ],
    },
  );
  put(tree, R + 320 + 60, ry);
  ry += Math.max(heightOf(treeCard), heightOf(tree)) + GAP;
  steps.push(stop('Trees', [treeCard, tree]));

  // 10. A tier list with a card ranked on it.
  const tierCard = card(
    R,
    ry,
    '## Tier lists\n\nRank anything: drag items onto a row. Rows have their own colors and labels, and the list grows as you fill it.',
    320,
    'Tier lists',
  );
  const tier = createTierListItem(
    { x: 0, y: 0 },
    {
      title: 'Ways to collect',
      rows: [
        { id: newId(), label: 'Daily', color: '#7fdf7f', itemIds: [] },
        { id: newId(), label: 'Sometimes', color: '#ffdf80', itemIds: [] },
        { id: newId(), label: 'Rarely', color: '#ff7f7f', itemIds: [] },
      ],
    },
  );
  put(tier, R, ry + heightOf(tierCard) + 20, { width: 640, height: 340 });
  const contender = card(
    R + 400,
    ry + heightOf(tierCard) + 400,
    'The browser clipper',
    200,
    'Contender',
  );
  const tierItem = useDocumentStore.getState().doc.items[tier];
  if (tierItem?.type === 'tierlist') {
    attachItemsToTierRow([contender], { itemId: tier, rowId: tierItem.rows[0]!.id });
  }
  steps.push(stop('Tier lists', [tierCard, tier]));

  steps.push(stop('Where to go from here', [next]));
  setPresentationSteps(steps);
}

let seedRun: Promise<boolean> | null = null;

/** Seed the welcome board once per device; true when it was built now. */
export function ensureSeedWelcome(): Promise<boolean> {
  seedRun ??= seedWelcomeOnce().finally(() => {
    seedRun = null;
  });
  return seedRun;
}

async function seedWelcomeOnce(): Promise<boolean> {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return false;
  } catch {
    return false;
  }
  if (/^\/(guest|t|s)\//.test(window.location.pathname)) return false;
  const built = await buildIntoLibrary(true);
  if (built) {
    try {
      localStorage.setItem(SEEDED_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }
  return built;
}

/** Build the board as a library record (the live store is borrowed, like
 *  the template seeds); false when the library is not the safe place. */
async function buildIntoLibrary(onlyWhenAbsent: boolean): Promise<boolean> {
  const { useSessionStore } = await import('../../state/sessionStore');
  const { useCollabStore } = await import('../../state/collabStore');
  const { useHistoryStore } = await import('../../state/history');
  const { createDocument } = await import('@boardcache/schema');
  const { saveBoardRecord, listBoards } = await import('./boardLibrary');
  if (useSessionStore.getState().view !== 'library') return false;
  if (useCollabStore.getState().status !== 'off') return false;
  if (onlyWhenAbsent) {
    const boards = await listBoards();
    if (boards.some((b) => b.name === WELCOME_NAME)) return false;
  }
  const temp = createDocument({ name: WELCOME_NAME });
  useDocumentStore.getState().replaceDoc(temp);
  buildWelcomeBoard();
  const doc = useDocumentStore.getState().doc;
  await saveBoardRecord(doc, true);
  if (useDocumentStore.getState().doc.id === temp.id) {
    useDocumentStore.getState().replaceDoc(createDocument({ name: 'Untitled board' }));
    const history = useHistoryStore.getState();
    history.clear();
    history.markSaved();
  }
  try {
    localStorage.setItem(BOARD_KEY, doc.id);
  } catch {
    /* storage unavailable */
  }
  return true;
}

/** Open the welcome board, building it again when it was deleted. */
export async function openWelcomeBoard(): Promise<void> {
  const { listBoards, openBoard } = await import('./boardLibrary');
  const { useSessionStore } = await import('../../state/sessionStore');
  const boards = await listBoards();
  let id: string | null = null;
  try {
    id = localStorage.getItem(BOARD_KEY);
  } catch {
    /* ignore */
  }
  const existing = boards.find((b) => b.id === id) ?? boards.find((b) => b.name === WELCOME_NAME);
  if (existing) {
    await openBoard(existing.id);
    return;
  }
  // Rebuild: the builders borrow the live store, so step out to the library first.
  useSessionStore.getState().setView('library');
  if (await buildIntoLibrary(false)) {
    const again = (await listBoards()).find((b) => b.name === WELCOME_NAME);
    if (again) await openBoard(again.id);
  }
}
