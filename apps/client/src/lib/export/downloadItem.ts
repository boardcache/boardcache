import type { CanvasDocument, Item } from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import { exportPaletteAse } from '../color/paletteActions';
import { downloadFont, fontFamilyMembers } from '../integrations/fontDownload';
import { mapExternalUrl } from '../integrations/mapEmbed';
import { exportItem } from '../media/imageExport';
import { downloadQrPng, downloadQrSvg } from '../media/qr';
import { renderItemCanvas } from '../media/thumbnail';
import { mediaMeta } from '../mediaItems';
import { conclusionScores, formatScore } from '../structure/cases';
import { downloadBlob, exportFileName } from './download';
import { exportPlainZip, extFromMime, planPlainEntries } from './exportPlainZip';
import type { PlainEntry } from './exportPlainZip';

/**
 * Every item can be downloaded; what you get depends on what it is made of.
 * The options, in order: the item's own file (the stored image, video, PDF,
 * font, the markdown or code source, a .url shortcut), a Markdown rendering
 * for the structured cards (task lists, projects, cases, timelines…), the
 * type's own extras (.ase for palettes, SVG for QR codes), and always a PNG
 * of the item as it looks on the canvas. The context menu and the lightbox
 * sidebar both list these.
 */

export interface ItemDownload {
  id: string;
  /** Menu / button label: "Markdown (.md)". */
  label: string;
  run: () => Promise<void>;
}

const safeTitle = (item: Item) => mediaMeta(item).title || item.type;

