import type { ConnectionRel } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import {
  createTasklistItem,
  createTextFromString,
  createTierListItem,
  createTimelineItem,
  createTreeItem,
} from '../import/createItems';
import { attachItemsToTierRow } from '../structure/tierAttach';
import { updateTasklist } from '../structure/tasklist';
import { useDocumentStore } from '../../state/documentStore';
import { addConnection, setConnectionLabel, updateItems } from '../../state/commands';

/**
 * Template boards (research arc 9/10): starter layouts for the workflows the
 * research features were built around. A template is applied by creating a
 * normal local board, then building its items with the same creators the UI
 * uses — no hand-rolled document JSON to drift from the schema. (These are
 * also the boards to publish as community starters once community launches.)
 */

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  build: () => void;
}

type Status = 'confirmed' | 'unverified' | 'debunked';

/** A markdown card at (x, y); optionally sized, statused, or named. */
function card(
  x: number,
  y: number,
  text: string,
  opts: { width?: number; status?: Status; name?: string } = {},
): string {
  const id = createTextFromString({ x, y }, text, 'Template');
  updateItems([id], 'Template', (d) => {
    if (opts.width) d.width = opts.width;
    if (opts.status) d.status = opts.status;
    if (opts.name) d.name = opts.name;
  });
  return id;
}

