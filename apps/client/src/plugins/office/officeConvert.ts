import DOMPurify from 'dompurify';
/**
 * Office → self-contained HTML, fully client-side (offline, Electron-ready).
 * The HTML is dropped on the canvas as a generic htmlembed item (core), so
 * this plugin adds no item type and reuses all the existing rendering.
 *
 *   docx           → docx-preview (OOXML → HTML, images inlined as data URIs)
 *   xlsx/xls/ods/csv → SheetJS (one table per sheet)
 *
 * pptx is intentionally excluded — no pure-JS renderer reaches usable fidelity
 * (see the office-doc plan). The conversion libraries load on demand.
 */

const ext = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

const SHEET_EXT = ['xlsx', 'xls', 'ods', 'csv'];
const DOC_EXT = ['docx'];

/** Extensions we can actually convert (for the file-picker accept + errors). */
export const OFFICE_ACCEPT = [...DOC_EXT, ...SHEET_EXT].map((e) => `.${e}`).join(',');

const PAGE_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #1a1a1a;
    font-family: system-ui, "Segoe UI", Roboto, sans-serif; }
  .sheet { padding: 16px 18px; }
  .sheet h2 { font-size: 15px; margin: 0 0 8px; color: #334; }
  table { border-collapse: collapse; font-size: 12px; }
  td, th { border: 1px solid #d5d8dd; padding: 3px 7px; white-space: nowrap; }
  tr:first-child td { background: #f3f5f8; font-weight: 600; }
`;

function wrapHtml(bodyInner: string, extraCss = ''): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${PAGE_CSS}${extraCss}</style></head>` +
    `<body>${bodyInner}</body></html>`
  );
}

/**
 * Render inside a sandboxed frame (allow-scripts only): the renderer gets an
 * opaque origin with no reach into the app, and only HTML text comes back,
 * purified before it becomes an embed (styles are kept: the embed itself
 * lives in a sandboxed frame with no scripts).
 */
async function convertDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const html = await new Promise<string>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;left:-99999px;top:0;width:816px;height:10px;border:0';
    frame.src = '/docx-frame.html';
    const timer = setTimeout(
      () => finish(new Error('The document took too long to render.')),
      60_000,
    );
    const onMessage = (e: MessageEvent<{ t?: string; html?: string; message?: string }>) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.t === 'ready')
        frame.contentWindow?.postMessage({ t: 'render', docx: buffer }, '*', [buffer]);
      else if (e.data?.t === 'html') finish(null, e.data.html ?? '');
      else if (e.data?.t === 'error')
        finish(new Error(e.data.message ?? 'Could not read the document.'));
    };
    const finish = (err: Error | null, out = '') => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (err) reject(err);
      else resolve(out);
    };
    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
  return wrapHtml(
    DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      ADD_TAGS: ['style'],
    }),
  );
}

/** Parse in a worker (untrusted workbook, big parser), purify what comes back. */
async function convertSpreadsheet(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const html = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' });
    const done = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<{ html?: string; error?: string }>) => {
      done();
      if (e.data.error !== undefined) reject(new Error(e.data.error));
      else resolve(e.data.html ?? '');
    };
    worker.onerror = () => {
      done();
      reject(new Error('Could not read the spreadsheet.'));
    };
    worker.postMessage({ buffer }, [buffer]);
  });
  return wrapHtml(
    DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    }),
  );
}

/** Convert a supported office file to self-contained HTML. Throws with a
 *  user-facing message otherwise. */
export async function officeToHtml(file: File): Promise<string> {
  const e = ext(file.name);
  if (DOC_EXT.includes(e)) return convertDocx(file);
  if (SHEET_EXT.includes(e)) return convertSpreadsheet(file);
  if (e === 'doc') {
    throw new Error('Legacy .doc isn’t supported — re-save as .docx.');
  }
  if (e === 'pptx') {
    throw new Error('PowerPoint (.pptx) embedding isn’t supported yet.');
  }
  throw new Error(`Can’t embed “.${e}” files.`);
}
