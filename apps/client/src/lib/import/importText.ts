import { unzipSync, strFromU8 } from 'fflate';
import { createTextBox } from './createItems';
import type { Point } from '../canvas/coords';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * "Import text from a file": extract readable text from a document and drop
 * it into a markdown text box. Everything runs client-side:
 *   txt/md      — as-is
 *   pdf         — pdf.js text content, page by page
 *   docx        — unzip (fflate) + walk word/document.xml → headings, lists,
 *                 bold/italic become markdown
 *   html        — a small DOM walk → markdown-ish
 *   rtf         — best-effort control-word stripping
 * Legacy binary .doc is NOT supported (no reasonable client-side parser) —
 * users get told to re-save as .docx.
 */

const MAX_CHARS = 200_000;
/** Imported boxes: document-ish column, capped height (they scroll). */
const BOX_WIDTH = 460;
const BOX_MAX_HEIGHT = 1200;

// --- docx ---------------------------------------------------------------------

function docxToMarkdown(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = [...doc.getElementsByTagName('w:p')];
  const lines = paragraphs.map((p) => {
    const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '';
    const isList = p.getElementsByTagName('w:numPr').length > 0;
    let text = '';
    for (const run of [...p.getElementsByTagName('w:r')]) {
      let t = [...run.getElementsByTagName('w:t')].map((n) => n.textContent ?? '').join('');
      if (!t) continue;
      const rPr = run.getElementsByTagName('w:rPr')[0];
      const bold = rPr && rPr.getElementsByTagName('w:b').length > 0;
      const italic = rPr && rPr.getElementsByTagName('w:i').length > 0;
      if (bold && italic) t = `***${t}***`;
      else if (bold) t = `**${t}**`;
      else if (italic) t = `*${t}*`;
      text += t;
    }
    const heading = /^Heading\s*(\d)/i.exec(style);
    if (heading && text) return `${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}`;
    if (isList && text) return `- ${text}`;
    return text;
  });
  // Blank paragraphs become paragraph breaks; collapse runs of them.
  return lines
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(file: File): Promise<string> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const entry = files['word/document.xml'];
  if (!entry) throw new Error('This .docx has no readable document body.');
  return docxToMarkdown(strFromU8(entry));
}

// --- pdf ----------------------------------------------------------------------

async function extractPdf(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const { loadPdf } = await import('../media/pdfDoc');
    const { doc, destroy } = await loadPdf(url);
    try {
      let out = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        let line = '';
        for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
          line += item.str ?? '';
          if (item.hasEOL) {
            out += `${line}\n`;
            line = '';
          }
        }
        out += `${line}\n\n`;
        if (out.length > MAX_CHARS) break;
      }
      return out
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } finally {
      destroy();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- html ---------------------------------------------------------------------

function htmlToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'head') return '';
  const inner = [...el.childNodes].map(htmlToMarkdown).join('');
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return `\n\n${'#'.repeat(Number(heading[1]))} ${inner.trim()}\n\n`;
  switch (tag) {
    case 'p':
    case 'div':
    case 'section':
    case 'article':
      return `\n\n${inner.trim()}\n\n`;
    case 'br':
      return '\n';
    case 'li':
      return `\n- ${inner.trim()}`;
    case 'ul':
    case 'ol':
      return `\n${inner}\n`;
    case 'strong':
    case 'b':
      return inner.trim() ? `**${inner.trim()}**` : '';
    case 'em':
    case 'i':
      return inner.trim() ? `*${inner.trim()}*` : '';
    case 'code':
      return inner.trim() ? `\`${inner.trim()}\`` : '';
    case 'pre':
      return `\n\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`;
    case 'a': {
      const href = el.getAttribute('href');
      return href && inner.trim() ? `[${inner.trim()}](${href})` : inner;
    }
    default:
      return inner;
  }
}

function extractHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return htmlToMarkdown(doc.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- rtf ----------------------------------------------------------------------

function extractRtf(rtf: string): string {
  return rtf
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\*[^;{}]*;?/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- entry --------------------------------------------------------------------

const ext = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

/** Extract markdown-ish text from a supported document file. Throws with a
 *  user-facing message otherwise. */
async function extractTextFromFile(file: File): Promise<string> {
  const e = ext(file.name);
  if (e === 'txt' || e === 'md' || e === 'markdown') return (await file.text()).trim();
  if (e === 'pdf') return extractPdf(file);
  if (e === 'docx') return extractDocx(file);
  if (e === 'html' || e === 'htm') return extractHtml(await file.text());
  if (e === 'rtf') return extractRtf(await file.text());
  if (e === 'doc') {
    throw new Error('Legacy .doc files aren’t supported — re-save the file as .docx first.');
  }
  throw new Error(`Can’t extract text from “.${e}” files.`);
}

/** Import a document file as one markdown text box at `at`. Returns the id. */
export async function importTextFile(file: File, at: Point): Promise<string> {
  let text = await extractTextFromFile(file);
  if (!text) throw new Error('No readable text found in this file.');
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n\n*(truncated — the file has more text)*`;
  }
  const id = createTextBox(
    { x: at.x - BOX_WIDTH / 2, y: at.y - 100 },
    BOX_WIDTH,
    text,
    `Import ${file.name}`,
  );
  // Document boxes scroll: keep them a sane on-canvas size.
  const created = useDocumentStore.getState().doc.items[id];
  if (created && created.height > BOX_MAX_HEIGHT) {
    updateItems([id], 'Import text size', (d) => {
      d.height = BOX_MAX_HEIGHT;
    });
  }
  return id;
}