const wire = (from: string, to: string, rel: ConnectionRel, label?: string): void => {
  const id = addConnection({ kind: 'item', id: from }, { kind: 'item', id: to }, rel);
  if (id && label) setConnectionLabel(id, label);
};

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: 'investigation',
    name: 'Investigation',
    description: 'Evidence wall: leads, typed connections, evidence statuses.',
    build: () => {
      card(
        60,
        40,
        '# Investigation\n\nPin every lead, then wire them together. Right-click an item → **Evidence** to mark it confirmed / unverified / debunked. Click a connection line to say what it *means* (supports, contradicts). **View → Graph View** shows the whole case; **View → Suggest Connections** finds pairs you may have missed.',
        { width: 560, name: 'How to use this board' },
      );
      const q = card(60, 260, '## Central question\n\nWhat are we actually trying to establish?', {
        width: 360,
        name: 'Central question',
      });
      const e1 = card(
        60,
        470,
        '## Evidence\n\nA verified fact goes here — attach the source URL.',
        {
          width: 300,
          status: 'confirmed',
          name: 'Evidence A',
        },
      );
      const e2 = card(420, 470, '## Tip\n\nAn unverified claim — chase it down.', {
        width: 300,
        status: 'unverified',
        name: 'Lead B',
      });
      const e3 = card(780, 470, '## Rumor\n\nAlready ruled out — kept for the record.', {
        width: 300,
        status: 'debunked',
        name: 'Rumor C',
      });
      const theory = card(
        480,
        220,
        '## Working theory\n\nThe explanation the evidence points to.',
        {
          width: 340,
          name: 'Working theory',
        },
      );
      wire(e1, theory, 'supports');
      wire(e3, theory, 'contradicts');
      wire(theory, q, 'relates', 'answers?');
      wire(e2, theory, 'relates', 'if it checks out');
      card(
        860,
        40,
        '## Open questions\n\n- Who benefits?\n- What is still missing?\n- Which sources are unwired? (Graph View → Unwired sources)',
        { width: 340, name: 'Open questions' },
      );
    },
  },
  {
    id: 'literature-review',
    name: 'Literature Review',
    description: 'Reading pipeline: sources, quote cards, synthesis, bibliography.',
    build: () => {
      card(
        60,
        40,
        '# Literature review\n\nDrop PDFs and links into **To read**. While reading, select a passage → **Quote to Board** to pull it out as a connected quote card. When you are done, **File → Export → Bibliography** (or **Dossier PDF**) writes it all up.',
        { width: 560, name: 'How to use this board' },
      );
      card(60, 250, '## To read\n\nDrop papers, PDFs, and links here.', {
        width: 300,
        name: 'To read',
      });
      const reading = card(420, 250, '## Reading\n\nThe paper currently open.', {
        width: 300,
        name: 'Reading',
      });
      const quote = card(
        420,
        470,
        '> A pulled quote lives on its own card, wired to its paper.\n\n— *Author, p. 12*',
        { width: 300, name: 'Key quote' },
      );
      const synth = card(780, 250, '## Synthesis\n\nWhat the sources agree and disagree on.', {
        width: 340,
        name: 'Synthesis',
      });
      wire(quote, reading, 'cites');
      wire(reading, synth, 'supports');
      card(780, 470, '## Gaps\n\nWhat nobody has answered yet.', { width: 340, name: 'Gaps' });
    },
  },
  {
    id: 'competitive-teardown',
    name: 'Competitive Teardown',
    description: 'Rivals side by side: strengths, weaknesses, positioning.',
    build: () => {
      card(
        60,
        40,
        '# Competitive teardown\n\nOne column per competitor. Clip screenshots and pricing pages straight from the browser extension — every clip keeps its source URL. Mark claims **confirmed** once verified; wire contradictions between marketing and reality.',
        { width: 560, name: 'How to use this board' },
      );
      const a = card(60, 250, '## Competitor A\n\n**Strengths**\n- …\n\n**Weaknesses**\n- …', {
        width: 320,
        name: 'Competitor A',
      });
      const b = card(440, 250, '## Competitor B\n\n**Strengths**\n- …\n\n**Weaknesses**\n- …', {
        width: 320,
        name: 'Competitor B',
      });
      const claim = card(60, 560, '## Their claim\n\n“Fastest in the industry.”', {
        width: 320,
        status: 'unverified',
        name: 'Marketing claim',
      });
      const bench = card(440, 560, '## Our benchmark\n\nMeasured 2× slower under load.', {
        width: 320,
        status: 'confirmed',
        name: 'Benchmark',
      });
      wire(bench, claim, 'contradicts');
      wire(claim, a, 'relates');
      card(820, 250, '## Our positioning\n\nWhere we win — and the proof.', {
        width: 340,
        name: 'Positioning',
      });
      wire(b, a, 'relates', 'compare');
    },
  },
  {
    id: 'creative-brainstorm',
    name: 'Creative Brainstorm',
    description: 'Mind map + parking lot + next-steps checklist for ideation.',
    build: () => {
      card(
        60,
        40,
        '# Creative brainstorm\n\nGrow the mind map first — hover a node for **+**, drag nodes to regroup, double-click to rename. No judging yet: anything wild lands in the **Parking lot**. When the dust settles, wire the keepers to **Taking shape** with an *Inspires* line and turn them into tasks.',
        { width: 560, name: 'How to use this board' },
      );
      const node = (label: string, parentId: string | null, color?: string) => ({
        id: newId(),
        label,
        parentId,
        itemIds: [],
        ...(color ? { color } : {}),
      });
      const root = node('Big idea', null, '#b3272d');
      const how = node('How might we', root.id);
      const wild = node('Wild takes', root.id, '#d9a521');
      const practical = node('Quick wins', root.id, '#2a9d8f');
      createTreeItem(
        { x: 420, y: 560 },
        {
          title: 'Idea map',
          mode: 'mindmap',
          nodes: [
            root,
            how,
            node('…make it effortless?', how.id),
            wild,
            node('The version money can’t buy', wild.id),
            practical,
            node('Shippable this week', practical.id),
          ],
        },
      );
      const parking = card(
        820,
        40,
        '## Parking lot\n\nToo weird for the map (for now):\n\n- …\n- …',
        { width: 320, name: 'Parking lot' },
      );
      const constraints = card(60, 250, '## Constraints\n\n- Budget\n- Deadline\n- Must-haves', {
        width: 300,
        name: 'Constraints',
      });
      const shape = card(820, 250, '## Taking shape\n\nThe idea that keeps winning.', {
        width: 320,
        name: 'Taking shape',
      });
      wire(parking, shape, 'inspires');
      wire(constraints, shape, 'relates', 'keeps it honest');
      const tasks = createTasklistItem({ x: 1120, y: 640 });
      updateTasklist(tasks, 'Template', (t) => {
        t.title = 'Next steps';
        t.tasks = [
          {
            id: newId(),
            label: 'Pick the top three ideas',
            done: false,
            note: '',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Prototype the favorite',
            done: false,
            note: 'Rough is fine',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Share for feedback',
            done: false,
            note: '',
            due: null,
            notifiedAt: null,
          },
        ];
      });
    },
  },
  {
    id: 'product-comparison',
    name: 'Product Comparison',
    description: 'Contender cards, criteria, and a tier list to rank them.',
    build: () => {
      card(
        60,
        40,
        '# Product comparison\n\nOne card per contender — clip screenshots and pricing pages straight onto them. Agree on the **Criteria** first, then drag each contender card onto a tier-list row to rank it (one is already shelved to show how). The **Verdict** card holds the final call and the why.',
        { width: 560, name: 'How to use this board' },
      );
      card(60, 250, '## Criteria\n\n- Price\n- Quality\n- Support\n- Fits our workflow', {
        width: 280,
        name: 'Criteria',
      });
      const a = card(380, 250, '## Contender A\n\n**Pros**\n- …\n\n**Cons**\n- …', {
        width: 300,
        name: 'Contender A',
      });
      const b = card(720, 250, '## Contender B\n\n**Pros**\n- …\n\n**Cons**\n- …', {
        width: 300,
        name: 'Contender B',
      });
      wire(b, a, 'relates', 'compare');
      const verdict = card(1060, 250, '## Verdict\n\nThe pick — and the two reasons why.', {
        width: 300,
        name: 'Verdict',
      });
      wire(a, verdict, 'supports', 'if it ranks top');
      const tier = createTierListItem(
        { x: 480, y: 900 },
        {
          title: 'Product ranking',
          rows: [
            { id: newId(), label: 'Top', color: '#7fdf7f', itemIds: [] },
            { id: newId(), label: 'Solid', color: '#ffdf80', itemIds: [] },
            { id: newId(), label: 'Pass', color: '#ff7f7f', itemIds: [] },
          ],
        },
      );
      // Shelve Contender A on the top row as the worked example.
      const doc = useDocumentStore.getState().doc;
      const tierItem = doc.items[tier];
      if (tierItem?.type === 'tierlist') {
        attachItemsToTierRow([a], { itemId: tier, rowId: tierItem.rows[0]!.id });
      }
    },
  },
  {
    id: 'storyboard',
    name: 'Storyboard',
    description: 'Shot cards in sequence, a beat sheet, and the shot-list checklist.',
    build: () => {
      card(
        60,
        40,
        '# Storyboard\n\nOne card per shot — drop frames, sketches or AI stills straight onto them, and keep the *cut to* lines flowing left to right. Reorder by dragging; statuses mark what\u2019s boarded (green), rough (yellow) or cut (gray fades stay on the record). The **Beat sheet** holds the big shape; the **Shot list** is what\u2019s left to draw.',
        { width: 620, name: 'How to use this board' },
      );
      const s1 = card(
        60,
        320,
        '## Shot 01 \u00b7 EXT. HARBOR \u2014 DAWN\n\nWide establishing. Slow push-in.\n\n**Move** dolly \u00b7 **Lens** 24mm \u00b7 **~6s**',
        { width: 330, status: 'confirmed', name: 'Shot 01' },
      );
      const s2 = card(
        440,
        320,
        '## Shot 02 \u00b7 INT. WAREHOUSE\n\nHands open the manifest. Cut on the page turn.\n\n**Move** locked \u00b7 **Lens** 50mm \u00b7 **~3s**',
        { width: 330, status: 'unverified', name: 'Shot 02' },
      );
      const s3 = card(
        820,
        320,
        '## Shot 03 \u00b7 CU \u2014 AMBER GLASS\n\nWindow light at 4pm; the reflection reveals the dock.\n\n**Move** rack focus \u00b7 **Lens** 85mm \u00b7 **~4s**',
        { width: 330, status: 'unverified', name: 'Shot 03' },
      );
      wire(s1, s2, 'causes', 'cut to');
      wire(s2, s3, 'causes', 'cut to');
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
      createTimelineItem(
        { x: 640, y: 760 },
        {
          name: 'Beat sheet',
          points: [
            pt('Opening image', 'p.1', 'The harbor before anything goes wrong.'),
            pt('Catalyst', 'p.12', 'The manifest doesn\u2019t match the shipment.'),
            pt('Midpoint turn', 'p.55', 'The reflection shot \u2014 someone was watching.'),
            pt('Climax', 'p.85', 'Back to the dock, everything in frame.'),
          ],
        },
      );
      const tasks = createTasklistItem({ x: 1290, y: 420 });
      updateTasklist(tasks, 'Template', (t) => {
        t.title = 'Shot list';
        t.tasks = [
          {
            id: newId(),
            label: 'Board shots 04\u201308',
            done: false,
            note: '',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Pull reference frames',
            done: false,
            note: 'Markers \u2192 capture frame',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Timing pass with scratch VO',
            done: false,
            note: '',
            due: null,
            notifiedAt: null,
          },
        ];
      });
    },
  },
  {
    id: 'podcast-episode',
    name: 'Podcast Episode',
    description: 'Rundown timeline, segment cards, show notes and the pre-flight checklist.',
    build: () => {
      card(
        60,
        40,
        '# Episode rundown\n\nThe **Rundown** is the spine \u2014 expand a point for its beats, and drop clips or links onto segments as they firm up. Talking points live one card per segment so the room can rearrange them. **Show notes** writes itself as you go; the **Pre-flight** list is everything before you hit record.',
        { width: 620, name: 'How to use this board' },
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
      createTimelineItem(
        { x: 700, y: 420 },
        {
          name: 'Rundown \u2014 ~52 min',
          points: [
            pt('Cold open', '0:00', 'Best 40 seconds of the interview, no intro.'),
            pt('Intro + housekeeping', '1:30', 'Who\u2019s here, one sponsor line.'),
            pt('Segment A', '5:00', 'The origin story \u2014 push past the rehearsed version.'),
            pt('Segment B', '25:00', 'The hard part: what almost killed it.'),
            pt('Rapid fire + outro', '45:00', 'Five quick ones, where to find them.'),
          ],
        },
      );
      const a = card(
        60,
        640,
        '## Segment A \u2014 talking points\n\n- The first version nobody saw\n- Why the pivot\n- The email that changed it',
        { width: 340, name: 'Segment A' },
      );
      const b = card(
        440,
        640,
        '## Segment B \u2014 talking points\n\n- The near-death moment\n- What they\u2019d never do again\n- Ask for the NUMBER',
        { width: 340, name: 'Segment B' },
      );
      wire(a, b, 'causes', 'builds to');
      card(820, 640, '## Show notes\n\nLinks and receipts as they come up:\n\n- \u2026\n- \u2026', {
        width: 340,
        name: 'Show notes',
      });
      const tasks = createTasklistItem({ x: 1290, y: 720 });
      updateTasklist(tasks, 'Template', (t) => {
        t.title = 'Pre-flight';
        t.tasks = [
          {
            id: newId(),
            label: 'Confirm guest + calendar link',
            done: true,
            note: '',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Mic + backup recording test',
            done: false,
            note: '',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Chapters + show notes pass',
            done: false,
            note: 'After the edit',
            due: null,
            notifiedAt: null,
          },
          {
            id: newId(),
            label: 'Publish + clip for social',
            done: false,
            note: '',
            due: null,
            notifiedAt: null,
          },
        ];
      });
    },
  },
  {
    id: 'guest-prep',
    name: 'Guest Prep',
    description: 'Guest dossier, question map, and angles wired to the story you want.',
    build: () => {
      card(
        60,
        40,
        '# Guest prep\n\nEverything about the guest on one wall. Clip their work onto the **Dossier**, grow the **Question map** (hover a node for **+**), and wire the strongest **Angles** to the story with *supports* lines. Statuses mark what\u2019s confirmed vs. worth double-checking before you say it on air.',
        { width: 620, name: 'How to use this board' },
      );
      const dossier = card(
        60,
        320,
        '## Dossier\n\n**Who**: \u2026\n**Known for**: \u2026\n**Last three things they shipped**: \u2026\n\nClip interviews, talks and posts here.',
        { width: 360, status: 'confirmed', name: 'Dossier' },
      );
      const angle = card(
        480,
        320,
        '## The angle\n\nThe one story this episode is actually about.',
        { width: 320, name: 'The angle' },
      );
      const risky = card(860, 320, '## Double-check\n\nClaims to verify before repeating on air.', {
        width: 320,
        status: 'unverified',
        name: 'Double-check',
      });
      wire(dossier, angle, 'supports');
      wire(risky, angle, 'contradicts', 'if it doesn\u2019t hold');
      const node = (label: string, parentId: string | null, color?: string) => ({
        id: newId(),
        label,
        parentId,
        itemIds: [],
        ...(color ? { color } : {}),
      });
      const root = node('Questions', null, '#b3272d');
      const open = node('Openers', root.id, '#2a9d8f');
      const deep = node('Deep dive', root.id);
      const rapid = node('Rapid fire', root.id, '#d9a521');
      createTreeItem(
        { x: 520, y: 760 },
        {
          title: 'Question map',
          mode: 'mindmap',
          nodes: [
            root,
            open,
            node('The story behind the bio line', open.id),
            deep,
            node('What almost didn\u2019t work?', deep.id),
            node('The decision you\u2019d reverse', deep.id),
            rapid,
            node('Best advice you ignored', rapid.id),
          ],
        },
      );
    },
  },
];

