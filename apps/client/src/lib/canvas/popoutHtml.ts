/**
 * Pop-out building blocks shared by the item types' `popout` painters:
 * HTML escaping, shapes as SVG, and what the window hands each painter.
 */
import type { CanvasDocument, ShapeItem } from '@boardcache/schema';
import {
  arrowHead,
  bezierPathD,
  diagonalEndpoints,
  diamondPoints,
  freehandPath,
  pointsToString,
  polygonPoints,
  starPoints,
} from './shapeGeometry';

export interface PopoutContext {
  win: Window;
  doc: CanvasDocument;
  /** A blob URL minted by the pop-out window itself, so it outlives the opener. */
  mintUrl: (blob: Blob) => string;
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]!);
}

export function shapeToSvg(item: ShapeItem): string {
  const w = item.width;
  const h = item.height;
  const sw = item.strokeWidth;
  const inset = sw / 2 + 1;
  const stroke = item.stroke ?? '#888';
  const g = item.fillGradient;
  let gradDef = '';
  if (g) {
    const stops = g.stops
      .map((st) => `<stop offset="${st.offset}" stop-color="${escapeHtml(st.color)}"/>`)
      .join('');
    if (g.type === 'radial') {
      gradDef = `<defs><radialGradient id="pgrad" cx="0.5" cy="0.5" r="0.7">${stops}</radialGradient></defs>`;
    } else {
      const rad = (g.angle * Math.PI) / 180;
      gradDef = `<defs><linearGradient id="pgrad" x1="${0.5 - Math.cos(rad) / 2}" y1="${0.5 - Math.sin(rad) / 2}" x2="${0.5 + Math.cos(rad) / 2}" y2="${0.5 + Math.sin(rad) / 2}">${stops}</linearGradient></defs>`;
    }
  }
  const fill = g ? 'url(#pgrad)' : (item.fill ?? 'none');
  const dash = item.dashed ? `stroke-dasharray="${sw * 2.5} ${sw * 2}"` : '';
  const common = `stroke="${escapeHtml(stroke)}" stroke-width="${sw}" fill="${g ? fill : escapeHtml(fill)}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" ${dash}`;
  let inner = gradDef;
  switch (item.shape) {
    case 'rect':
      inner += `<rect x="${inset}" y="${inset}" width="${Math.max(0, w - inset * 2)}" height="${Math.max(0, h - inset * 2)}" rx="${item.cornerRadius}" ${common}/>`;
      break;
    case 'ellipse':
      inner += `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - inset)}" ry="${Math.max(0, h / 2 - inset)}" ${common}/>`;
      break;
    case 'diamond':
      inner += `<polygon points="${pointsToString(diamondPoints(w, h, inset))}" ${common}/>`;
      break;
    case 'star':
      inner += `<polygon points="${pointsToString(starPoints(w / 2, h / 2, w / 2 - inset, h / 2 - inset, item.sides, item.innerRadiusRatio))}" ${common}/>`;
      break;
    case 'polygon':
      inner += `<polygon points="${pointsToString(polygonPoints(w / 2, h / 2, w / 2 - inset, h / 2 - inset, item.sides))}" ${common}/>`;
      break;
    case 'draw':
      inner += `<path d="${freehandPath(item.points ?? [], w, h, inset)}" ${common} fill="none"/>`;
      break;
    case 'path':
      inner += `<path d="${bezierPathD(item.pathNodes ?? [], w, h, inset, item.pathClosed)}" ${common} fill="${item.pathClosed ? fill : 'none'}"/>`;
      break;
    case 'line':
    case 'arrow': {
      const { a, b } = diagonalEndpoints(w, h, inset, item.flipDiagonal);
      const len = Math.min(22, Math.max(9, sw * 3.5), Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
      inner += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${common} fill="none"/>`;
      if (item.shape === 'arrow') {
        const [b1, b2] = arrowHead(a, b, len);
        inner += `<polyline points="${pointsToString([b1, b, b2])}" ${common} fill="none"/>`;
      }
      break;
    }
  }
  return `<svg viewBox="0 0 ${Math.max(1, w)} ${Math.max(1, h)}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100vh;overflow:visible">${inner}</svg>`;
}
