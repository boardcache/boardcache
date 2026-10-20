import { extractPageRects } from '../../lib/integrations/supernote';
import type { FlatPage } from './noteRenderer';

/**
 * Vector PDF export for .note pages: every ink run becomes a filled PDF
 * rectangle (lossless against the raster, crisp at any zoom, and far
 * smaller than embedding page images). Rects are grouped by gray level so
 * each page emits at most four fill-color changes.
 */

/** 1404px-wide pages print at A5-ish size: 72dpi PDF points at scale 1/4. */
const SCALE = 0.25;

export async function buildNotePdf(
  flatten: (index: number) => Promise<FlatPage>,
  pageIndexes: number[],
  name: string,
): Promise<File> {
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const index of pageIndexes) {
    const { gray, width, height } = await flatten(index);
    const w = width * SCALE;
    const h = height * SCALE;
    if (!pdf) {
      pdf = new jsPDF({
        unit: 'pt',
        format: [w, h],
        orientation: w > h ? 'landscape' : 'portrait',
        compress: true,
      });
    } else {
      pdf.addPage([w, h], w > h ? 'landscape' : 'portrait');
    }
    const rects = extractPageRects(gray, width, height);
    rects.sort((a, b) => a.gray - b.gray);
    let currentGray = -1;
    for (const r of rects) {
      if (r.gray !== currentGray) {
        currentGray = r.gray;
        pdf.setFillColor(r.gray, r.gray, r.gray);
      }
      pdf.rect(r.x * SCALE, r.y * SCALE, r.w * SCALE, r.h * SCALE, 'F');
    }
  }
  if (!pdf) throw new Error('No pages selected.');
  const blob = pdf.output('blob');
  return new File([blob], `${name}.pdf`, { type: 'application/pdf' });
}
