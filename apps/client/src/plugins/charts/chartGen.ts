/**
 * Chart compiler: a small config → one standalone SVG string. The config is
 * embedded in the SVG as a comment so charts can be re-opened and edited —
 * the board just sees an ordinary vector image asset (nothing core knows
 * charts exist). Rendering uses Observable Plot, dynamic-imported so the
 * chunk only ever loads when the plugin is used.
 */

export type ChartType = 'line' | 'area' | 'bar' | 'scatter' | 'pie';

export interface ChartConfig {
  type: ChartType;
  title: string;
  /** First column is the X axis / category; the rest are series. */
  columns: string[];
  /** Row-major cell text (parsed as numbers where applicable). */
  rows: string[][];
}

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'bar', label: 'Bar' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'pie', label: 'Pie' },
];

/** Theme-neutral series palette (legible on light and dark boards). */
const CHART_PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2'];

const MARKER = 'boardcache:chart ';
const W = 640;
const H = 400;
const AXIS = '#8a8f98';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface LongRow {
  x: string | number;
  y: number;
  s: string;
}

/** Wide table → long rows; X stays numeric only if every X parses. */
function toLong(config: ChartConfig): LongRow[] {
  const xNumeric = config.rows.every(
    (r) => r[0] !== undefined && r[0].trim() !== '' && !Number.isNaN(Number(r[0])),
  );
  const out: LongRow[] = [];
  for (const row of config.rows) {
    const rawX = (row[0] ?? '').trim();
    if (!rawX) continue;
    const x = xNumeric ? Number(rawX) : rawX;
    for (let c = 1; c < config.columns.length; c++) {
      const v = Number((row[c] ?? '').trim());
      if (Number.isNaN(v)) continue;
      out.push({ x, y: v, s: config.columns[c] || `Series ${c}` });
    }
  }
  return out;
}

/** Hand-rolled pie (Plot deliberately has none): first series only + legend. */
function pieSvg(config: ChartConfig): string {
  const slices = config.rows
    .map((r) => ({ label: (r[0] ?? '').trim(), value: Number((r[1] ?? '').trim()) }))
    .filter((s) => s.label && !Number.isNaN(s.value) && s.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const cx = 200;
  const cy = H / 2;
  const r = 150;
  let angle = -Math.PI / 2;
  const paths = slices.map((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const color = CHART_PALETTE[i % CHART_PALETTE.length]!;
    // Full-circle single slice: two arcs.
    if (slices.length === 1) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    return `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"/>`;
  });
  const legend = slices.map((s, i) => {
    const y = 60 + i * 26;
    const pct = Math.round((s.value / total) * 100);
    return (
      `<rect x="400" y="${y - 11}" width="14" height="14" rx="3" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}"/>` +
      `<text x="422" y="${y}" font-size="14" fill="${AXIS}">${esc(s.label)} · ${pct}%</text>`
    );
  });
  const title = config.title
    ? `<text x="${W / 2}" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="${AXIS}">${esc(config.title)}</text>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">` +
    `${title}${paths.join('')}${legend.join('')}</svg>`
  );
}

/** Render the config to a live SVG element (caller owns it). */
export async function renderChartSvg(config: ChartConfig): Promise<string> {
  if (config.type === 'pie') return injectConfig(pieSvg(config), config);

  const Plot = await import('@observablehq/plot');
  const data = toLong(config);
  const series = config.columns.slice(1).filter(Boolean);
  const common = { x: 'x' as const, y: 'y' as const };
  const marks =
    config.type === 'line'
      ? [
          Plot.line(data, { ...common, stroke: 's', strokeWidth: 2 }),
          Plot.dot(data, { ...common, fill: 's', r: 2.5 }),
        ]
      : config.type === 'area'
        ? [
            Plot.areaY(data, { ...common, fill: 's', fillOpacity: 0.35 }),
            Plot.line(data, { ...common, stroke: 's', strokeWidth: 2 }),
          ]
        : config.type === 'bar'
          ? [Plot.barY(data, { ...common, fill: 's' })]
          : [Plot.dot(data, { ...common, fill: 's', r: 4 })];

  // Pin BOTH domains to input order: Plot's alphabetical defaults would
  // zigzag string X categories and desync series colors from our legend.
  const xNumeric = data.every((d) => typeof d.x === 'number');
  const xDomain = xNumeric ? undefined : [...new Set(data.map((d) => d.x))];
  const fig = Plot.plot({
    width: W,
    height: H,
    marginLeft: 56,
    style: { background: 'transparent', color: AXIS, fontSize: '13px' },
    color: { domain: series, range: CHART_PALETTE },
    y: { grid: true, label: null },
    x: { label: config.columns[0] || null, ...(xDomain ? { domain: xDomain } : {}) },
    marks,
  });
  const svg = fig instanceof SVGSVGElement ? fig : fig.querySelector('svg');
  if (!svg) throw new Error('Chart rendering produced no SVG.');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('font-family', 'system-ui, sans-serif');

  // Legend (Plot renders legends as HTML, which can't live in a standalone
  // SVG) + optional title: wrap in an outer SVG with headroom.
  const headroom = (config.title ? 30 : 0) + (series.length > 1 ? 26 : 0);
  const inner = new XMLSerializer().serializeToString(svg);
  let head = '';
  let y = 22;
  if (config.title) {
    head += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="17" font-weight="600" fill="${AXIS}">${esc(config.title)}</text>`;
    y += 30;
  }
  if (series.length > 1) {
    let lx = 8;
    series.forEach((name, i) => {
      head += `<rect x="${lx}" y="${y - 11}" width="12" height="12" rx="3" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}"/>`;
      head += `<text x="${lx + 17}" y="${y}" font-size="13" fill="${AXIS}">${esc(name)}</text>`;
      lx += 17 + name.length * 7.5 + 18;
    });
  }
  const total = H + headroom;
  const out =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${total}" viewBox="0 0 ${W} ${total}" font-family="system-ui, sans-serif">` +
    `${head}<g transform="translate(0, ${headroom})">${inner}</g></svg>`;
  return injectConfig(headroom > 0 ? out : inner, config);
}

function injectConfig(svg: string, config: ChartConfig): string {
  const comment = `<!--${MARKER}${JSON.stringify(config).replace(/--/g, '\\u002d\\u002d')}-->`;
  return svg.replace(/^(<svg[^>]*>)/, `$1${comment}`);
}

/** Read an embedded chart config back out of an SVG source, if present. */
export function parseChartConfig(svgSource: string): ChartConfig | null {
  const m = new RegExp(`<!--${MARKER}(.*?)-->`, 's').exec(svgSource);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!) as ChartConfig;
    if (!parsed.type || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}
