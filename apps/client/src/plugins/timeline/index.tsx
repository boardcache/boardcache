import './style.css';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { TimelineItem, TimelinePoint } from '@boardcache/schema';
import { z } from 'zod';
import { MilestoneIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createTimelineItem } from '../../lib/import/createItems';
import { makePoint, parseTimelineDate } from '../../lib/structure/timelineLayout';
import { addTimelinePoint, updateTimeline } from '../../lib/structure/timelineAttach';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Timeline plugin: the create/edit UX around the core `timeline` item type
 * (milestone axis). Points are edited in a dialog opened from the canvas
 * card (double-click a point) via the boardcache:edit-timeline-point event.
 */

const PLUGIN_ID = 'timeline';

interface EditorState {
  /** Point editor target. */
  point: { itemId: string; pointId: string } | null;
  /** Style dialog target (timeline item id). */
  styleFor: string | null;
  openPoint: (itemId: string, pointId: string) => void;
  openStyle: (itemId: string) => void;
  close: () => void;
}

const useTimelineEditor = create<EditorState>((set) => ({
  point: null,
  styleFor: null,
  openPoint: (itemId, pointId) => set({ point: { itemId, pointId }, styleFor: null }),
  openStyle: (itemId) => set({ styleFor: itemId, point: null }),
  close: () => set({ point: null, styleFor: null }),
}));

function timelineOf(id: string | null | undefined): TimelineItem | null {
  const item = id ? useDocumentStore.getState().doc.items[id] : undefined;
  return item?.type === 'timeline' ? item : null;
}

function PointDialog() {
  const target = useTimelineEditor((s) => s.point);
  return target ? <PointDialogBody key={`${target.itemId}:${target.pointId}`} /> : null;
}

