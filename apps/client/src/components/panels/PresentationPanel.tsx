import { useEffect, useMemo, useRef, useState } from 'react';
import { UiDialog } from '../ui/Dialog';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { mediaMeta, orderedItems } from '../../lib/mediaItems';
import { useShallow } from 'zustand/react/shallow';
import {
  CameraIcon,
  CloseIcon,
  GripIcon,
  ListChecksIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
} from '../icons';
import {
  addToPresentation,
  currentView,
  movePresentationStep,
  removeFromPresentation,
  setPresentationSteps,
  setStepView,
  showStep,
  startPresentation,
  stepLabel,
  stepView,
} from '../../lib/canvas/presentation';
import { selectionGroupState } from '../../lib/canvas/grouping';
import { activePageId } from '../../lib/board/pages';
import { suggestPresentationOrder } from '../../lib/ai/presentationOrder';
import { showNotice } from '../../lib/notices';
import {
  defaultModel,
  enabledModels,
  modelLabel,
  parseRefKey,
  refKey,
  useAIStore,
  type ModelRef,
} from '../../state/aiStore';
import { UiSelect } from '../ui/Select';
import { confirmDialog } from '../ui/Prompt';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';

/**
 * Presentation panel (a floating window like Layers): the ordered steps —
 * add the selection, drag to reorder, remove, play. While it is open the
 * canvas shows each step's number beside its item or group.
 */
export function PresentationPanel() {
  const open = useSessionStore((s) => s.presentPanelOpen);
  if (!open) return null;
  return <Panel />;
}

