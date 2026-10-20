import type { jsPDF as JsPdf } from 'jspdf';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { boardCitations } from './bibliography';
import { relName } from '../canvas/connectionTypes';
import { downloadBlob } from './download';
import { statusMeta } from '../text/evidenceStatus';
import { mediaMeta } from '../mediaItems';
import { showNotice } from '../notices';
import { renderItemCanvas } from '../media/thumbnail';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Dossier export (research arc 8/10): the narrative remix of the asset PDF.
 * Items flow in reading order — text as prose, media as numbered, captioned
 * figures (source URL + evidence status when present) — followed by the
 * typed connections written out as sentences and a closing bibliography.
 */

type Pdf = JsPdf;

const PAGE_W = 612; // letter, pt
const PAGE_H = 792;
const MARGIN = 64;
const BODY_W = PAGE_W - MARGIN * 2;

interface Flow {
  pdf: Pdf;
  y: number;
}

function ensureRoom(f: Flow, need: number): void {
  if (f.y + need > PAGE_H - MARGIN) {
    f.pdf.addPage();
    f.y = MARGIN;
  }
}

function paragraph(
  f: Flow,
  text: string,
  opts: {
    size?: number;
    style?: string;
    indent?: number;
    color?: [number, number, number];
    gap?: number;
  } = {},
): void {
  const size = opts.size ?? 11;
  const indent = opts.indent ?? 0;
  f.pdf.setFont('helvetica', opts.style ?? 'normal');
  f.pdf.setFontSize(size);
  f.pdf.setTextColor(...(opts.color ?? ([30, 32, 38] as [number, number, number])));
  const lines = f.pdf.splitTextToSize(text, BODY_W - indent) as string[];
  const lineH = size * 1.42;
  for (const line of lines) {
    ensureRoom(f, lineH);
    f.pdf.text(line, MARGIN + indent, f.y);
    f.y += lineH;
  }
  f.y += opts.gap ?? 5;
}

function heading(f: Flow, text: string, size: number): void {
  ensureRoom(f, size * 2.2);
  f.y += size * 0.5;
  paragraph(f, text, { size, style: 'bold', gap: size * 0.55 });
}

