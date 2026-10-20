import { activePageId, effectiveAppearance } from '../../lib/board/pages';
import { updateBoardSettings } from '../../state/commands';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../../lib/color/color';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';

/** Quick presets under the wheel: papers, neutrals, dark studio tones. */
const SWATCHES = [
  '#ffffff',
  '#fafafa',
  '#f1f0ec',
  '#fdf6e3',
  '#efe3c8',
  '#e7eef4',
  '#e8f2ea',
  '#bcbcbc',
  '#5c626b',
  '#2c2c30',
  '#1d2430',
  '#141416',
];

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(raw: string): string | null {
  const m = HEX_RE.exec(raw.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return `#${h}`;
}

const WHEEL = 216;
const R = WHEEL / 2;

/** Hue/saturation wheel at full brightness, drawn once (brightness is applied
 *  by a black overlay — HSV value is a pure multiply, so that's exact). */
function drawWheel(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(WHEEL, WHEEL);
  for (let y = 0; y < WHEEL; y++) {
    for (let x = 0; x < WHEEL; x++) {
      const dx = x - R + 0.5;
      const dy = y - R + 0.5;
      const dist = Math.hypot(dx, dy);
      const i = (y * WHEEL + x) * 4;
      if (dist > R) continue; // transparent outside
      const h = (Math.atan2(dy, dx) * 180) / Math.PI;
      const s = Math.min(1, dist / (R - 1));
      const { r, g, b } = hsvToRgb({ h, s, v: 1 });
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = dist > R - 1.5 ? Math.max(0, Math.min(1, R - dist + 0.5)) * 255 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function CanvasBgDialog() {
  const open = useSessionStore((s) => s.canvasBgOpen);
  return open ? <CanvasBgDialogBody /> : null;
}

/**
 * Centered canvas-background picker: a full hue/saturation wheel with a
 * brightness slider, quick presets, and a hex field — all LIVE-previewed on
 * the canvas behind the (undimmed) dialog. OK commits; Cancel/Escape restores.
 */
function CanvasBgDialogBody() {
  const doc0 = useDocumentStore.getState().doc;
  const pageId0 = activePageId(doc0);
  const page0 = doc0.pages.find((p) => p.id === pageId0);
  const multiPage = doc0.pages.length > 1;
  // The dialog edits the EFFECTIVE value; scope decides where it commits.
  const stored = effectiveAppearance(doc0, pageId0).background;
  const initial = stored !== 'default' ? hexToRgb(stored) : null;
  const initialHsv = initial ? rgbToHsv(initial) : { h: 40, s: 0.06, v: 0.98 };
  const [auto, setAuto] = useState(stored === 'default');
  const [hsv, setHsv] = useState(initialHsv);
  const [hexDraft, setHexDraft] = useState(stored === 'default' ? '' : stored);
  const [scope, setScope] = useState<'page' | 'board'>(
    multiPage && page0?.background !== undefined ? 'page' : 'board',
  );
  const committed = useRef(false);
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  const hex = useMemo(() => rgbToHex(hsvToRgb(hsv)), [hsv]);

  const paint = (color: string | null) => {
    const el = getCanvasContainer();
    if (el) el.style.background = color ?? '';
  };

  const close = () => useSessionStore.getState().setCanvasBgOpen(false);

  // On unmount without OK, restore whatever the document actually says.
  useEffect(() => {
    return () => {
      if (!committed.current) {
        const d = useDocumentStore.getState().doc;
        const bg = effectiveAppearance(d, activePageId(d)).background;
        paint(bg === 'default' ? null : bg);
      }
    };
  }, []);

  const applyHsv = (next: { h: number; s: number; v: number }) => {
    setAuto(false);
    setHsv(next);
    const value = rgbToHex(hsvToRgb(next));
    setHexDraft(value);
    paint(value);
  };

  const applyHex = (value: string) => {
    const rgb = hexToRgb(value);
    if (!rgb) return;
    setAuto(false);
    setHsv(rgbToHsv(rgb));
    paint(value);
  };

  const pickFromWheel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const h = (Math.atan2(dy, dx) * 180) / Math.PI;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    applyHsv({ h, s, v: hsv.v });
  };

  const commit = () => {
    committed.current = true;
    const store = useDocumentStore.getState();
    const doc = store.doc;
    const pageId = activePageId(doc);
    if (scope === 'page' && pageId) {
      // Page override ('default'/auto = inherit the board again).
      store.setPages(
        doc.pages.map((p) => {
          if (p.id !== pageId) return p;
          const { background: _drop, ...rest } = p;
          return auto ? rest : { ...rest, background: hex };
        }),
      );
    } else {
      updateBoardSettings({ background: auto ? 'default' : hex });
      // A whole-board commit also clears THIS page's override, so the chosen
      // color actually shows here (other pages keep their own looks).
      if (pageId && doc.pages.some((p) => p.id === pageId && p.background !== undefined)) {
        store.setPages(
          doc.pages.map((p) => {
            if (p.id !== pageId) return p;
            const { background: _drop, ...rest } = p;
            return rest;
          }),
        );
      }
    }
    close();
  };

  // Marker position on the wheel.
  const mx = R + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * (R - 2);
  const my = R + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * (R - 2);
  const brightRight = rgbToHex(hsvToRgb({ ...hsv, v: 1 }));

  return (
    <UiDialog
      title="Canvas background"
      onClose={close}
      className="canvas-bg-sheet"
      testId="canvas-bg-dialog"
      clearBackdrop
    >
      <div className="canvas-bg-body">
        <div className="canvas-bg-wheel-wrap">
          <canvas
            // Callback ref: draw whenever the node attaches — a mount effect
            // missed canvases that Radix Dialog re-created after first render.
            ref={(el) => {
              wheelRef.current = el;
              if (el) drawWheel(el);
            }}
            className="canvas-bg-wheel"
            width={WHEEL}
            height={WHEEL}
            data-testid="canvas-bg-wheel"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              pickFromWheel(e);
            }}
            onPointerMove={(e) => {
              if (dragging.current) pickFromWheel(e);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
          />
          {/* Brightness as an exact multiply over the v=1 wheel. */}
          <div className="canvas-bg-wheel-dim" style={{ opacity: 1 - hsv.v }} />
          {!auto && (
            <div
              className="canvas-bg-wheel-marker"
              style={{ left: mx, top: my, background: hex }}
            />
          )}
        </div>

        <label className="canvas-bg-bright">
          <span>Brightness</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={hsv.v}
            data-testid="canvas-bg-brightness"
            style={{ background: `linear-gradient(to right, #000, ${brightRight})` }}
            onChange={(e) => applyHsv({ ...hsv, v: Number(e.target.value) })}
          />
        </label>

        <div className="canvas-bg-grid">
          <button
            type="button"
            className={`canvas-bg-swatch canvas-bg-default${auto ? ' selected' : ''}`}
            title="Default (follows the theme)"
            data-testid="canvas-bg-default"
            onClick={() => {
              setAuto(true);
              setHexDraft('');
              paint(null);
            }}
            aria-label="Default (follows the theme)"
          />
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`canvas-bg-swatch${!auto && hex === color ? ' selected' : ''}`}
              style={{ background: color }}
              title={color}
              data-testid={`canvas-bg-${color.slice(1)}`}
              onPointerEnter={() => paint(color)}
              onPointerLeave={() => paint(auto ? null : hex)}
              onClick={() => {
                setHexDraft(color);
                applyHex(color);
              }}
            />
          ))}
        </div>

        <label className="canvas-bg-hex">
          <span>Hex</span>
          <input
            value={hexDraft}
            placeholder="#rrggbb"
            spellCheck={false}
            data-testid="canvas-bg-hex"
            onChange={(e) => {
              setHexDraft(e.target.value);
              const norm = normalizeHex(e.target.value);
              if (norm) applyHex(norm);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
            }}
          />
          <span
            className="canvas-bg-current"
            style={{ background: auto ? 'transparent' : hex }}
            title={auto ? 'Default' : hex}
          />
        </label>
      </div>

      {multiPage && (
        <div className="canvas-bg-scope" role="radiogroup" aria-label="Apply to">
          <span className="canvas-bg-scope-label">Apply to</span>
          <label>
            <input
              type="radio"
              name="bg-scope"
              checked={scope === 'page'}
              data-testid="canvas-bg-scope-page"
              onChange={() => setScope('page')}
            />
            This page
          </label>
          <label>
            <input
              type="radio"
              name="bg-scope"
              checked={scope === 'board'}
              data-testid="canvas-bg-scope-board"
              onChange={() => setScope('board')}
            />
            Whole board
          </label>
        </div>
      )}

      <footer className="export-actions">
        <button type="button" className="export-cancel" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="export-confirm"
          data-testid="canvas-bg-ok"
          onClick={commit}
        >
          OK
        </button>
      </footer>
    </UiDialog>
  );
}
