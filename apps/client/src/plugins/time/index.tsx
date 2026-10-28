import './style.css';
import { useState } from 'react';
import { create } from 'zustand';
import type { TimeItem } from '@boardcache/schema';
import { z } from 'zod';
import { ClockIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createTimeItem } from '../../lib/import/createItems';
import { allTimezones } from '../../lib/structure/timeMath';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';

/**
 * Time plugin: the UX for the core `time` item type — a config dialog for
 * clocks (digital/analog, any IANA timezone), countdowns, stopwatches and
 * pomodoro timers. All running state lives on the item as absolute
 * timestamps, so widgets keep "running" across reloads and sync.
 */

type Mode = TimeItem['mode'];

interface TimeConfig {
  name: string;
  mode: Mode;
  face: TimeItem['face'];
  timezone: string | null;
  showSeconds: boolean;
  hour12: boolean | null;
  /** datetime-local string ('' = unset). */
  target: string;
  workMin: number;
  breakMin: number;
}

const DEFAULTS: TimeConfig = {
  name: '',
  mode: 'clock',
  face: 'digital',
  timezone: null,
  showSeconds: true,
  hour12: null,
  target: '',
  workMin: 25,
  breakMin: 5,
};

const MODES: { id: Mode; label: string }[] = [
  { id: 'clock', label: 'Clock' },
  { id: 'countdown', label: 'Countdown' },
  { id: 'stopwatch', label: 'Stopwatch' },
  { id: 'pomodoro', label: 'Pomodoro' },
];

/** ISO → value usable in <input type="datetime-local"> (local wall time). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function configFromItem(item: TimeItem): TimeConfig {
  return {
    name: item.name ?? '',
    mode: item.mode,
    face: item.face,
    timezone: item.timezone,
    showSeconds: item.showSeconds,
    hour12: item.hour12,
    target: isoToLocalInput(item.targetAt),
    workMin: item.workMin,
    breakMin: item.breakMin,
  };
}

interface TimeDialogState {
  open: { editItemId: string | null; initial: TimeConfig } | null;
  openNew: () => void;
  openEdit: (item: TimeItem) => void;
  close: () => void;
}

const useTimeDialog = create<TimeDialogState>((set) => ({
  open: null,
  openNew: () => set({ open: { editItemId: null, initial: { ...DEFAULTS } } }),
  openEdit: (item) => set({ open: { editItemId: item.id, initial: configFromItem(item) } }),
  close: () => set({ open: null }),
}));

function TimeDialog() {
  const open = useTimeDialog((s) => s.open);
  return open ? <TimeDialogBody key={open.editItemId ?? 'new'} /> : null;
}

function TimezonePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (tz: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const zones = allTimezones();
  const q = query.trim().toLowerCase().replace(/\s+/g, '_');
  const hits = q ? zones.filter((z) => z.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <div className="time-tz">
      <input
        value={query}
        placeholder={value ? value.replace(/_/g, ' ') : 'Local time — search to pick a zone'}
        data-testid="time-tz-search"
        onChange={(e) => setQuery(e.target.value)}
      />
      {value && !query && (
        <button
          type="button"
          className="time-tz-clear"
          title="Use local time"
          data-testid="time-tz-clear"
          onClick={() => onChange(null)}
        >
          ×
        </button>
      )}
      {hits.length > 0 && (
        <div className="time-tz-hits" data-testid="time-tz-hits">
          {hits.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => {
                onChange(z);
                setQuery('');
              }}
            >
              {z.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeDialogBody() {
  const { editItemId, initial } = useTimeDialog.getState().open!;
  const close = () => useTimeDialog.getState().close();
  const [cfg, setCfg] = useState<TimeConfig>(initial);
  const set = (patch: Partial<TimeConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const apply = () => {
    const targetAt = cfg.target ? new Date(cfg.target).toISOString() : null;
    const name = cfg.name.trim() || undefined;
    if (editItemId) {
      updateItems([editItemId], 'Edit time widget', (d) => {
        if (d.type !== 'time') return;
        const modeChanged = d.mode !== cfg.mode;
        d.mode = cfg.mode;
        d.face = cfg.face;
        d.timezone = cfg.timezone;
        d.showSeconds = cfg.showSeconds;
        d.hour12 = cfg.hour12;
        d.targetAt = targetAt;
        d.workMin = Math.max(1, cfg.workMin);
        d.breakMin = Math.max(1, cfg.breakMin);
        if (name) d.name = name;
        else delete d.name;
        if (modeChanged) {
          // Fresh transient state for the new mode.
          d.startedAt = null;
          d.accumulatedMs = 0;
          d.phase = 'work';
          d.phaseEndAt = null;
          d.phaseRemainingMs = null;
          d.cyclesDone = 0;
        }
      });
    } else {
      createTimeItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2), {
        ...(name ? { name } : {}),
        mode: cfg.mode,
        face: cfg.face,
        timezone: cfg.timezone,
        showSeconds: cfg.showSeconds,
        hour12: cfg.hour12,
        targetAt,
        workMin: Math.max(1, cfg.workMin),
        breakMin: Math.max(1, cfg.breakMin),
      });
    }
    close();
  };

  return (
    <UiDialog
      title={editItemId ? 'Edit Time Widget' : 'Add Time Widget'}
      onClose={close}
      className="time-sheet"
      testId="time-dialog"
    >
      <div className="time-form">
        <div className="seg seg-fill" role="group" aria-label="Widget type">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={cfg.mode === m.id ? 'active' : ''}
              aria-pressed={cfg.mode === m.id}
              data-testid={`time-mode-${m.id}`}
              onClick={() => set({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>

        <input
          className="time-name"
          value={cfg.name}
          placeholder="Label (optional)"
          data-testid="time-name"
          onChange={(e) => set({ name: e.target.value })}
        />

        {cfg.mode === 'clock' && (
          <>
            <div className="time-row">
              <span>Face</span>
              <div className="seg seg-fill" role="group" aria-label="Clock face">
                <button
                  type="button"
                  className={cfg.face === 'digital' ? 'active' : ''}
                  data-testid="time-face-digital"
                  onClick={() => set({ face: 'digital' })}
                >
                  Digital
                </button>
                <button
                  type="button"
                  className={cfg.face === 'analog' ? 'active' : ''}
                  data-testid="time-face-analog"
                  onClick={() => set({ face: 'analog' })}
                >
                  Analog
                </button>
              </div>
            </div>
            <div className="time-row">
              <span>Timezone</span>
              <TimezonePicker value={cfg.timezone} onChange={(tz) => set({ timezone: tz })} />
            </div>
            <div className="time-row">
              <span>Format</span>
              <UiSelect
                ariaLabel="Hour format"
                value={cfg.hour12 === null ? 'auto' : cfg.hour12 ? '12' : '24'}
                onChange={(v) => set({ hour12: v === 'auto' ? null : v === '12' })}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: '12', label: '12-hour' },
                  { value: '24', label: '24-hour' },
                ]}
              />
            </div>
            <label className="time-check">
              <input
                type="checkbox"
                checked={cfg.showSeconds}
                onChange={(e) => set({ showSeconds: e.target.checked })}
              />
              Show seconds
            </label>
          </>
        )}

        {cfg.mode === 'countdown' && (
          <div className="time-row">
            <span>Counts down to</span>
            <input
              type="datetime-local"
              value={cfg.target}
              data-testid="time-target"
              onChange={(e) => set({ target: e.target.value })}
            />
          </div>
        )}

        {cfg.mode === 'pomodoro' && (
          <div className="time-row time-minutes">
            <label>
              Focus
              <input
                type="number"
                min={1}
                max={180}
                value={cfg.workMin}
                data-testid="time-work-min"
                onChange={(e) => set({ workMin: Number(e.target.value) })}
              />
              min
            </label>
            <label>
              Break
              <input
                type="number"
                min={1}
                max={60}
                value={cfg.breakMin}
                data-testid="time-break-min"
                onChange={(e) => set({ breakMin: Number(e.target.value) })}
              />
              min
            </label>
          </div>
        )}

        {cfg.mode === 'stopwatch' && (
          <p className="time-hint">Start, pause and reset directly on the widget.</p>
        )}

        <div className="time-actions">
          <button type="button" className="sync-primary" data-testid="time-apply" onClick={apply}>
            {editItemId ? 'Save' : 'Add to Board'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

/** The selected item, when it's a single time widget. */
function selectedTime(): TimeItem | null {
  const selection = useSessionStore.getState().selection;
  if (selection.length !== 1) return null;
  const item = useDocumentStore.getState().doc.items[selection[0]!];
  return item?.type === 'time' ? item : null;
}

