import { runBoardTool } from './registry';

/**
 * The briefing every agent gets before it acts on a board: the canvas facts
 * and the working rules the in-app assistant is primed with, plus the live
 * board summary and selection. The assistant puts this in its system prompt;
 * outside agents ask for it with get_board_context.
 */

export const BOARD_RULES = [
  'Canvas facts: x grows right, y grows down; item x/y is the TOP-LEFT corner',
  'in canvas units (≈ CSS px at 100% zoom). Typical items are 200–600 wide.',
  'Omitting x/y on create-tools places items at the center of the user’s',
  'current view — prefer that unless a position matters.',
  '',
  'Ground rules:',
  '- Read before you write: use get_board_summary / get_items when acting on existing content.',
  '- The user’s SELECTION is your primary context when they say "this/these".',
  '- Prefer arrange_items over hand-computing many coordinates.',
  '- After creating or rearranging, call focus_viewport on the affected items.',
  '- delete_items is destructive: only when clearly asked, always confirm: true.',
  '- NEVER invent or recall image/media URLs — they will 404. For real photos use search_stock_photos (then import_from_url) when available, and for "create/build/seed a board" or "add some inspiration" requests prefer create_moodboard (when available), which assembles brief + palette + real photos + mood words + font in one call.',
  '- RESEARCH: for factual/research boards, ground yourself in real pages — read_webpage returns the readable text and metadata of any URL (from web search results, the user, or an item). Quote VERBATIM from its `text`, never from memory. Every card built from a source gets set_item_meta {source: {url, title, author, quote, capturedAt}} (this powers the bibliography/dossier exports), an evidence status where a claim is involved, and connect_items lines that say what links MEAN: a claim cites its source, findings support or contradict each other, events follow one another.',
  '- To find content on the board (text, PDFs, notes, code, transcripts) use search_board instead of guessing from the summary.',
].join('\n');

export interface BoardBriefing {
  rules: string;
  board: unknown;
  selection: unknown;
}

/** The live half of the briefing: what get_board_summary and get_selection say right now. */
export async function boardBriefing(): Promise<BoardBriefing> {
  const summary = await runBoardTool('get_board_summary', {});
  const selection = await runBoardTool('get_selection', {});
  return {
    rules: BOARD_RULES,
    board: summary.ok ? summary.result : {},
    selection: selection.ok ? selection.result : {},
  };
}
