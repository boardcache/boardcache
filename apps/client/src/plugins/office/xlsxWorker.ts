/**
 * Spreadsheet parsing off the main thread: a workbook someone else made is
 * untrusted input to a large parser, so it runs here, isolated from the
 * app's DOM and keys, and hands back only HTML text (which the office embed
 * then shows inside a sandboxed frame).
 */
self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(e.data.buffer, { type: 'array' });
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = wb.SheetNames.map((name) => {
      const html = XLSX.utils.sheet_to_html(wb.Sheets[name]!, { editable: false });
      // sheet_to_html returns a full doc; keep just the <table>.
      const table = /<table[\s\S]*<\/table>/i.exec(html)?.[0] ?? '';
      const heading = wb.SheetNames.length > 1 ? `<h2>${escape(name)}</h2>` : '';
      return `<section class="sheet">${heading}${table}</section>`;
    });
    self.postMessage({ html: sections.join('') });
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : 'Could not read the spreadsheet.',
    });
  }
};
