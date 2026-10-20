import { useRef, useState } from 'react';
import type { Gradient, ShapeItem } from '@boardcache/schema';
import { hexToRgb, rgbToHex } from '../../lib/color/color';
import { useShallow } from 'zustand/react/shallow';
import { ColorWheelPanel, ColorWheelPicker } from '../ui/ColorWheel';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { UiTooltip } from '../ui/Tooltip';
import { useHistoryStore } from '../../state/history';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { isDrawTool, useSessionStore } from '../../state/sessionStore';

const STROKE_SWATCHES = [
  '#1971c2',
  '#e03131',
  '#2f9e44',
  '#f08c00',
  '#ae3ec9',
  '#1e1e1e',
  '#ffffff',
];
const FILL_SWATCHES = ['#a5d8ff', '#ffc9c9', '#b2f2bb', '#ffec99', '#eebefa', '#ced4da'];

const DEFAULT_GRADIENT: Gradient = {
  type: 'linear',
  angle: 90,
  stops: [
    { offset: 0, color: '#4dabf7' },
    { offset: 1, color: '#9775fa' },
  ],
};

/** CSS preview of a gradient (chips, trigger, preview bar). */
function gradientCss(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ');
  return g.type === 'radial'
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${g.angle + 90}deg, ${stops})`;
}

/** Interpolate a color at `offset` between the two neighboring stops. */
function sampleGradient(stops: Gradient['stops'], offset: number): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const after = sorted.find((s) => s.offset >= offset);
  const before = [...sorted].reverse().find((s) => s.offset <= offset);
  if (!before) return after?.color ?? '#888888';
  if (!after || after === before) return before.color;
  const t = (offset - before.offset) / Math.max(1e-6, after.offset - before.offset);
  const a = hexToRgb(before.color);
  const b = hexToRgb(after.color);
  if (!a || !b) return before.color;
  return rgbToHex({
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  });
}

/**
 * Gradient fill editor: an interactive stop bar (click to add a stop, drag a
 * chip to reposition, the active chip is edited by the embedded color
 * wheel), linear/radial toggle and an angle slider. Lives at the end of the
 * Fill row behind a gradient swatch.
 */
function GradientButton({
  value,
  onApply,
  markHistory,
  coalesceDrag,
}: {
  value: Gradient | null;
  onApply: (g: Gradient | null) => void;
  markHistory: () => void;
  coalesceDrag: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stopIdx, setStopIdx] = useState(0);
  const g = value ?? DEFAULT_GRADIENT;

  const patch = (next: Partial<Gradient>) => onApply({ ...g, ...next });
  const setStopColor = (color: string) =>
    patch({ stops: g.stops.map((st, i) => (i === stopIdx ? { ...st, color } : st)) });

  /** Click on empty bar → new stop there, colored to blend in, selected. */
  const addStopAt = (offset: number) => {
    const stop = { offset, color: sampleGradient(g.stops, offset) };
    const stops = [...g.stops, stop].sort((a, b) => a.offset - b.offset);
    patch({ stops });
    setStopIdx(stops.indexOf(stop));
  };

  const removeActiveStop = () => {
    if (g.stops.length <= 2) return;
    patch({ stops: g.stops.filter((_, i) => i !== stopIdx) });
    setStopIdx(Math.max(0, stopIdx - 1));
  };

  const barOffset = (clientX: number, bar: HTMLElement) => {
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  };

  /** Drag a chip along the bar to move its offset (one undo per drag). */
  const startStopDrag = (e: React.PointerEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setStopIdx(index);
    const bar = (e.currentTarget as HTMLElement).parentElement!;
    let idx = index;
    let dragged = false;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragged && Math.abs(ev.clientX - e.clientX) < 3) return;
      if (!dragged) {
        dragged = true;
        markHistory();
      }
      const offset = barOffset(ev.clientX, bar);
      const moved = { ...g.stops[idx]!, offset };
      const rest = g.stops.filter((_, i) => i !== idx);
      const stops = [...rest, moved].sort((a, b) => a.offset - b.offset);
      idx = stops.indexOf(moved);
      setStopIdx(idx);
      onApply({ ...g, stops });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragged) coalesceDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <UiPopover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !value) onApply(DEFAULT_GRADIENT); // opening enables it
      }}
    >
      <UiTooltip label="Gradient fill">
        <UiPopoverTrigger asChild>
          <button
            type="button"
            className={`ssp-swatch grad-trigger${value ? ' active' : ''}`}
            aria-label="Gradient fill"
            data-testid="ssp-gradient"
            style={{ background: gradientCss(g) }}
          />
        </UiPopoverTrigger>
      </UiTooltip>
      <UiPopoverContent className="cw-pop grad-pop">
        <div
          className="grad-preview grad-bar"
          data-testid="grad-bar"
          style={{
            background: gradientCss({ ...g, type: 'linear', angle: 0 }),
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            addStopAt(barOffset(e.clientX, e.currentTarget));
          }}
        >
          {g.stops.map((st, i) => (
            <button
              key={i}
              type="button"
              className={`grad-stop${i === stopIdx ? ' active' : ''}`}
              style={{ background: st.color, left: `${st.offset * 100}%` }}
              data-testid={`grad-stop-${i}`}
              onPointerDown={(e) => startStopDrag(e, i)}
              aria-label={`Stop ${i + 1} at ${Math.round(st.offset * 100)}%`}
            />
          ))}
        </div>
        <div className="grad-row">
          <button
            type="button"
            className="grad-kind"
            data-testid="grad-remove-stop"
            disabled={g.stops.length <= 2}
            onClick={removeActiveStop}
            title="Remove the selected stop"
          >
            − Stop
          </button>
          <span className="grad-spacer" />
          <button
            type="button"
            className={`grad-kind${g.type === 'linear' ? ' active' : ''}`}
            onClick={() => patch({ type: 'linear' })}
            data-testid="grad-linear"
          >
            Linear
          </button>
          <button
            type="button"
            className={`grad-kind${g.type === 'radial' ? ' active' : ''}`}
            onClick={() => patch({ type: 'radial' })}
            data-testid="grad-radial"
          >
            Radial
          </button>
        </div>
        {g.type === 'linear' && (
          <label className="grad-angle">
            <span>Angle</span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={((g.angle % 360) + 360) % 360}
              data-testid="grad-angle"
              onChange={(e) => patch({ angle: Number(e.target.value) })}
            />
            <span className="grad-angle-val">{Math.round(((g.angle % 360) + 360) % 360)}°</span>
          </label>
        )}
        {open && (
          <ColorWheelPanel
            key={stopIdx}
            color={g.stops[stopIdx]?.color ?? null}
            onChange={setStopColor}
            onDragStart={markHistory}
            onDragEnd={coalesceDrag}
            testId="grad-wheel"
          />
        )}
        <button
          type="button"
          className="grad-remove"
          data-testid="grad-remove"
          onClick={() => {
            onApply(null);
            setOpen(false);
          }}
        >
          Remove gradient
        </button>
      </UiPopoverContent>
    </UiPopover>
  );
}

/**
 * Style controls for shapes. Visible when a shape is selected (edits it) or a
 * draw tool is active (presets the next shape). Writes flow to the selected
 * items and to the session default so the style sticks.
 */
export function ShapeStylePanel() {
  const tool = useSessionStore((s) => s.tool);
  const style = useSessionStore((s) => s.shapeStyle);
  const setShapeStyle = useSessionStore((s) => s.setShapeStyle);
  const sheetOpen = useSessionStore((s) => s.mobileStyleSheetOpen);
  // Reactive selection: an item→item switch must re-derive the panel.
  const selection = useSessionStore(useShallow((s) => s.selection));
  const selectedShapes = useDocumentStore(
    useShallow((s) =>
      selection
        .map((id) => s.doc.items[id])
        .filter((i): i is ShapeItem => i?.type === 'shape' && !i.locked),
    ),
  );
  const selectionLength = selection.length;

  // Wheel drags fire many live updates; fold each drag into ONE undo entry.
  const dragBase = useRef(-1);

  const editing = selectedShapes.length > 0 && selectedShapes.length === selectionLength;
  if (!editing && !isDrawTool(tool)) return null;

  // What the controls reflect: the (single) selected shape, else the defaults.
  const ref = editing ? selectedShapes[0]! : null;
  const stroke = ref?.stroke ?? style.stroke;
  const fill = ref ? ref.fill : style.fill;
  const fillGradient = ref ? (ref.fillGradient ?? null) : style.fillGradient;
  const strokeWidth = ref?.strokeWidth ?? style.strokeWidth;
  const dashed = ref?.dashed ?? style.dashed;

  const markHistory = () => {
    dragBase.current = useHistoryStore.getState().index;
  };
  const coalesceDrag = (label: string) => {
    if (dragBase.current >= -1) useHistoryStore.getState().coalesceSince(dragBase.current, label);
    dragBase.current = -1;
  };

  const apply = (patch: Partial<typeof style>, label: string) => {
    setShapeStyle(patch);
    if (editing) {
      const ids = selectedShapes.map((s) => s.id);
      updateItems(ids, label, (item) => {
        if (item.type !== 'shape') return;
        if (patch.stroke !== undefined) item.stroke = patch.stroke;
        if (patch.fill !== undefined) item.fill = patch.fill;
        if (patch.fillGradient !== undefined) {
          if (patch.fillGradient === null) delete item.fillGradient;
          else item.fillGradient = patch.fillGradient;
        }
        if (patch.strokeWidth !== undefined) item.strokeWidth = patch.strokeWidth;
        if (patch.dashed !== undefined) item.dashed = patch.dashed;
      });
    }
  };

  return (
    <div
      className={`shape-style-panel${sheetOpen ? ' mobile-open' : ''}`}
      data-testid="shape-style-panel"
    >
      <div className="ssp-group">
        <span className="ssp-label">Stroke</span>
        <button
          type="button"
          className={`ssp-swatch ssp-none${stroke === null ? ' active' : ''}`}
          onClick={() => apply({ stroke: null }, 'No stroke')}
          title="No stroke"
          data-testid="ssp-no-stroke"
        >
          ⊘
        </button>
        {STROKE_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`ssp-swatch${stroke === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => apply({ stroke: c }, 'Stroke color')}
            aria-label={`Stroke ${c}`}
          />
        ))}
        <ColorWheelPicker
          value={stroke}
          label="Any color"
          testId="ssp-stroke-wheel"
          onDragStart={markHistory}
          onChange={(hex) => apply({ stroke: hex }, 'Stroke color')}
          onDragEnd={() => coalesceDrag('Stroke color')}
        />
      </div>

      <div className="ssp-group">
        <span className="ssp-label">Fill</span>
        <button
          type="button"
          className={`ssp-swatch ssp-none${fill === null ? ' active' : ''}`}
          onClick={() => apply({ fill: null }, 'No fill')}
          title="No fill"
        >
          ⊘
        </button>
        {FILL_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`ssp-swatch${fill === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => apply({ fill: c }, 'Fill color')}
            aria-label={`Fill ${c}`}
          />
        ))}
        <ColorWheelPicker
          value={fill}
          label="Any color"
          testId="ssp-fill-wheel"
          onDragStart={markHistory}
          onChange={(hex) => apply({ fill: hex }, 'Fill color')}
          onDragEnd={() => coalesceDrag('Fill color')}
        />
        <GradientButton
          value={fillGradient}
          onApply={(g) => apply({ fillGradient: g }, g ? 'Fill gradient' : 'Remove gradient')}
          markHistory={markHistory}
          coalesceDrag={() => coalesceDrag('Fill gradient')}
        />
      </div>

      <div className="ssp-group">
        <span className="ssp-label">Width</span>
        <input
          type="number"
          className="ssp-number"
          min={0}
          max={100}
          step={0.5}
          value={strokeWidth}
          onChange={(e) =>
            apply(
              { strokeWidth: Math.max(0, Math.min(100, Number(e.target.value) || 0)) },
              'Stroke width',
            )
          }
          data-testid="ssp-stroke-width"
          title="Stroke width (px)"
        />
        <button
          type="button"
          className={`ssp-width${dashed ? ' active' : ''}`}
          onClick={() => apply({ dashed: !dashed }, 'Dashed')}
          title="Dashed"
        >
          ┄
        </button>
      </div>
    </div>
  );
}