function Panel() {
  const steps = useDocumentStore(useShallow((s) => s.doc.presentation.steps.map((st) => st.id)));
  const labels = useDocumentStore(
    useShallow((s) => s.doc.presentation.steps.map((st) => stepLabel(s.doc, st.id))),
  );
  const selection = useSessionStore((s) => s.selection);
  const doc = useDocumentStore((s) => s.doc);
  const win = useFloatingWindow(440);
  const rows = useRef(new Map<string, HTMLElement | null>());
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const overRef = useRef(0);
  const [picking, setPicking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Re-render when a model comes or goes (sign-in, settings).
  useAIStore((s) => s.hosted);
  useAIStore((s) => s.providers);
  useAIStore((s) => s.defaultModel);
  const models = enabledModels();
  const itemCount = Object.keys(doc.items).length;

  const suggest = async (model: ModelRef) => {
    if (steps.length > 0) {
      const ok = await confirmDialog({
        title: 'Rebuild the order with AI?',
        body: `The assistant reads the board and proposes a new order, starting from your ${steps.length} current ${steps.length === 1 ? 'step' : 'steps'}. The result replaces them — Undo brings them back.`,
        confirmLabel: 'Rebuild',
      });
      if (!ok) return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setThinking(true);
    try {
      const ids = await suggestPresentationOrder(doc, activePageId(doc), model, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!ids) {
        showNotice('The assistant couldn\u2019t build an order from this board.', { kind: 'info' });
        return;
      }
      setPresentationSteps(ids);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      showNotice(err instanceof Error ? err.message : 'The assistant didn\u2019t answer.');
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setThinking(false);
      }
    }
  };

  // What "Add selection" would add: a fully selected group as one step.
  const addable = useMemo(() => {
    if (selection.length === 0) return [];
    const g = selectionGroupState(doc, selection);
    return g.groupId ? [g.groupId] : selection;
  }, [doc, selection]);

  const measure = (clientY: number, dragged: string) => {
    const others = steps.filter((id) => id !== dragged);
    for (let i = 0; i < others.length; i++) {
      const el = rows.current.get(others[i]!);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return others.length;
  };
  const beginDrag = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    overRef.current = measure(e.clientY, id);
    setDrag({ id, over: overRef.current });
    const onMove = (ev: PointerEvent) => {
      overRef.current = measure(ev.clientY, id);
      setDrag({ id, over: overRef.current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      movePresentationStep(id, overRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const shown = drag ? steps.filter((id) => id !== drag.id) : steps;
  const lineBefore = drag ? (shown[drag.over] ?? '__end__') : null;
  const dropLine = <div className="layers-drop-line" aria-hidden />;

  return (
    <div
      className="layers-window presentation-window"
      data-testid="presentation-panel"
      style={win.style}
    >
      <div
        className="layers-titlebar"
        data-testid="presentation-titlebar"
        onPointerDown={win.onTitlePointerDown}
      >
        <span className="layers-title">Presentation</span>
        <span className="layers-grab" aria-hidden />
        <button
          type="button"
          className="layers-close"
          data-testid="presentation-close"
          aria-label="Close presentation panel"
          onClick={() => useSessionStore.getState().setPresentPanelOpen(false)}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="layers-body">
        {steps.length === 0 && (
          <p className="layers-empty">
            No steps yet. Choose items from the list, add the canvas selection, or right-click an
            item.
          </p>
        )}
        {steps.map((id, i) =>
          drag?.id === id ? null : (
            <div key={id}>
              {lineBefore === id && dropLine}
              <div
                className="layer-row presentation-row"
                data-testid="presentation-row"
                ref={(el) => {
                  rows.current.set(id, el);
                }}
              >
                <button
                  type="button"
                  className="layer-grip"
                  data-testid="presentation-grip"
                  title="Drag to reorder"
                  onPointerDown={beginDrag(id)}
                >
                  <GripIcon size={13} />
                </button>
                <span className="present-num" aria-hidden>
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="layer-name presentation-name"
                  title="Show on the canvas"
                  onClick={() =>
                    useSessionStore.getState().setSelection(doc.groups[id] ? [] : [id])
                  }
                >
                  {labels[i]}
                </button>
                <StepViewMenu id={id} custom={stepView(doc, id) !== null} />
                <button
                  type="button"
                  className="layer-btn"
                  aria-label={`Remove step ${i + 1}`}
                  data-testid="presentation-remove"
                  onClick={() => removeFromPresentation([id])}
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            </div>
          ),
        )}
        {drag && lineBefore === '__end__' && dropLine}
      </div>
      <div className="presentation-actions">
        <button
          type="button"
          className="suggest-conn-btn"
          disabled={addable.length === 0}
          title={
            addable.length === 0
              ? 'Select items on the canvas first — or choose them from the list'
              : undefined
          }
          data-testid="presentation-add"
          onClick={() => addToPresentation(addable)}
        >
          <PlusIcon size={13} /> Add selection
        </button>
        <button
          type="button"
          className="suggest-conn-btn"
          data-testid="presentation-pick"
          onClick={() => setPicking(true)}
        >
          <ListChecksIcon size={13} /> Choose
        </button>
        <SuggestMenu
          models={models}
          disabled={thinking || itemCount === 0}
          thinking={thinking}
          title={
            models.length === 0
              ? 'Sign in for hosted AI to let the assistant order the board'
              : itemCount === 0
                ? 'Nothing on this board yet'
                : 'Let the assistant read the board and order it into a presentation'
          }
          onSuggest={(m) => void suggest(m)}
        />
        <button
          type="button"
          className="suggest-conn-btn pj-primary"
          disabled={steps.length === 0}
          data-testid="presentation-play"
          onClick={() => startPresentation(0)}
        >
          <PlayIcon size={13} /> Present
        </button>
      </div>
      {picking && <StepPicker steps={steps} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Suggest: pick the model (the settings default is preselected), then let it order the board. */
function SuggestMenu({
  models,
  disabled,
  thinking,
  title,
  onSuggest,
}: {
  models: ModelRef[];
  disabled: boolean;
  thinking: boolean;
  title: string;
  onSuggest: (model: ModelRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const fallback = defaultModel();
  const current =
    (pick && models.some((m) => refKey(m) === pick) ? pick : null) ??
    (fallback ? refKey(fallback) : '');
  const chosen = parseRefKey(current);
  return (
    <UiPopover open={open} onOpenChange={setOpen}>
      <UiPopoverTrigger asChild>
        <button
          type="button"
          className="suggest-conn-btn"
          disabled={disabled || models.length === 0}
          title={title}
          data-testid="presentation-suggest"
        >
          <SparkleIcon size={13} /> {thinking ? 'Thinking' : 'Suggest'}
        </button>
      </UiPopoverTrigger>
      <UiPopoverContent className="cw-pop presentation-suggest-pop" align="end">
        <p className="presentation-view-hint">
          The assistant reads this page — titles, notes, tags, groups and the connections between
          them — and proposes an order.
        </p>
        <div className="plugin-settings">
          <label className="settings-row">
            <span>Model</span>
            <UiSelect
              ariaLabel="Model"
              testId="presentation-suggest-model"
              value={current}
              onChange={setPick}
              options={models.map((m) => ({ value: refKey(m), label: modelLabel(m) }))}
            />
          </label>
        </div>
        <div className="pj-pop-actions">
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="presentation-suggest-go"
            disabled={!chosen}
            onClick={() => {
              if (!chosen) return;
              setOpen(false);
              onSuggest(chosen);
            }}
          >
            <SparkleIcon size={13} /> Suggest an order
          </button>
        </div>
      </UiPopoverContent>
    </UiPopover>
  );
}

/** Per-step camera: capture the canvas as you have it, show it, or go back to auto-framing. */
function StepViewMenu({ id, custom }: { id: string; custom: boolean }) {
  const [open, setOpen] = useState(false);
  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <UiPopover open={open} onOpenChange={setOpen}>
      <UiPopoverTrigger asChild>
        <button
          type="button"
          className={`layer-btn presentation-view${custom ? ' custom' : ''}`}
          aria-label={custom ? 'Custom view' : 'View'}
          title={custom ? 'Custom view' : 'Auto-framed — set a view'}
          data-testid="presentation-view"
        >
          <CameraIcon size={13} />
        </button>
      </UiPopoverTrigger>
      <UiPopoverContent className="cw-pop presentation-view-pop" align="end">
        <p className="presentation-view-hint">
          {custom
            ? 'This step plays a view you captured.'
            : 'Pan and zoom the canvas, then capture it as this step\u2019s view.'}
        </p>
        <div className="pj-pop-actions">
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="presentation-view-use"
            onClick={act(() => setStepView(id, currentView()))}
          >
            <CameraIcon size={13} /> Use current view
          </button>
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="presentation-view-show"
            onClick={act(() => showStep(id))}
          >
            <PlayIcon size={13} /> Show view
          </button>
          {custom && (
            <button
              type="button"
              className="gallery-action-btn"
              data-testid="presentation-view-reset"
              onClick={act(() => setStepView(id, null))}
            >
              <CloseIcon size={13} /> Reset to auto
            </button>
          )}
        </div>
      </UiPopoverContent>
    </UiPopover>
  );
}

/** Every item and group on the board with a checkbox: tick to add a step, untick to remove. */
function StepPicker({ steps, onClose }: { steps: string[]; onClose: () => void }) {
  const doc = useDocumentStore((s) => s.doc);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const groups = Object.values(doc.groups).map((g) => ({
      id: g.id,
      title: stepLabel(doc, g.id),
      detail: 'Group',
    }));
    const items = orderedItems(doc).map((i) => {
      const m = mediaMeta(i);
      return { id: i.id, title: m.title || i.type, detail: m.detail ?? i.type };
    });
    return [...groups, ...items];
  }, [doc]);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => `${r.title} ${r.detail}`.toLowerCase().includes(needle))
    : rows;
  return (
    <UiDialog
      title="Choose presentation steps"
      onClose={onClose}
      className="tier-sheet"
      testId="presentation-picker"
    >
      <div className="plugin-settings">
        <input
          className="tag-input pick-search"
          placeholder="Search items"
          value={q}
          autoFocus
          data-testid="presentation-picker-search"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="pick-list">
          {shown.length === 0 && <p className="layers-empty">Nothing on this board yet.</p>}
          {shown.map((r) => {
            const on = steps.includes(r.id);
            return (
              <label
                key={r.id}
                className={`pick-row${on ? ' on' : ''}`}
                data-testid="presentation-picker-row"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    e.target.checked ? addToPresentation([r.id]) : removeFromPresentation([r.id])
                  }
                />
                <span className="pick-title">{r.title}</span>
                <span className="pick-detail">{r.detail}</span>
              </label>
            );
          })}
        </div>
        <div className="pj-dialog-actions">
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