const timeToolSchema = z.object({
  mode: z.enum(['clock', 'countdown', 'stopwatch', 'pomodoro']),
  label: z.string().optional(),
  face: z.enum(['digital', 'analog']).optional().describe('Clock face (clock mode only)'),
  timezone: z.string().optional().describe("IANA zone like 'Asia/Tokyo'; omit for local time"),
  targetAt: z.string().optional().describe('Countdown deadline, ISO 8601'),
  workMin: z.number().optional().describe('Pomodoro focus minutes (default 25)'),
  breakMin: z.number().optional().describe('Pomodoro break minutes (default 5)'),
  x: z.number().optional(),
  y: z.number().optional(),
});

registerPlugin({
  manifest: {
    id: 'time',
    order: 55,
    name: 'Time',
    description:
      'Live clocks in any timezone (digital or analog), countdowns, stopwatches and pomodoro timers.',
  },
  addMenu: [
    {
      label: 'Add Time Widget',
      category: 'misc',
      icon: <ClockIcon />,
      onSelect: () => {
        const hit = selectedTime();
        if (hit) useTimeDialog.getState().openEdit(hit);
        else useTimeDialog.getState().openNew();
      },
    },
  ],
  Component: TimeDialog,
  itemMenu: (item) =>
    item.type === 'time'
      ? [
          {
            kind: 'action',
            label: 'Edit Time Widget',
            icon: <ClockIcon />,
            onSelect: () => useTimeDialog.getState().openEdit(item),
          },
        ]
      : [],
  tools: [
    {
      name: 'add_time_widget',
      description:
        'Add a live time widget to the board: a clock in any IANA timezone (digital or analog face), a countdown to a date, a stopwatch, or a pomodoro timer.',
      parameters: timeToolSchema,
      access: 'write',
      execute: (args, ctx) => {
        const center = ctx.viewCenter();
        const at = { x: args.x ?? center.x, y: args.y ?? center.y };
        const id = createTimeItem(at, {
          mode: args.mode,
          ...(args.label ? { name: args.label } : {}),
          ...(args.face ? { face: args.face } : {}),
          timezone: args.timezone ?? null,
          targetAt: args.targetAt ?? null,
          ...(args.workMin ? { workMin: args.workMin } : {}),
          ...(args.breakMin ? { breakMin: args.breakMin } : {}),
        });
        return { id };
      },
    },
  ],
});
