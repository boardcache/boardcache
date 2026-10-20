import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { withAlpha } from '../../lib/color/color';
import { useHistoryStore } from '../../state/history';
import { ColorWheelPanel } from '../ui/ColorWheel';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';

/**
 * Word-processor color wells shared by every text-bearing item's style
 * controls (text boxes, titles): a glyph over a bar of the current color,
 * opening a wheel popover with a reset. The background well also owns
 * opacity, zero meaning no card at all.
 */

/** Wheel drags fire many live updates; fold each drag into ONE undo entry. */
function useDragHistory(): { mark: () => void; coalesce: (label: string) => void } {
  const base = useRef(-1);
  const mark = () => {
    base.current = useHistoryStore.getState().index;
  };
  const coalesce = (label: string) => {
    if (base.current >= -1) useHistoryStore.getState().coalesceSince(base.current, label);
    base.current = -1;
  };
  return { mark, coalesce };
}

function Well({
  open,
  onOpenChange,
  glyph,
  bar,
  label,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  glyph: ReactNode;
  bar: ReactNode;
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <UiPopover open={open} onOpenChange={onOpenChange}>
      <UiPopoverTrigger asChild>
        <button
          type="button"
          className="tbc-color"
          title={label}
          aria-label={label}
          data-testid={testId}
        >
          <span className="tbc-color-glyph" aria-hidden>
            {glyph}
          </span>
          {bar}
        </button>
      </UiPopoverTrigger>
      <UiPopoverContent className="cw-pop tbc-pop">{open && children}</UiPopoverContent>
    </UiPopover>
  );
}

/** Text color: "A" over the current ink; the reset returns to the theme's. */
export function InkWell({
  color,
  onChange,
  onReset,
  resetLabel = 'Theme default',
  label = 'Text color',
  testId,
  historyLabel = 'Text color',
}: {
  /** The ink as shown (a theme default already resolved to a hex). */
  color: string;
  onChange: (hex: string) => void;
  onReset: () => void;
  resetLabel?: string;
  label?: string;
  /** Trigger id; the wheel is `${testId}-wheel`, the reset `${testId}-default`. */
  testId: string;
  historyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const history = useDragHistory();
  return (
    <Well
      open={open}
      onOpenChange={setOpen}
      glyph="A"
      bar={<span className="tbc-color-bar" style={{ background: color }} aria-hidden />}
      label={label}
      testId={testId}
    >
      <ColorWheelPanel
        color={color}
        onChange={onChange}
        onDragStart={history.mark}
        onDragEnd={() => history.coalesce(historyLabel)}
        testId={`${testId}-wheel`}
      />
      <button
        type="button"
        className="tbc-pop-reset"
        data-testid={`${testId}-default`}
        onClick={() => {
          onReset();
          setOpen(false);
        }}
      >
        {resetLabel}
      </button>
    </Well>
  );
}

/** Background: one control owns color AND opacity (0 = no card at all). */
export function BackgroundWell({
  hex,
  alpha,
  onChange,
  onReset,
  resetLabel,
  resetTestId,
  label = 'Background color and opacity',
  testId,
  historyLabel = 'Background',
}: {
  /** Solid color and 0–1 opacity of the card as shown. */
  hex: string;
  alpha: number;
  onChange: (hex: string, alpha: number) => void;
  onReset: () => void;
  resetLabel: string;
  resetTestId: string;
  label?: string;
  /** Trigger id; the wheel is `${testId}-wheel`, the slider `${testId}-opacity`. */
  testId: string;
  historyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const history = useDragHistory();
  const none = alpha <= 0;
  return (
    <Well
      open={open}
      onOpenChange={setOpen}
      glyph="▢"
      bar={
        <span
          className={`tbc-color-bar${none ? ' tbc-alpha-none' : ''}`}
          style={none ? {} : { background: withAlpha(hex, alpha) }}
          aria-hidden
        />
      }
      label={label}
      testId={testId}
    >
      <ColorWheelPanel
        color={hex}
        onChange={(next) => onChange(next, none ? 1 : alpha)}
        onDragStart={history.mark}
        onDragEnd={() => history.coalesce(historyLabel)}
        testId={`${testId}-wheel`}
      />
      <label className="tbc-opacity">
        <span>Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(alpha * 100)}
          aria-label="Background opacity"
          data-testid={`${testId}-opacity`}
          onPointerDown={history.mark}
          onPointerUp={() => history.coalesce(historyLabel)}
          onChange={(e) => onChange(hex, Number(e.target.value) / 100)}
        />
        <span className="tbc-opacity-value">{Math.round(alpha * 100)}%</span>
      </label>
      <button
        type="button"
        className="tbc-pop-reset"
        data-testid={resetTestId}
        onClick={() => {
          onReset();
          setOpen(false);
        }}
      >
        {resetLabel}
      </button>
    </Well>
  );
}
