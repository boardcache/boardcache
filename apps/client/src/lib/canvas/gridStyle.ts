import type { BoardSettings } from '@boardcache/schema';

/**
 * Canvas grid backgrounds. Patterns are CSS gradients — resolution-
 * independent, so they stay crisp at any zoom. Spacing is FIXED in canvas
 * units (GRID_BASE at 100%) and scales with the content; line weight stays
 * 1px on screen at every zoom level.
 */

const GRID_BASE = 32;

const LINE = 'var(--grid-line)';

export interface GridCss {
  backgroundImage: string;
  backgroundSize: string;
}

export function gridCss(type: BoardSettings['gridType'], scale: number): GridCss {
  const s = GRID_BASE * scale;
  switch (type) {
    case 'dots':
      return {
        backgroundImage: `radial-gradient(circle, ${LINE} 1px, transparent 1.5px)`,
        backgroundSize: `${s}px ${s}px`,
      };
    case 'diagonal':
      return {
        backgroundImage:
          `repeating-linear-gradient(45deg, ${LINE} 0 1px, transparent 1px ${s}px), ` +
          `repeating-linear-gradient(135deg, ${LINE} 0 1px, transparent 1px ${s}px)`,
        backgroundSize: 'auto',
      };
    case 'isometric':
      return {
        backgroundImage:
          `repeating-linear-gradient(60deg, ${LINE} 0 1px, transparent 1px ${s}px), ` +
          `repeating-linear-gradient(120deg, ${LINE} 0 1px, transparent 1px ${s}px), ` +
          `repeating-linear-gradient(0deg, ${LINE} 0 1px, transparent 1px ${s}px)`,
        backgroundSize: 'auto',
      };
    case 'checker':
      return {
        backgroundImage: `conic-gradient(${LINE} 25%, transparent 0 50%, ${LINE} 0 75%, transparent 0)`,
        backgroundSize: `${s * 2}px ${s * 2}px`,
      };
    case 'square':
    default:
      return {
        backgroundImage:
          `linear-gradient(to right, ${LINE} 1px, transparent 1px), ` +
          `linear-gradient(to bottom, ${LINE} 1px, transparent 1px)`,
        backgroundSize: `${s}px ${s}px`,
      };
  }
}
