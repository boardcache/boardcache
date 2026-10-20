import { useRef, useState } from 'react';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../../lib/color/color';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from './Popover';
import { UiTooltip } from './Tooltip';

/**
 * Dependency-free color wheel: a hue ring around a saturation/value square,
 * plus a hex field. `ColorWheelPanel` is the inline widget (also embedded in
 * the gradient editor); `ColorWheelPicker` wraps it in a popover behind a
 * rainbow swatch. Emits onChange live while dragging — callers that write
 * history should coalesce between onDragStart/onDragEnd.
 */

const SIZE = 168;
const C = SIZE / 2;
const OUTER = 80;
const INNER = 62;
const MID = (OUTER + INNER) / 2;
const SQ = Math.floor(INNER * Math.SQRT2) - 8;

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function toHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/** Ref callback: the ring is static, painted the moment the canvas mounts. */
function paintRing(cv: HTMLCanvasElement | null): void {
  const ctx = cv?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, SIZE, SIZE);
  for (let deg = 0; deg < 360; deg++) {
    ctx.beginPath();
    ctx.strokeStyle = `hsl(${deg} 100% 50%)`;
    ctx.lineWidth = OUTER - INNER;
    ctx.arc(C, C, MID, ((deg - 0.8) * Math.PI) / 180, ((deg + 0.8) * Math.PI) / 180);
    ctx.stroke();
  }
}

/**
 * The inline wheel. Seeds its state from `color` at MOUNT — remount (key) to
 * reseed, e.g. when the edited gradient stop changes.
 */
export function ColorWheelPanel({
  color,
  onChange,
  onDragStart,
  onDragEnd,
  testId,
}: {
  color: string | null;
  onChange: (hex: string) => void;
  onDragStart?: (() => void) | undefined;
  onDragEnd?: (() => void) | undefined;
  testId?: string | undefined;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => {
    const rgb = color ? hexToRgb(color) : null;
    return rgb ? rgbToHsv(rgb) : { h: 210, s: 0.8, v: 0.76 };
  });
  const [hexDraft, setHexDraft] = useState(() => color ?? toHex({ h: 210, s: 0.8, v: 0.76 }));
  const dragging = useRef<'hue' | 'sv' | null>(null);

  const emit = (next: Hsv) => {
    setHsv(next);
    const hex = toHex(next);
    setHexDraft(hex);
    onChange(hex);
  };

  const pick = (clientX: number, clientY: number, el: HTMLElement, mode: 'hue' | 'sv') => {
    const rect = el.getBoundingClientRect();
    const dx = clientX - rect.left - C;
    const dy = clientY - rect.top - C;
    if (mode === 'hue') {
      const h = (Math.atan2(dy, dx) * (180 / Math.PI) + 360) % 360;
      emit({ ...hsv, h });
    } else {
      const s = Math.min(1, Math.max(0, dx / SQ + 0.5));
      const v = Math.min(1, Math.max(0, 0.5 - dy / SQ));
      emit({ ...hsv, s, v });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left - C;
    const dy = e.clientY - rect.top - C;
    const r = Math.hypot(dx, dy);
    const mode: 'hue' | 'sv' | null =
      r >= INNER - 2 && r <= OUTER + 4
        ? 'hue'
        : Math.abs(dx) <= SQ / 2 + 3 && Math.abs(dy) <= SQ / 2 + 3
          ? 'sv'
          : null;
    if (!mode) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragging.current = mode;
    onDragStart?.();
    pick(e.clientX, e.clientY, el, mode);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) pick(e.clientX, e.clientY, e.currentTarget, dragging.current);
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = null;
    onDragEnd?.();
  };

  const commitHex = () => {
    const t = hexDraft.trim().startsWith('#') ? hexDraft.trim() : `#${hexDraft.trim()}`;
    const rgb = hexToRgb(t);
    if (!rgb) {
      setHexDraft(color ?? toHex(hsv));
      return;
    }
    setHsv(rgbToHsv(rgb));
    onChange(rgbToHex(rgb));
  };

  const hueRad = (hsv.h * Math.PI) / 180;
  const hueMarker = { x: C + Math.cos(hueRad) * MID, y: C + Math.sin(hueRad) * MID };
  const svMarker = { x: C + (hsv.s - 0.5) * SQ, y: C + (0.5 - hsv.v) * SQ };
  const current = toHex(hsv);

  return (
    <>
      <div
        className="cw-wheel"
        data-testid={testId ? `${testId}-wheel` : undefined}
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas ref={paintRing} width={SIZE} height={SIZE} />
        <div
          className="cw-sv"
          style={{
            left: C - SQ / 2,
            top: C - SQ / 2,
            width: SQ,
            height: SQ,
            background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
          }}
        />
        <span className="cw-marker" style={{ left: hueMarker.x, top: hueMarker.y }} />
        <span
          className="cw-marker cw-marker-sv"
          style={{ left: svMarker.x, top: svMarker.y, background: current }}
        />
      </div>
      <div className="cw-foot">
        <span className="cw-preview" style={{ background: current }} />
        <input
          className="cw-hex"
          value={hexDraft}
          data-testid={testId ? `${testId}-hex` : undefined}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              commitHex();
            }
          }}
          spellCheck={false}
        />
      </div>
    </>
  );
}

export function ColorWheelPicker({
  value,
  onChange,
  onDragStart,
  onDragEnd,
  label,
  testId,
}: {
  /** Current hex (or null = unset; the wheel starts from a neutral blue). */
  value: string | null;
  onChange: (hex: string) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  label: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <UiPopover open={open} onOpenChange={setOpen}>
      <UiTooltip label={label}>
        <UiPopoverTrigger asChild>
          <button
            type="button"
            className="ssp-swatch cw-trigger"
            aria-label={label}
            data-testid={testId}
          >
            <span className="cw-trigger-dot" style={{ background: value ?? 'transparent' }} />
          </button>
        </UiPopoverTrigger>
      </UiTooltip>
      <UiPopoverContent className="cw-pop">
        {open && (
          <ColorWheelPanel
            color={value}
            onChange={onChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            testId={testId}
          />
        )}
      </UiPopoverContent>
    </UiPopover>
  );
}
