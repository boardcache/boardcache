/**
 * Frame side of the DOCX renderer (see docx-frame.html). Runs with an opaque
 * origin: nothing here can reach the app, and the app reads back only text.
 *
 * Protocol (parent ↔ frame, postMessage):
 *   frame → parent  { t: 'ready' }
 *   parent → frame  { t: 'render', docx: ArrayBuffer }
 *   frame → parent  { t: 'html', html: string } | { t: 'error', message: string }
 */
window.addEventListener('message', (e: MessageEvent<{ t?: string; docx?: ArrayBuffer }>) => {
  if (e.source !== window.parent || e.data?.t !== 'render' || !(e.data.docx instanceof ArrayBuffer))
    return;
  void (async () => {
    try {
      const { renderAsync } = await import('docx-preview');
      const host = document.createElement('div');
      host.style.cssText = 'width:816px';
      document.body.replaceChildren(host);
      await renderAsync(e.data.docx, host, undefined, {
        inWrapper: true,
        useBase64URL: true, // inline images so the HTML is self-contained
        ignoreLastRenderedPageBreak: true,
        breakPages: true,
      });
      window.parent.postMessage({ t: 'html', html: host.innerHTML }, '*');
    } catch (err) {
      window.parent.postMessage(
        {
          t: 'error',
          message: err instanceof Error ? err.message : 'Could not read the document.',
        },
        '*',
      );
    } finally {
      document.body.replaceChildren();
    }
  })();
});
window.parent.postMessage({ t: 'ready' }, '*');