function PointDialogBody() {
  const { itemId, pointId } = useTimelineEditor.getState().point!;
  const close = () => useTimelineEditor.getState().close();
  const item = timelineOf(itemId);
  const point = item?.points.find((p) => p.id === pointId);
  const [draft, setDraft] = useState<Pick<
    TimelinePoint,
    'label' | 'date' | 'description' | 'color' | 'freeArrange'
  > | null>(
    point
      ? {
          label: point.label,
          date: point.date,
          description: point.description,
          color: point.color,
          freeArrange: point.freeArrange,
        }
      : null,
  );
  if (!item || !point || !draft) return null;

  const save = () => {
    updateTimeline(itemId, 'Edit timeline point', (d) => {
      const p = d.points.find((x) => x.id === pointId);
      if (!p) return;
      p.label = draft.label.trim() || p.label;
      p.date = draft.date.trim();
      p.description = draft.description.trim();
      p.color = draft.color;
      p.freeArrange = draft.freeArrange;
      if (p.description && p.collapsed) p.collapsed = false;
    });
    close();
  };
  const removePoint = () => {
    updateTimeline(itemId, 'Remove timeline point', (d) => {
      d.points = d.points.filter((x) => x.id !== pointId);
    });
    close();
  };

  return (
    <UiDialog
      title="Edit Point"
      onClose={close}
      className="tl-sheet"
      testId="timeline-point-dialog"
    >
      <div className="tl-form">
        <input
          className="tl-form-label"
          value={draft.label}
          placeholder="Label"
          autoFocus
          data-testid="timeline-point-label"
          onChange={(e) => setDraft((d) => d && { ...d, label: e.target.value })}
        />
        <input
          value={draft.date}
          placeholder="Date or era (optional — “2019”, “Q3”, “May 4”)"
          data-testid="timeline-point-date"
          onChange={(e) => setDraft((d) => d && { ...d, date: e.target.value })}
        />
        <textarea
          value={draft.description}
          placeholder="Description (optional, collapsible on the canvas)"
          data-testid="timeline-point-desc"
          onChange={(e) => setDraft((d) => d && { ...d, description: e.target.value })}
        />
        <label className="tl-form-color">
          <input
            type="checkbox"
            checked={draft.freeArrange}
            data-testid="timeline-point-free"
            onChange={(e) => setDraft((d) => d && { ...d, freeArrange: e.target.checked })}
          />
          Free arrange — dropped items stay where you put them (no auto-stack)
        </label>
        <label className="tl-form-color">
          <input
            type="checkbox"
            checked={draft.color !== null}
            onChange={(e) =>
              setDraft((d) => d && { ...d, color: e.target.checked ? item.style.pointColor : null })
            }
          />
          Custom color
          {draft.color !== null && (
            <input
              type="color"
              value={draft.color}
              data-testid="timeline-point-color"
              onChange={(e) => setDraft((d) => d && { ...d, color: e.target.value })}
            />
          )}
        </label>
        <div className="tl-form-actions">
          <button
            type="button"
            className="tl-danger"
            data-testid="timeline-point-delete"
            onClick={removePoint}
          >
            Delete Point
          </button>
          <button
            type="button"
            className="sync-primary"
            data-testid="timeline-point-save"
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

function StyleDialog() {
  const target = useTimelineEditor((s) => s.styleFor);
  return target ? <StyleDialogBody key={target} /> : null;
}

function StyleDialogBody() {
  const itemId = useTimelineEditor.getState().styleFor!;
  const close = () => useTimelineEditor.getState().close();
  // Live-read so slider/color changes render on the canvas as you drag.
  const item = useDocumentStore((s) => {
    const it = s.doc.items[itemId];
    return it?.type === 'timeline' ? it : null;
  });
  if (!item) return null;

  const patchStyle = (patch: Partial<TimelineItem['style']>) =>
    updateTimeline(itemId, 'Timeline style', (d) => {
      Object.assign(d.style, patch);
    });
  const setScaleMode = (scaleMode: TimelineItem['scaleMode']) =>
    updateTimeline(itemId, 'Timeline spacing', (d) => {
      d.scaleMode = scaleMode;
    });
  const datesParse =
    item.points.length >= 2 && item.points.every((p) => parseTimelineDate(p.date) !== null);

  return (
    <UiDialog
      title="Timeline Style"
      onClose={close}
      className="tl-sheet"
      testId="timeline-style-dialog"
    >
      <div className="tl-form">
        <label className="tl-form-row">
          Spacing
          <span className="seg">
            <button
              type="button"
              className={item.scaleMode === 'even' ? 'active' : ''}
              data-testid="timeline-scale-even"
              onClick={() => setScaleMode('even')}
            >
              Even
            </button>
            <button
              type="button"
              className={item.scaleMode === 'date' ? 'active' : ''}
              data-testid="timeline-scale-date"
              onClick={() => setScaleMode('date')}
            >
              By date
            </button>
          </span>
        </label>
        {item.scaleMode === 'date' && !datesParse && (
          <p className="tl-form-hint">
            Date spacing needs a parseable date on every point (“2026”, “Q3 2026”, “May 4 2026”) —
            spacing stays even until then.
          </p>
        )}
        <label className="tl-form-row">
          Line color
          <input
            type="color"
            value={item.style.lineColor}
            data-testid="timeline-style-line"
            onChange={(e) => patchStyle({ lineColor: e.target.value })}
          />
        </label>
        <label className="tl-form-row">
          Line width
          <input
            type="range"
            min={1}
            max={12}
            value={item.style.lineWidth}
            onChange={(e) => patchStyle({ lineWidth: Number(e.target.value) })}
          />
        </label>
        <label className="tl-form-row">
          Point color
          <input
            type="color"
            value={item.style.pointColor}
            data-testid="timeline-style-point"
            onChange={(e) => patchStyle({ pointColor: e.target.value })}
          />
        </label>
        <label className="tl-form-row">
          Point size
          <input
            type="range"
            min={4}
            max={24}
            value={item.style.pointSize}
            onChange={(e) => patchStyle({ pointSize: Number(e.target.value) })}
          />
        </label>
        <div className="tl-form-actions">
          <button type="button" className="sync-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

function TimelineDialogs() {
  useEffect(() => {
    const onEdit = (e: Event) => {
      const { itemId, pointId } = (e as CustomEvent<{ itemId: string; pointId: string }>).detail;
      useTimelineEditor.getState().openPoint(itemId, pointId);
    };
    window.addEventListener('boardcache:edit-timeline-point', onEdit);
    return () => window.removeEventListener('boardcache:edit-timeline-point', onEdit);
  }, []);
  return (
    <>
      <PointDialog />
      <StyleDialog />
    </>
  );
}

function flipOrientation(item: TimelineItem): void {
  updateTimeline(item.id, 'Flip timeline', (d) => {
    d.orientation = d.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    const w = d.width;
    d.width = d.height;
    d.height = w;
  });
}

const timelineToolSchema = z.object({
  points: z
    .array(
      z.object({
        label: z.string(),
        date: z.string().optional().describe('Display date/era text, e.g. "2019" or "Q3"'),
        description: z.string().optional(),
      }),
    )
    .min(1)
    .describe('Milestones in axis order'),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  name: z.string().optional().describe('Timeline title (item name)'),
  x: z.number().optional(),
  y: z.number().optional(),
});

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 57,
    name: 'Timelines',
    description:
      'Milestone timelines on the canvas: labeled points with dates and collapsible descriptions, horizontal or vertical.',
  },
  addMenu: [
    {
      label: 'Add Timeline',
      category: 'structure',
      icon: <MilestoneIcon />,
      onSelect: () => {
        createTimelineItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2), {
          points: [1, 2, 3].map((n) => ({ ...makePoint(n), label: `Point ${n}` })),
        });
      },
    },
  ],
  Component: TimelineDialogs,
  itemMenu: (item) =>
    item.type === 'timeline'
      ? [
          {
            kind: 'action',
            label: 'Add Point',
            icon: <MilestoneIcon />,
            onSelect: () => {
              const id = addTimelinePoint(item.id);
              useTimelineEditor.getState().openPoint(item.id, id);
            },
          },
          {
            kind: 'action',
            label: 'Timeline Style',
            icon: <MilestoneIcon />,
            onSelect: () => useTimelineEditor.getState().openStyle(item.id),
          },
          {
            kind: 'action',
            label: item.orientation === 'horizontal' ? 'Make Vertical' : 'Make Horizontal',
            icon: <MilestoneIcon />,
            onSelect: () => flipOrientation(item),
          },
        ]
      : [],
  tools: [
    {
      name: 'create_timeline',
      description:
        'Create a timeline on the board: an axis of milestone points, each with a label and optional date and description.',
      parameters: timelineToolSchema,
      access: 'write',
      execute: (args, ctx) => {
        const center = ctx.viewCenter();
        const at = { x: args.x ?? center.x, y: args.y ?? center.y };
        const points = (
          args.points as { label: string; date?: string; description?: string }[]
        ).map((p, i) => ({
          ...makePoint(i + 1),
          label: p.label,
          date: p.date ?? '',
          description: p.description ?? '',
          collapsed: !p.description,
        }));
        const id = createTimelineItem(at, {
          points,
          orientation: (args.orientation as 'horizontal' | 'vertical') ?? 'horizontal',
          ...(args.name ? { name: args.name as string } : {}),
        });
        return { id };
      },
    },
  ],
});