async function downloadPng(item: Item): Promise<void> {
  const canvas = await renderItemCanvas(item, 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render the item.');
  downloadBlob(blob, exportFileName(undefined, safeTitle(item), 'png'));
}

async function downloadPlain(item: Item): Promise<void> {
  const entries = planPlainEntries(item);
  if (entries.length === 0) return;
  if (entries.length > 1) {
    await exportPlainZip([item], safeTitle(item));
    return;
  }
  const entry = entries[0]!;
  if (entry.text !== undefined) {
    downloadBlob(
      new Blob([entry.text], { type: 'text/plain;charset=utf-8' }),
      exportFileName(undefined, entry.base, entry.ext ?? 'txt'),
    );
    return;
  }
  if (entry.assetId) {
    const blob = await getAssetBlob(entry.assetId);
    if (!blob) throw new Error('The file is not on this device.');
    downloadBlob(blob, exportFileName(undefined, entry.base, entry.ext ?? extFromMime(blob.type)));
  }
}

/** The file extension a plain download would carry, for the label. */
function plainExt(item: Item): string | null {
  const entries = planPlainEntries(item);
  if (entries.length === 0) return null;
  if (entries.length > 1) return 'zip';
  const e = entries[0]!;
  if (e.ext) return e.ext;
  if (item.type === 'image') return null; // depends on the stored bytes
  return null;
}

// ---- Markdown renderings of the structured cards --------------------------------

const line = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (doc: CanvasDocument, id: string) => {
  const it = doc.items[id];
  return it ? line(mediaMeta(it).title) || it.type : '(missing item)';
};

/** Markdown for an item, or null when the type has no useful text form. */
function itemMarkdown(item: Item, doc: CanvasDocument): string | null {
  const title = line(mediaMeta(item).title);
  switch (item.type) {
    case 'tasklist':
      return [
        `# ${item.title}`,
        '',
        ...item.tasks.map((t) => {
          const due = t.due ? ` (due ${t.due.slice(0, 10)})` : '';
          const note = t.note ? `\n  ${line(t.note)}` : '';
          return `- [${t.done ? 'x' : ' '}] ${line(t.label)}${due}${note}`;
        }),
        '',
      ].join('\n');
    case 'project': {
      const out = [`# ${item.title}`, ''];
      if (item.description) out.push(line(item.description), '');
      out.push(
        `Status: ${item.status}` +
          (item.startDate || item.endDate
            ? ` · ${item.startDate ?? '?'} to ${item.endDate ?? '?'}`
            : ''),
        '',
      );
      for (const m of item.milestones) {
        out.push(`## ${line(m.title)} (${m.status})`);
        for (const t of item.tasks.filter((t) => t.milestoneId === m.id)) {
          out.push(
            `- [${t.status === 'done' ? 'x' : ' '}] ${line(t.title)} (${t.status}${t.due ? `, due ${t.due}` : ''})`,
          );
          for (const st of t.subtasks) out.push(`  - [${st.done ? 'x' : ' '}] ${line(st.label)}`);
        }
        out.push('');
      }
      const loose = item.tasks.filter((t) => !t.milestoneId);
      if (loose.length) {
        out.push(
          '## Tasks',
          ...loose.map(
            (t) => `- [${t.status === 'done' ? 'x' : ' '}] ${line(t.title)} (${t.status})`,
          ),
          '',
        );
      }
      return out.join('\n');
    }
    case 'recipe':
      return [
        `# ${item.title}`,
        '',
        [
          item.servings ? `Serves ${item.servings}` : '',
          item.totalMin ? `${item.totalMin} min` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        '',
        '## Ingredients',
        ...item.ingredients.map((i) => `- ${line(i)}`),
        '',
        '## Steps',
        ...item.steps.map((s, i) => `${i + 1}. ${line(s)}`),
        '',
        ...(item.sourceUrl ? [`Source: ${item.sourceUrl}`, ''] : []),
      ].join('\n');
    case 'poll': {
      const tally = item.options.map((o) => ({
        label: o.label,
        votes: Object.values(item.votes).filter((v) => v.optionIds.includes(o.id)).length,
      }));
      return [
        `# ${line(item.question)}`,
        '',
        ...tally.map((t) => `- ${line(t.label)}: ${t.votes}`),
        '',
        item.closed ? 'Closed.' : 'Open.',
        '',
      ].join('\n');
    }
    case 'case': {
      const scores = conclusionScores(doc.items, item);
      return [
        `# ${item.title}`,
        ...(item.question ? ['', line(item.question)] : []),
        '',
        ...scores.flatMap((row) => [
          `## ${line(row.conclusion.label)} (${formatScore(row.net)})`,
          ...item.evidence
            .filter((e) => e.conclusionId === row.conclusion.id)
            .map((e) => {
              const it = doc.items[e.itemId];
              const w = it?.weight ? ` ×${it.weight}` : '';
              return `- ${e.stance === 'supports' ? '+' : '−'} ${nameOf(doc, e.itemId)}${w}`;
            }),
          '',
        ]),
      ].join('\n');
    }
    case 'tierlist':
      return [
        `# ${item.title}`,
        ...(item.description ? ['', line(item.description)] : []),
        '',
        ...item.rows.flatMap((r) => [
          `## ${line(r.label)}`,
          ...r.itemIds.map((id) => `- ${nameOf(doc, id)}`),
          '',
        ]),
      ].join('\n');
    case 'timeline':
      return [
        `# ${title || 'Timeline'}`,
        '',
        ...item.points.flatMap((p) => [
          `## ${line(p.label)}${p.date ? ` — ${line(p.date)}` : ''}`,
          ...(p.description ? [line(p.description)] : []),
          ...p.itemIds.map((id) => `- ${nameOf(doc, id)}`),
          '',
        ]),
      ].join('\n');
    case 'tree': {
      const children = (parent: string | null) =>
        item.nodes.filter((n) => (n.parentId ?? null) === parent);
      const walk = (parent: string | null, depth: number): string[] =>
        children(parent).flatMap((n) => [
          `${'  '.repeat(depth)}- ${line(n.label)}`,
          ...n.itemIds.map((id) => `${'  '.repeat(depth + 1)}- ${nameOf(doc, id)}`),
          ...walk(n.id, depth + 1),
        ]);
      return [`# ${item.title}`, '', ...walk(null, 0), ''].join('\n');
    }
    case 'storyboard':
      return [
        `# ${item.title}`,
        '',
        ...item.panels.flatMap((p) => [
          `## ${line(p.label)}`,
          ...(p.scene ? [line(p.scene)] : []),
          ...(p.action ? [line(p.action)] : []),
          ...([p.move, p.lens, p.duration != null ? `${p.duration}s` : ''].filter(Boolean).length
            ? [
                [p.move, p.lens, p.duration != null ? `${p.duration}s` : '']
                  .filter(Boolean)
                  .join(' · '),
              ]
            : []),
          ...p.itemIds.map((id) => `- ${nameOf(doc, id)}`),
          '',
        ]),
      ].join('\n');
    case 'rss':
      return [
        `# ${line(item.feedTitle) || title || 'Feed'}`,
        '',
        item.url,
        '',
        ...item.entries.map((e) => `- [${line(e.title)}](${e.link})`),
        '',
      ].join('\n');
    case 'map':
      return [
        `# ${title || 'Map'}`,
        '',
        item.mapMode === 'directions'
          ? `${line(item.origin)} → ${line(item.destination)} (${item.travelMode})`
          : `${item.lat}, ${item.lng} (zoom ${item.zoom})`,
        '',
        mapExternalUrl(item),
        '',
      ].join('\n');
    case 'link':
      return item.url ? `[${line(item.label) || item.url}](${item.url})\n` : null;
    case 'iframe':
      return `[${title || item.url}](${item.url})\n`;
    default:
      return null;
  }
}

/** Zip entries holding the Markdown form of every structured card among the items. */
export function cardMarkdownEntries(items: Item[], doc: CanvasDocument): PlainEntry[] {
  return items.flatMap((item) => {
    if (item.type === 'text' || item.type === 'title' || item.type === 'code') return [];
    const md = itemMarkdown(item, doc);
    return md === null ? [] : [{ folder: 'cards', base: safeTitle(item), ext: 'md', text: md }];
  });
}

function downloadMarkdown(item: Item, doc: CanvasDocument): Promise<void> {
  const md = itemMarkdown(item, doc);
  if (md === null) return Promise.resolve();
  downloadBlob(
    new Blob([md], { type: 'text/markdown;charset=utf-8' }),
    exportFileName(undefined, safeTitle(item), 'md'),
  );
  return Promise.resolve();
}

/** The download options for an item, in menu order. Never empty. */
export function itemDownloads(item: Item, doc: CanvasDocument): ItemDownload[] {
  const out: ItemDownload[] = [];
  if (item.type === 'image') {
    out.push({ id: 'file', label: 'Image file', run: () => exportItem(item) });
  } else if (item.type === 'font') {
    const members = fontFamilyMembers(doc, item).length;
    out.push({
      id: 'file',
      label: members > 1 ? `Font family (.zip, ${members})` : 'Font file',
      run: () => downloadFont(doc, item),
    });
  } else if (planPlainEntries(item).length) {
    const ext = plainExt(item);
    out.push({
      id: 'file',
      label: ext ? `File (.${ext})` : 'File',
      run: () => downloadPlain(item),
    });
  }
  if (
    item.type !== 'text' &&
    item.type !== 'title' &&
    item.type !== 'code' &&
    itemMarkdown(item, doc) !== null
  ) {
    out.push({ id: 'markdown', label: 'Markdown (.md)', run: () => downloadMarkdown(item, doc) });
  }
  if (item.type === 'palette') {
    out.push({
      id: 'ase',
      label: 'Swatches (.ase)',
      run: () => {
        exportPaletteAse(item.colors, item.name ?? 'palette');
        return Promise.resolve();
      },
    });
  }
  if (item.type === 'qr') {
    out.push({
      id: 'svg',
      label: 'Vector (.svg)',
      run: () => Promise.resolve(downloadQrSvg(item)),
    });
    out.push({ id: 'png', label: 'Image (.png)', run: () => downloadQrPng(item, 1024) });
    return out;
  }
  out.push({ id: 'png', label: 'Image (.png)', run: () => downloadPng(item) });
  return out;
}
