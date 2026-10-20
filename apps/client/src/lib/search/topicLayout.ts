import { computeOrganize, unitsFor } from '../canvas/arrange';
import { getCanvasContainer } from '../canvas/canvasDom';
import { buildCorpus, pairScore } from './similarity';
import { zoomToFit } from '../canvas/viewportActions';
import { transformItems, type BoundsPatch } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Organize by Topic: cluster items by content similarity (local vectors —
 * semantic when enabled, keyword overlap otherwise), then lay each cluster
 * out as its own masonry block, blocks side by side. Items without enough
 * text land together in a trailing block. One undo step.
 */

const JOIN_THRESHOLD = 0.22;
const ZONE_GUTTER = 220;

export async function organizeByTopic(): Promise<number> {
  const doc = useDocumentStore.getState().doc;
  const corpus = await buildCorpus(doc);

  // Greedy agglomeration: join the cluster you're most similar to (sampled).
  const clusters: string[][] = [];
  for (const entry of corpus.entries) {
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < clusters.length; c++) {
      const sample = clusters[c]!.slice(0, 6);
      const score =
        sample.reduce((acc, id) => acc + pairScore(corpus, entry.id, id), 0) / sample.length;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best >= 0 && bestScore >= JOIN_THRESHOLD) clusters[best]!.push(entry.id);
    else clusters.push([entry.id]);
  }

  // Loners + no-text items share one trailing "everything else" block.
  const strong = clusters.filter((c) => c.length >= 2).sort((a, b) => b.length - a.length);
  const placed = new Set(strong.flat());
  const rest = Object.keys(doc.items).filter((id) => !placed.has(id));
  const zones = rest.length ? [...strong, rest] : strong;
  if (zones.length === 0) return 0;

  let offsetX = 0;
  const patches: Record<string, BoundsPatch> = {};
  for (const ids of zones) {
    const zonePatches = computeOrganize(unitsFor(ids));
    let width = 0;
    for (const p of Object.values(zonePatches)) {
      width = Math.max(width, (p.x ?? 0) + (p.width ?? 0));
    }
    for (const [id, p] of Object.entries(zonePatches)) {
      patches[id] = { ...p, x: (p.x ?? 0) + offsetX };
    }
    offsetX += width + ZONE_GUTTER;
  }
  transformItems(patches, 'Organize by topic');
  zoomToFit(getCanvasContainer());
  return zones.length;
}
