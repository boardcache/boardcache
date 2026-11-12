/**
 * A picture of a converted document's first screen, for the item's poster:
 * the library card, the zoomed-out sprite, PDF export and the gallery all
 * paint it instead of a generic card. The HTML renders in a hidden
 * same-origin frame (no scripts: the markup was sanitised, and the frame
 * allows none) and html2canvas rasterises the top of it. Anything that goes
 * wrong, or takes too long, yields no poster: the item still works and
 * paints its fallback card.
 */
export async function renderOfficePoster(
  html: string,
  width: number,
  height: number,
): Promise<Blob | undefined> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-${width + 40}px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden;pointer-events:none`;
  document.body.appendChild(frame);
  try {
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
    });
    // The poster is drawn, never fetched from: no remote image loads.
    const csp =
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:; frame-src about: blob:; child-src about: blob:">';
    frame.srcdoc = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (m) => `${m}${csp}`)
      : `${csp}${html}`;
    await Promise.race([loaded, wait(4000)]);
    // Fonts and images inside the document settle after load.
    await wait(150);
    const body = frame.contentDocument?.body;
    if (!body) return undefined;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await Promise.race([
      html2canvas(body, {
        backgroundColor: '#ffffff',
        scale: 1,
        logging: false,
        width,
        height,
        windowWidth: width,
        windowHeight: height,
      }),
      wait(8000).then(() => null),
    ]);
    if (!canvas) return undefined;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
    return blob ?? undefined;
  } catch (err) {
    console.warn('boardCache: office poster failed', err);
    return undefined;
  } finally {
    frame.remove();
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
