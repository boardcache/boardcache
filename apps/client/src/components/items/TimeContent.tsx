import { useEffect, useState } from 'react';
import { PauseIcon, PlayIcon } from '../icons';
import type { TimeItem } from '@boardcache/schema';
import {
  clockParts,
  countdownRemainingMs,
  formatDuration,
  pomodoroState,
  splitDuration,
  stopwatchElapsedMs,
} from '../../lib/structure/timeMath';
import { runSilent, updateItems } from '../../state/commands';

/**
 * Live time widget. All "running" state is absolute timestamps on the item
 * (see lib/timeMath) — this component only ticks a local clock and renders;
 * the sole doc write from rendering is the idempotent pomodoro phase
 * rollover (silent: no undo entry, syncs to team rooms).
 */

const TICK_MS = 250;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** SVG analog face — hands driven by the zone-adjusted time. */
function AnalogFace({
  h,
  m,
  s,
  showSeconds,
}: {
  h: number;
  m: number;
  s: number;
  showSeconds: boolean;
}) {
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;
  return (
    <svg viewBox="0 0 100 100" className="time-analog" aria-hidden>
      <circle cx="50" cy="50" r="47" className="time-analog-face" />
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1="7"
          x2="50"
          y2={i % 3 === 0 ? 14 : 11}
          className="time-analog-tick"
          transform={`rotate(${i * 30} 50 50)`}
        />
      ))}
      <line
        x1="50"
        y1="52"
        x2="50"
        y2="27"
        className="time-analog-hour"
        transform={`rotate(${hourDeg} 50 50)`}
      />
      <line
        x1="50"
        y1="54"
        x2="50"
        y2="16"
        className="time-analog-min"
        transform={`rotate(${minDeg} 50 50)`}
      />
      {showSeconds && (
        <line
          x1="50"
          y1="56"
          x2="50"
          y2="12"
          className="time-analog-sec"
          transform={`rotate(${secDeg} 50 50)`}
        />
      )}
      <circle cx="50" cy="50" r="2.4" className="time-analog-pin" />
    </svg>
  );
}

