import type { RmPage } from '../../lib/integrations/remarkable';

/**
 * Vector PDF from .rm pages: pen strokes are true vector polylines, so the
 * export is genuinely smooth at any zoom (unlike raster-sourced formats).
 * Segments carry per-point widths; highlighters get a transparency GState.
 */

const SCALE = 0.25;

const COLORS: Record<number, [number, number, number]> = {
  0: [0, 0, 0],
  1: [125, 125, 125],
  2: [255, 255, 255],
  3: [251, 236, 93],
  4: [46, 125, 50],
  5: [224, 74, 138],
  6: [0, 98, 204],
  7: [217, 7, 7],
  8: [191, 191, 191],
  9: [251, 236, 93],
  10: [76, 175, 80],
  11: [0, 188, 212],
  12: [192, 81, 201],
  13: [255, 213, 79],
};

const HIGHLIGHTERS = new Set([5, 18]);

export async function buildRmPdf(pages: RmPage[], name: string): Promise<File> {
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const page of pages) {
    const w = page.width * SCALE;
    const h = page.height * SCALE;
    if (!pdf) {
      pdf = new jsPDF({
        unit: 'pt',
        format: [w, h],
        orientation: w > h ? 'l' : 'p',
        compress: true,
      });
    } else {
      pdf.addPage([w, h], w > h ? 'l' : 'p');
    }
    pdf.setLineCap('round');
    pdf.setLineJoin('round');

    const centred = page.layers.some((l) => l.lines.some((ln) => ln.points.some((p) => p.x < -1)));
    const xoff = centred ? page.width / 2 : 0;

    for (const layer of page.layers) {
      if (!layer.visible) continue;
      for (const line of layer.lines) {
        if (line.tool === 8) continue; // area eraser
        const pts = line.points;
        if (pts.length < 2) continue;
        const rgb = line.colorRgba
          ? ([line.colorRgba[0], line.colorRgba[1], line.colorRgba[2]] as [number, number, number])
          : (COLORS[line.color] ?? [0, 0, 0]);
        const highlight = HIGHLIGHTERS.has(line.tool);
        pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
        try {
          // GState is present in jsPDF v4 builds; degrade to opaque if not.
          const G = (pdf as unknown as { GState?: new (o: { opacity: number }) => unknown }).GState;
          if (G) {
            (pdf as unknown as { setGState(g: unknown): void }).setGState(
              new G({ opacity: highlight ? 0.45 : 1 }),
            );
          }
        } catch {
          /* opaque fallback */
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          pdf.setLineWidth(Math.max(0.3, ((a.width + b.width) / 8) * SCALE));
          pdf.line((a.x + xoff) * SCALE, a.y * SCALE, (b.x + xoff) * SCALE, b.y * SCALE, 'S');
        }
      }
    }
  }
  if (!pdf) throw new Error('No pages selected.');
  return new File([pdf.output('blob')], `${name}.pdf`, { type: 'application/pdf' });
}