/**
 * Seed the built-in starters as PERSONAL templates on a fresh profile —
 * they land in My Templates as deletable examples, no picker involved.
 * Builds run against the library's throwaway document (the builders write
 * through the normal command layer), so nothing navigates; bails safely if
 * the user opens a board mid-seed and finishes on the next library visit.
 */
let seedRun: Promise<boolean> | null = null;

/** Concurrency guard: StrictMode/remounts must not double-build the seeds. */
export function ensureSeedTemplates(): Promise<boolean> {
  seedRun ??= seedTemplatesOnce().finally(() => {
    seedRun = null;
  });
  return seedRun;
}

async function seedTemplatesOnce(): Promise<boolean> {
  try {
    if (localStorage.getItem('boardcache:templatesSeeded')) return false;
  } catch {
    return false; // no storage → cannot mark done; never loop-build
  }
  // Builders drive the LIVE document store (same creators the UI uses), so
  // seeding is only safe on a plain library visit. A guest/team deep link
  // boots with view='library' while it joins — seeding then would clobber
  // the joining room's doc. Leave the marker unset; a real library visit
  // seeds later.
  if (/^\/(guest|t|s)\//.test(window.location.pathname)) return false;
  const { useDocumentStore } = await import('../../state/documentStore');
  const { useSessionStore } = await import('../../state/sessionStore');
  const { useCollabStore } = await import('../../state/collabStore');
  const { useHistoryStore } = await import('../../state/history');
  const { createDocument } = await import('@boardcache/schema');
  const { saveBoardRecord, listBoards } = await import('./boardLibrary');
  const existing = new Set((await listBoards()).filter((b) => b.isTemplate).map((b) => b.name));
  let built = false;
  for (const t of BOARD_TEMPLATES) {
    if (useSessionStore.getState().view !== 'library') return built; // marker unset → retry later
    if (useCollabStore.getState().status !== 'off') return built; // live team session owns the doc
    // The marker can appear MID-RUN — a storage wipe re-marking (tests), or
    // another tab finishing its own seed. This run started before it existed;
    // once it does, seeding is claimed elsewhere and continuing would
    // replaceDoc over whatever the user opens next. Abort without marking.
    try {
      if (localStorage.getItem('boardcache:templatesSeeded')) return built;
    } catch {
      return built;
    }
    if (existing.has(t.name)) continue;
    const temp = createDocument({ name: t.name });
    useDocumentStore.getState().replaceDoc(temp);
    t.build();
    const doc = useDocumentStore.getState().doc;
    const flagged = { ...doc, settings: { ...doc.settings, isTemplate: true } };
    await saveBoardRecord(flagged, true);
    // Clear OUR temp doc BEFORE sync-enabling: enableBoardSync re-saves the
    // open doc when ids match, which would overwrite the isTemplate flag.
    // (Skip if the user opened a board meanwhile.)
    if (useDocumentStore.getState().doc.id === temp.id) {
      useDocumentStore.getState().replaceDoc(createDocument({ name: 'Untitled board' }));
      const history = useHistoryStore.getState();
      history.clear();
      history.markSaved();
    }
    // Signed in → the examples roam like any saved template.
    const { useSyncStore } = await import('../../state/syncStore');
    if (useSyncStore.getState().status === 'signedIn') {
      const { enableBoardSync, markBoardDirty } = await import('../sync/boardSync');
      await enableBoardSync(flagged.id);
      await markBoardDirty(flagged.id);
    }
    built = true;
  }
  try {
    localStorage.setItem('boardcache:templatesSeeded', '1');
  } catch {
    /* storage unavailable */
  }
  return built;
}