/** Light markdown → prose: headings, blockquotes, bullets, plain paragraphs. */
function proseFromMarkdown(f: Flow, md: string): void {
  for (const block of md.split(/\n{2,}/)) {
    const lines = block.split('\n');
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        heading(f, h[2]!, h[1]!.length <= 2 ? 15 : 12.5);
        continue;
      }
      if (line.startsWith('>')) {
        paragraph(f, line.replace(/^>\s?/, ''), { style: 'italic', indent: 18, gap: 2 });
        continue;
      }
      const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
      if (bullet) {
        paragraph(f, `•  ${bullet[1]!}`, { indent: 10, gap: 2 });
        continue;
      }
      paragraph(f, line.replace(/\*\*?|__?|`/g, ''), { gap: 2 });
    }
    f.y += 5;
  }
}

/** Reading order: manual gallery order first, else top-to-bottom rows. */
function readingOrder(doc: CanvasDocument): Item[] {
  const items = Object.values(doc.items);
  const manual = doc.settings.galleryOrder;
  if (manual.length) {
    const rank = new Map(manual.map((id, i) => [id, i]));
    return [...items].sort(
      (a, b) =>
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.y - b.y || a.x - b.x,
    );
  }
  // Row bands: items within ~one card height of each other read left→right.
  return [...items].sort((a, b) => {
    const band = 220;
    const ra = Math.round(a.y / band);
    const rb = Math.round(b.y / band);
    return ra - rb || a.x - b.x || a.y - b.y;
  });
}

const isProse = (item: Item): boolean => item.type === 'text' || item.type === 'title';

/** Media types worth a figure (rasterize cleanly via renderItemCanvas). */
const FIGURE_TYPES = new Set([
  'image',
  'video',
  'pdf',
  'map',
  'iframe',
  'shape',
  'swatch',
  'palette',
  'chart',
  'qr',
  'epub',
  'font',
  'code',
]);

export async function exportDossier(): Promise<void> {
  const doc = useDocumentStore.getState().doc;
  const ordered = readingOrder(doc).filter((i) => isProse(i) || FIGURE_TYPES.has(i.type));
  if (ordered.length === 0) {
    showNotice('Nothing to write up yet — add text or media items first.', {
      id: 'dossier-empty',
      kind: 'info',
    });
    return;
  }

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const f: Flow = { pdf, y: MARGIN };

  // --- Cover ---------------------------------------------------------------
  const citations = boardCitations(doc);
  const connections = Object.values(doc.connections);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(120, 124, 134);
  pdf.text('DOSSIER', MARGIN, 200);
  pdf.setFontSize(30);
  pdf.setTextColor(24, 26, 32);
  const titleLines = pdf.splitTextToSize(doc.name, BODY_W) as string[];
  pdf.text(titleLines, MARGIN, 236);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11.5);
  pdf.setTextColor(90, 94, 104);
  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  pdf.text(
    `${today}  ·  ${n(ordered.length, 'exhibit')}  ·  ${n(connections.length, 'connection')}  ·  ${n(citations.length, 'source')}`,
    MARGIN,
    244 + titleLines.length * 32,
  );
  pdf.addPage();
  f.y = MARGIN;

  // --- Narrative body ------------------------------------------------------
  // Pages (docs/archive/PAGES_PLAN.md): the narrative walks page by page with a
  // section heading between sheets. Single-page boards read as before.
  const firstPg = doc.pages[0]?.id ?? null;
  const pageOfItem = (i: (typeof ordered)[number]) => i.pageId ?? firstPg;
  const pageSections =
    doc.pages.length > 1
      ? doc.pages.map((p) => ({
          name: p.name,
          items: ordered.filter((i) => pageOfItem(i) === p.id),
        }))
      : [{ name: null as string | null, items: ordered }];
  let figureNo = 0;
  for (const section of pageSections) {
    if (section.items.length === 0) continue;
    if (section.name) heading(f, section.name, 17);
    for (const item of section.items) {
      if (item.type === 'text' || item.type === 'title') {
        proseFromMarkdown(f, item.text);
        continue;
      }
      // A figure: rasterized preview, then caption + provenance + status.
      figureNo++;
      let canvas: HTMLCanvasElement;
      try {
        canvas = await renderItemCanvas(item, 2);
      } catch {
        figureNo--;
        continue;
      }
      const maxW = BODY_W;
      const maxH = 320;
      const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
      const w = canvas.width * scale;
      const h = canvas.height * scale;
      ensureRoom(f, h + 40);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.82), 'JPEG', MARGIN, f.y, w, h);
      f.y += h + 14;
      const meta = mediaMeta(item);
      const status = statusMeta(item.status);
      let caption = `Figure ${figureNo}. ${meta.title}`;
      if (status) caption += `  [${status.name.toUpperCase()}]`;
      if (item.weight) caption += `  [STRENGTH ${item.weight}/5]`;
      paragraph(f, caption, {
        size: 9.5,
        style: 'bold',
        gap: 1,
        color: status ? hexRgb(status.color) : [90, 94, 104],
      });
      const src = item.source?.url ?? item.linkUrl ?? (item.type === 'link' ? item.url : null);
      if (src) paragraph(f, src, { size: 8.5, color: [120, 124, 134], gap: 1 });
      if (item.notes) paragraph(f, item.notes, { size: 9.5, style: 'italic', gap: 2 });
      f.y += 8;
    }
  }

  // --- Connections as sentences --------------------------------------------
  const clipName = (t: string): string => {
    if (t.length <= 44) return t;
    const cut = t.slice(0, 44);
    return `${cut.slice(0, Math.max(20, cut.lastIndexOf(' ')))}…`;
  };
  const nameOf = (id: string, kind: 'item' | 'group'): string =>
    kind === 'group'
      ? (doc.groups[id]?.name ?? 'Group')
      : doc.items[id]
        ? clipName(mediaMeta(doc.items[id]!).title)
        : '(removed)';
  if (connections.length) {
    pdf.addPage();
    f.y = MARGIN;
    heading(f, 'Connections', 17);
    for (const c of connections) {
      const rel = relName((c.rel ?? 'relates') as never).toLowerCase();
      let line = `“${nameOf(c.from.id, c.from.kind)}” ${rel} “${nameOf(c.to.id, c.to.kind)}”`;
      if (c.label) line += ` — “${c.label}”`;
      paragraph(f, `•  ${line}`, { size: 10.5, indent: 6, gap: 3 });
    }
  }

  // --- Bibliography ---------------------------------------------------------
  if (citations.length) {
    pdf.addPage();
    f.y = MARGIN;
    heading(f, 'Bibliography', 17);
    for (const c of citations) {
      let line = c.title;
      if (c.author) line += ` — ${c.author}`;
      if (c.site && c.site !== c.title) line += `. ${c.site}`;
      paragraph(f, line, { size: 10.5, style: 'bold', gap: 0 });
      paragraph(f, c.url, { size: 8.5, color: [120, 124, 134], gap: c.quote ? 0 : 6 });
      if (c.quote) paragraph(f, `“${c.quote}”`, { size: 9.5, style: 'italic', indent: 14, gap: 6 });
    }
  }

  const name =
    doc.name
      .replace(/[^\p{L}\p{N} _-]+/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'board';
  downloadBlob(
    new Blob([pdf.output('arraybuffer') as ArrayBuffer], { type: 'application/pdf' }),
    `${name}-dossier.pdf`,
  );
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
