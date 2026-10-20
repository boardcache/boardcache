import { getAssetBlob } from '../../../lib/board/assetStore';
import { useDocumentStore } from '../../../state/documentStore';
import { useSessionStore } from '../../../state/sessionStore';
import { runBoardTool } from '../../../lib/tools/registry';
import { BOARD_RULES } from '../../../lib/tools/briefing';
import type { NeutralImage } from './adapters';

/**
 * Context assembly: what the model knows about the board on every request.
 * The system prompt carries a live compact inventory + full detail for the
 * current selection; selected images additionally ship as (downscaled)
 * pixels for vision-capable models.
 */

const VISION_MAX_EDGE = 768;
const VISION_MAX_IMAGES = 4;

/**
 * Hosted tiers know about each other. The fast model points at the switch
 * when the job is judgement across the whole board; the frontier model
 * knows it was asked for. Neither line is sent for BYO providers.
 */
export const TIER_NOTES = {
  fast: [
    '',
    'MODEL TIER: you are the fast, inexpensive model. The user can flip "Think harder" (the brain button) to run the frontier model at a higher credit price. Do every request as well as you can, and when a request is judgement across the whole board — finding contradictions among many claims, restructuring an argument, planning research, writing a report or dossier, weighing sources — add ONE short closing sentence suggesting Think harder would likely do it better. Never suggest it for simple actions (adding, arranging, renaming, small questions), and never more than once per answer.',
  ].join('\n'),
  deep: [
    '',
    'MODEL TIER: you are the frontier model; the user chose "Think harder" for this turn and is paying more for it. Take the extra care that implies: read the whole board, weigh the evidence, and be precise.',
  ].join('\n'),
} as const;

export async function buildSystemPrompt(
  focusItemId?: string,
  tier: keyof typeof TIER_NOTES | null = null,
): Promise<string> {
  const summary = await runBoardTool('get_board_summary', {});
  const selection = await runBoardTool('get_selection', {});
  const focus = focusItemId ? await runBoardTool('get_items', { ids: [focusItemId] }) : null;
  return [
    'You are the board assistant inside boardCache, a visual moodboard app.',
    'You see the current board and can act on it with the provided tools.',
    '',
    BOARD_RULES,
    '- "@name" in a user message tags a specific item; its full detail is appended to that message.',
    '- Keep answers brief; the board is the deliverable, not the prose.',
    '- search_chat_history retrieves earlier conversations when the user references past discussions.',
    '- The library tools (list_boards, open_board, create_board, folders, tags) work beyond this board: opening or creating a board switches the app to it, and your next round sees that board instead.',
    '- When a statement in your answer draws on a SPECIFIC item, cite it inline as [[item:ITEM_ID]] immediately after the statement. Only ever use real item ids from this board — never invent one.',
    ...(tier ? [TIER_NOTES[tier]] : []),
    '',
    `CURRENT BOARD (live): ${JSON.stringify((summary as { ok: true; result: unknown }).result ?? {})}`,
    '',
    `CURRENT SELECTION (live, full detail): ${JSON.stringify((selection as { ok: true; result: unknown }).result ?? {})}`,
    ...(focus && (focus as { ok: boolean }).ok
      ? [
          'FOCUS ITEM — this conversation is about the following item; treat it as the primary subject and full context:',
          JSON.stringify((focus as { ok: true; result: unknown }).result ?? {}),
        ]
      : []),
  ].join('\n');
}

/** Downscaled pixels for selected (and @-tagged) image items (vision context). */
export async function selectedImagePixels(extraIds: string[] = []): Promise<NeutralImage[]> {
  const { doc } = useDocumentStore.getState();
  const ids = [...new Set([...useSessionStore.getState().selection, ...extraIds])];
  const images: NeutralImage[] = [];
  for (const id of ids) {
    if (images.length >= VISION_MAX_IMAGES) break;
    const item = doc.items[id];
    if (!item || item.type !== 'image') continue;
    const blob = await getAssetBlob(item.previewAssetId ?? item.assetId);
    if (!blob || blob.type === 'image/svg+xml') continue; // svg → skip (charts read via tools)
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, VISION_MAX_EDGE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
      if (!jpeg) continue;
      const buf = new Uint8Array(await jpeg.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
      images.push({ b64: btoa(bin), mime: 'image/jpeg' });
    } catch {
      /* undecodable — skip */
    }
  }
  return images;
}
