import { useState } from 'react';
import { TrashIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { clientToCanvas, getCanvasContainer } from '../../lib/canvas/canvasDom';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { revealItemPage } from '../../lib/board/pages';
import { createEventItem } from '../../lib/import/createItems';
import { REMIND_OPTIONS, normalizeRange } from '../../lib/structure/events';
import { ensureNotifyPermission } from '../../lib/structure/tasklist';
import { removeItems, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useEventsUi } from './store';
import type { EventForm } from './store';

/**
 * The event editor: one dialog for a new card and for an existing one.
 * Fields fold into local wall-clock strings on save; changing when the
 * event starts, or its reminder, re-arms a reminder that already fired.
 */

export function EventDialog() {
  const dialog = useEventsUi((s) => s.dialog);
  return dialog ? <EventDialogBody key={dialog.itemId ?? 'new'} /> : null;
}

const remindValue = (m: number | null) => (m === null ? 'none' : String(m));

/** The form's dates and times as item fields. */
function formToRange(form: EventForm): { start: string; end: string } {
  if (form.allDay) return normalizeRange(form.date, form.endDate || form.date, true);
  return normalizeRange(
    `${form.date}T${form.from || '09:00'}`,
    `${form.endDate || form.date}T${form.to || form.from || '10:00'}`,
    false,
  );
}

function EventDialogBody() {
  const { itemId, initial } = useEventsUi.getState().dialog!;
  const close = () => useEventsUi.getState().closeDialog();
  const [form, setForm] = useState<EventForm>(initial);
  const set = (patch: Partial<EventForm>) => setForm((f) => ({ ...f, ...patch }));
  const editing = itemId !== null;

  const apply = () => {
    const range = formToRange(form);
    const title = form.title.trim() || 'Event';
    const fields = {
      title,
      ...range,
      allDay: form.allDay,
      location: form.location.trim(),
      description: form.description.trim(),
      remindMinutes: form.remindMinutes,
    };
    if (form.remindMinutes !== null) ensureNotifyPermission();
    if (itemId) {
      updateItems([itemId], 'Edit event', (d) => {
        if (d.type !== 'event') return;
        const rearm = d.start !== fields.start || d.remindMinutes !== fields.remindMinutes;
        Object.assign(d, fields);
        if (rearm) d.notifiedAt = null;
      });
    } else {
      createEventItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2), fields);
    }
    close();
  };

  const showOnBoard = () => {
    if (!itemId) return;
    const item = useDocumentStore.getState().doc.items[itemId];
    if (!item) return;
    close();
    const session = useSessionStore.getState();
    session.setLightbox(null);
    session.setView('canvas');
    session.setSelection([itemId]);
    revealItemPage(itemId);
    // The canvas mounts on the next frame when a view was showing.
    requestAnimationFrame(() => fitViewportTo(item, getCanvasContainer()));
  };

  const remove = () => {
    if (!itemId) return;
    close();
    removeItems([itemId], 'Delete event');
  };

  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  return (
    <UiDialog
      title={editing ? 'Edit Event' : 'Add Event'}
      onClose={close}
      className="events-sheet"
      testId="event-dialog"
    >
      <div className="plugin-settings-fields events-form">
        <label className="plugin-settings-field">
          <span>Title</span>
          <input
            value={form.title}
            placeholder="What is happening"
            autoFocus
            data-testid="event-title-input"
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => {
              stop(e);
              if (e.key === 'Enter') apply();
            }}
          />
        </label>
        <div className="events-kind">
          <div className="seg" role="radiogroup" aria-label="Event kind">
            <button
              type="button"
              role="radio"
              aria-checked={!form.allDay}
              className={form.allDay ? '' : 'active'}
              data-testid="event-kind-timed"
              onClick={() => set({ allDay: false })}
            >
              Timed
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.allDay}
              className={form.allDay ? 'active' : ''}
              data-testid="event-kind-allday"
              onClick={() => set({ allDay: true })}
            >
              All day
            </button>
          </div>
        </div>
        <div className="events-grid">
          <label className="plugin-settings-field">
            <span>Date</span>
            <input
              type="date"
              value={form.date}
              data-testid="event-date"
              onChange={(e) => {
                const date = e.target.value;
                set({ date, ...(form.endDate < date ? { endDate: date } : {}) });
              }}
              onKeyDown={stop}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Ends</span>
            <input
              type="date"
              value={form.endDate}
              min={form.date}
              data-testid="event-end-date"
              onChange={(e) => set({ endDate: e.target.value })}
              onKeyDown={stop}
            />
          </label>
          {!form.allDay && (
            <>
              <label className="plugin-settings-field">
                <span>From</span>
                <input
                  type="time"
                  value={form.from}
                  data-testid="event-from"
                  onChange={(e) => set({ from: e.target.value })}
                  onKeyDown={stop}
                />
              </label>
              <label className="plugin-settings-field">
                <span>To</span>
                <input
                  type="time"
                  value={form.to}
                  data-testid="event-to"
                  onChange={(e) => set({ to: e.target.value })}
                  onKeyDown={stop}
                />
              </label>
            </>
          )}
        </div>
        <label className="plugin-settings-field">
          <span>Location</span>
          <input
            value={form.location}
            placeholder="Optional"
            data-testid="event-location-input"
            onChange={(e) => set({ location: e.target.value })}
            onKeyDown={stop}
          />
        </label>
        <div className="plugin-settings-field">
          <span>Reminder</span>
          <UiSelect
            ariaLabel="Reminder"
            testId="event-remind"
            value={remindValue(form.remindMinutes)}
            options={REMIND_OPTIONS.map((o) => ({ value: remindValue(o.value), label: o.label }))}
            onChange={(v) => set({ remindMinutes: v === 'none' ? null : Number(v) })}
          />
        </div>
        <label className="plugin-settings-field">
          <span>Notes</span>
          <textarea
            value={form.description}
            rows={3}
            data-testid="event-description"
            onChange={(e) => set({ description: e.target.value })}
            onKeyDown={stop}
          />
        </label>
        <div className="ui-prompt-actions">
          {editing && (
            <>
              <button type="button" data-testid="event-delete" onClick={remove}>
                <TrashIcon size={14} /> Delete
              </button>
              <button type="button" data-testid="event-show" onClick={showOnBoard}>
                Show on Board
              </button>
            </>
          )}
          <span className="events-spacer" />
          <button type="button" className="sync-primary" data-testid="event-apply" onClick={apply}>
            {editing ? 'Save' : 'Add to Board'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
