import { produce } from 'immer';
import { DEFAULT_FONT_FAMILY } from '@boardcache/schema';
import { getCanvasContainer, clientToCanvas } from '../canvas/canvasDom';
import { createTextBoxes, TEXT_DEFAULTS } from '../import/createItems';
import { measureMarkdownHeight } from '../text/markdown';
import { placeBesideContent } from '../canvas/placement';
import { fitViewportTo, focusViewportOn } from '../canvas/viewportActions';
import { promptModels, useAIStore, type ModelRef } from '../../state/aiStore';
import { textProviderMeta } from './providers';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { streamText } from './streamText';
import type { Point } from '../canvas/coords';

const GEN_WIDTH = 380;
const DOC_WIDTH = 600;
const MAX_HEIGHT = 560;
const COL_GAP = 84;

/** Markdown body: prompt header, rule, response, rule, footer. */
function compose(prompt: string, body: string, footer?: string): string {
  const header = prompt.replace(/\s+/g, ' ').trim();
  return `_**Prompt:** ${header}_\n\n---\n\n${body}` + (footer ? `\n\n---\n\n${footer}` : '');
}

const pad = (n: number) => String(n).padStart(2, '0');
function nowStamp(): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  const h = d.getHours() % 12 || 12;
  return `${date} at ${h}:${pad(d.getMinutes())} ${ampm}`;
}

/**
 * Create a markdown text box per selected model and stream each model's response
 * into its own box simultaneously. Boxes are laid out in a row beside existing
 * content (never overlapping) and the view fits the row. The whole batch is one
 * undo step; streamed tokens update the doc without history (one paint/frame).
 */
export async function generateTextToCanvas(prompt: string, signal?: AbortSignal): Promise<void> {
  const models = promptModels();
  if (models.length === 0) return;

  const single = models.length === 1;
  const placeholder = compose(prompt, '');
  const height = measureMarkdownHeight(
    placeholder,
    GEN_WIDTH,
    TEXT_DEFAULTS.fontSize,
    DEFAULT_FONT_FAMILY,
  );

  // Lay out N columns beside existing content.
  const pitch = GEN_WIDTH + COL_GAP;
  const rowWidth = models.length * GEN_WIDTH + (models.length - 1) * COL_GAP;
  const { doc } = useDocumentStore.getState();
  const viewCenter = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const { topLeft, growUp } = placeBesideContent(doc, rowWidth, height, viewCenter);

  const positions: Point[] = models.map((_, i) => ({ x: topLeft.x + i * pitch, y: topLeft.y }));
  const ids = createTextBoxes(
    positions.map((p) => ({ topLeft: p, width: GEN_WIDTH, text: placeholder })),
    models.length > 1 ? 'Generate texts' : 'Generate text',
  );

  // Frame the whole row (or zoom to 100% on a single box).
  if (single) {
    focusViewportOn(
      { x: topLeft.x + GEN_WIDTH / 2, y: topLeft.y + height / 2 },
      getCanvasContainer(),
    );
  } else {
    fitViewportTo({ x: topLeft.x, y: topLeft.y, width: rowWidth, height }, getCanvasContainer());
  }

  await Promise.all(
    ids.map((id, i) =>
      runGeneration({
        itemId: id,
        prompt,
        model: models[i]!,
        topLeft: positions[i]!,
        initialHeight: height,
        growUp,
        // Only a lone box widens to document width; columns stay fixed so they
        // never grow into each other.
        allowWiden: single,
        ...(signal ? { signal } : {}),
      }).catch(() => {}),
    ),
  );
}

interface GenOpts {
  itemId: string;
  prompt: string;
  model: ModelRef;
  topLeft: Point;
  initialHeight: number;
  growUp: boolean;
  allowWiden: boolean;
  signal?: AbortSignal;
}

/** Stream one model's response into one already-created box. */
async function runGeneration(opts: GenOpts): Promise<void> {
  const { itemId, prompt, model, topLeft, initialHeight, growUp, allowWiden, signal } = opts;
  const provider = useAIStore.getState().providers[model.providerId];
  const config = { apiKey: provider.apiKey, model: model.model, baseUrl: provider.baseUrl };
  const meta = textProviderMeta(model.providerId);
  const setPhase = useSessionStore.getState().setAiGeneration;
  setPhase(itemId, 'thinking');

  const anchorBottom = topLeft.y + initialHeight;
  let width = GEN_WIDTH;

  const writeBody = (body: string, footer?: string) => {
    const { doc, replaceDoc } = useDocumentStore.getState();
    const item = doc.items[itemId];
    if (!item || item.type !== 'text') return;
    const text = compose(prompt, body, footer);
    let contentH = measureMarkdownHeight(text, width, item.fontSize, item.fontFamily);
    if (allowWiden && contentH > MAX_HEIGHT && width < DOC_WIDTH) {
      width = DOC_WIDTH;
      contentH = measureMarkdownHeight(text, width, item.fontSize, item.fontFamily);
    }
    const h = Math.min(contentH, MAX_HEIGHT);
    replaceDoc(
      produce(doc, (d) => {
        const it = d.items[itemId];
        if (it && it.type === 'text') {
          it.text = text;
          it.width = width;
          it.height = h;
          if (growUp) it.y = anchorBottom - h;
        }
      }),
    );
  };

  let acc = '';
  let frame = 0;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      writeBody(acc);
    });
  };

  try {
    const stream = streamText(
      signal
        ? { providerId: model.providerId, config, prompt, signal }
        : { providerId: model.providerId, config, prompt },
    );
    let started = false;
    for await (const delta of stream) {
      if (!started) {
        started = true;
        setPhase(itemId, 'streaming');
      }
      acc += delta;
      schedule();
    }
    cancelAnimationFrame(frame);
    setPhase(itemId, null);
    writeBody(
      acc || '_No response._',
      `_Generated on ${nowStamp()} from ${meta.label}'s ${config.model}._`,
    );
  } catch (err) {
    cancelAnimationFrame(frame);
    setPhase(itemId, null);
    const message = err instanceof Error ? err.message : String(err);
    writeBody(acc ? `${acc}\n\n> ⚠️ ${message}` : `> ⚠️ Generation failed: ${message}`);
    throw err;
  }
}