function Controls({ item }: { item: TimeItem }) {
  const btn = (label: React.ReactNode, title: string, onClick: () => void, testId: string) => (
    <button
      type="button"
      className="time-btn"
      title={title}
      data-testid={testId}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
  const now = () => new Date().toISOString();

  if (item.mode === 'stopwatch') {
    const running = Boolean(item.startedAt);
    return (
      <div className="time-controls">
        {running
          ? btn(
              <PauseIcon size={13} />,
              'Pause',
              () => {
                updateItems([item.id], 'Pause stopwatch', (d) => {
                  if (d.type !== 'time' || !d.startedAt) return;
                  d.accumulatedMs += Math.max(0, Date.now() - Date.parse(d.startedAt));
                  d.startedAt = null;
                });
              },
              'time-pause',
            )
          : btn(
              <PlayIcon size={13} />,
              'Start',
              () => {
                updateItems([item.id], 'Start stopwatch', (d) => {
                  if (d.type !== 'time') return;
                  d.startedAt = now();
                });
              },
              'time-start',
            )}
        {btn(
          '↺',
          'Reset',
          () => {
            updateItems([item.id], 'Reset stopwatch', (d) => {
              if (d.type !== 'time') return;
              d.startedAt = null;
              d.accumulatedMs = 0;
            });
          },
          'time-reset',
        )}
      </div>
    );
  }
  if (item.mode === 'pomodoro') {
    const running = Boolean(item.phaseEndAt);
    return (
      <div className="time-controls">
        {running
          ? btn(
              <PauseIcon size={13} />,
              'Pause',
              () => {
                updateItems([item.id], 'Pause pomodoro', (d) => {
                  if (d.type !== 'time' || !d.phaseEndAt) return;
                  d.phaseRemainingMs = Math.max(0, Date.parse(d.phaseEndAt) - Date.now());
                  d.phaseEndAt = null;
                });
              },
              'time-pause',
            )
          : btn(
              <PlayIcon size={13} />,
              'Start',
              () => {
                updateItems([item.id], 'Start pomodoro', (d) => {
                  if (d.type !== 'time') return;
                  const remaining =
                    d.phaseRemainingMs ?? (d.phase === 'work' ? d.workMin : d.breakMin) * 60_000;
                  d.phaseEndAt = new Date(Date.now() + remaining).toISOString();
                  d.phaseRemainingMs = null;
                });
              },
              'time-start',
            )}
        {btn(
          '⏭',
          'Skip phase',
          () => {
            updateItems([item.id], 'Skip pomodoro phase', (d) => {
              if (d.type !== 'time') return;
              if (d.phase === 'work') d.cyclesDone += 1;
              d.phase = d.phase === 'work' ? 'break' : 'work';
              const len = (d.phase === 'work' ? d.workMin : d.breakMin) * 60_000;
              if (d.phaseEndAt) d.phaseEndAt = new Date(Date.now() + len).toISOString();
              else d.phaseRemainingMs = len;
            });
          },
          'time-skip',
        )}
        {btn(
          '↺',
          'Reset',
          () => {
            updateItems([item.id], 'Reset pomodoro', (d) => {
              if (d.type !== 'time') return;
              d.phase = 'work';
              d.phaseEndAt = null;
              d.phaseRemainingMs = null;
              d.cyclesDone = 0;
            });
          },
          'time-reset',
        )}
      </div>
    );
  }
  return null;
}

export function TimeContent({ item, preview = false }: { item: TimeItem; preview?: boolean }) {
  const now = useNow();
  // Pomodoro catch-up: when a stored deadline passed while nobody watched,
  // advance the phases (idempotent — bails if another client already did).
  const st = item.mode === 'pomodoro' ? pomodoroState(item, now) : null;
  const rolloverEnd = st?.rollover?.phaseEndAt ?? null;
  useEffect(() => {
    if (!rolloverEnd || !st?.rollover) return;
    const roll = st.rollover;
    runSilent((draft) => {
      const d = draft.items[item.id];
      if (!d || d.type !== 'time' || !d.phaseEndAt) return;
      if (Date.parse(d.phaseEndAt) > Date.now()) return; // already advanced
      d.phase = roll.phase;
      d.phaseEndAt = roll.phaseEndAt;
      d.cyclesDone = roll.cyclesDone;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolloverEnd, item.id]);

  // Long readouts ("12d 19:38:40") shrink to keep card padding intact —
  // --time-chars feeds the CSS font-size fit (see .time-digits).
  const digits = (text: string, extra = '', testId: string | null = 'time-digits') => (
    <div
      className={`time-digits${extra}`}
      {...(testId ? { 'data-testid': testId } : {})}
      style={{ ['--time-chars' as string]: String(Math.max(5, text.length)) }}
    >
      {text}
    </div>
  );

  let body: React.ReactNode = null;
  let sub: string | null = null;
  let stateClass = '';

  if (item.mode === 'clock') {
    const parts = clockParts(item, now);
    sub = item.timezone
      ? `${item.timezone.split('/').pop()!.replace(/_/g, ' ')} · ${parts.zone}`
      : parts.zone;
    body =
      item.face === 'analog' ? (
        <AnalogFace
          h={parts.hours}
          m={parts.minutes}
          s={parts.seconds}
          showSeconds={item.showSeconds}
        />
      ) : (
        digits(parts.text)
      );
  } else if (item.mode === 'countdown') {
    const ms = countdownRemainingMs(item, now);
    if (ms === null) {
      body = digits('--:--', ' time-unset', null);
      sub = 'No target set';
    } else {
      const d = splitDuration(ms);
      if (d.negative) stateClass = ' time-done';
      body = digits(formatDuration(d, { showSeconds: item.showSeconds }));
      sub = d.negative
        ? 'Done'
        : new Date(item.targetAt!).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
    }
  } else if (item.mode === 'stopwatch') {
    const d = splitDuration(stopwatchElapsedMs(item, now));
    body = digits(formatDuration(d));
    sub = item.startedAt ? 'Running' : 'Paused';
  } else if (st) {
    const d = splitDuration(Math.max(0, st.remainingMs));
    stateClass = st.phase === 'break' ? ' time-break' : '';
    body = digits(formatDuration(d));
    sub = `${st.phase === 'work' ? 'Focus' : 'Break'}${st.cyclesDone ? ` · ${st.cyclesDone} done` : ''}${st.running ? '' : ' · paused'}`;
  }

  return (
    <div className={`time-item time-${item.mode}${stateClass}`} data-testid="time-item">
      {item.name && <div className="time-label">{item.name}</div>}
      {body}
      {sub && <div className="time-sub">{sub}</div>}
      {!preview && (item.mode === 'stopwatch' || item.mode === 'pomodoro') && (
        <Controls item={item} />
      )}
    </div>
  );
}
