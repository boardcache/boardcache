import type { CanvasDocument, Item } from '@boardcache/schema';
import { downloadBlob } from './download';
import { showNotice } from '../notices';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Bibliography export (research arc 5/10): every sourced item on the board
 * becomes a citation line. Formal `item.source` (clipper provenance) is the
 * primary record; a bare linkUrl still earns a minimal entry so hand-pasted
 * references aren't silently dropped.
 */

interface CitationEntry {
  title: string;
  url: string;
  site: string | null;
  author: string | null;
  captured: string | null;
  quote: string | null;
}

const hostnameOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

function citationOf(item: Item): CitationEntry | null {
  if (item.source) {
    const s = item.source;
    return {
      title: s.title ?? item.name ?? s.url,
      url: s.url,
      site: s.siteName ?? hostnameOf(s.url),
      author: s.author ?? null,
      captured: s.capturedAt ?? null,
      quote: s.quote ?? null,
    };
  }
  // Link items and user-attached URLs: minimal entry.
  const url = item.type === 'link' ? item.url : item.linkUrl;
  if (!url) return null;
  const label = item.type === 'link' ? item.label : item.name;
  return {
    title: label?.trim() || url,
    url,
    site: hostnameOf(url),
    author: null,
    captured: item.createdAt ?? null,
    quote: null,
  };
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

/** All citations on a board, deduplicated by URL, alphabetical by title. */
export function boardCitations(doc: CanvasDocument): CitationEntry[] {
  const byUrl = new Map<string, CitationEntry>();
  for (const item of Object.values(doc.items)) {
    const c = citationOf(item);
    if (!c) continue;
    const existing = byUrl.get(c.url);
    // A formal source (author/quote/site detail) beats a bare-link entry.
    if (!existing || (!existing.quote && !existing.author && (c.quote || c.author))) {
      byUrl.set(c.url, c);
    }
  }
  return [...byUrl.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function bibliographyMarkdown(doc: CanvasDocument): string {
  const entries = boardCitations(doc);
  const lines = [`# ${doc.name} — Bibliography`, ''];
  for (const c of entries) {
    let line = `- **${c.title}**`;
    if (c.author) line += ` — ${c.author}`;
    if (c.site && c.site !== c.title) line += `. *${c.site}*`;
    line += `. <${c.url}>`;
    if (c.captured) line += `. Captured ${fmtDate(c.captured)}`;
    line += '.';
    lines.push(line);
    if (c.quote) lines.push(`  > ${c.quote.replace(/\n+/g, ' ').slice(0, 500)}`);
  }
  lines.push('', `${entries.length} source${entries.length === 1 ? '' : 's'}.`);
  return lines.join('\n');
}

const safeFilename = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'board';

/** File → Export → Bibliography: download the board's sources as Markdown. */
/**
 * Is this a research board — does it carry what the Dossier writes up?
 * Sources, evidence statuses or connections between items. A plain
 * moodboard has none, and the dossier adds nothing over the Asset PDF there.
 */
export function hasResearchContent(doc: CanvasDocument): boolean {
  if (Object.keys(doc.connections).length > 0) return true;
  return Object.values(doc.items).some((i) => i.source !== undefined || i.status !== undefined);
}

export function exportBibliography(): void {
  const doc = useDocumentStore.getState().doc;
  if (boardCitations(doc).length === 0) {
    showNotice(
      'No sourced items on this board yet — clip pages with the browser extension or attach URLs to items.',
      { id: 'bibliography-empty', kind: 'info' },
    );
    return;
  }
  const md = bibliographyMarkdown(doc);
  downloadBlob(
    new Blob([md], { type: 'text/markdown' }),
    `${safeFilename(doc.name)}-bibliography.md`,
  );
}
