import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { CaseItem, Item } from '@boardcache/schema';
import { CloseIcon, ScaleIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { UiTooltip } from '../../components/ui/Tooltip';
import { clientToCanvas, getCanvasContainer } from '../../lib/canvas/canvasDom';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { revealItemPage } from '../../lib/board/pages';
import { createCaseItem } from '../../lib/import/createItems';
import { mediaMeta } from '../../lib/mediaItems';
import {
  caseLeader,
  caseItemCount,
  formatScore,
  linkEvidence,
  type Stance,
} from '../../lib/structure/cases';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';

/**
 * Cases plugin: the UX around the core `case` item (a question whose
 * conclusions are scored by the evidence linked to them). The case itself
 * is edited in its lightbox stage; "Add to case" links items from their
 * context menu or lightbox sidebar; the Cases panel ranks every case on
 * the board. Scoring lives in lib/structure/cases.
 */

const PLUGIN_ID = 'cases';

const useCaseUi = create<{
  /** Items being linked through the Add to case dialog. */
  linking: string[] | null;
  panelOpen: boolean;
  link: (ids: string[] | null) => void;
  setPanelOpen: (open: boolean) => void;
}>((set) => ({
  linking: null,
  panelOpen: false,
  link: (linking) => set({ linking }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));

// The panel is about the open board: closing it, or opening another, closes
// the panel too (nothing of a board lingers over the library).
useDocumentStore.subscribe(
  (s) => s.doc.id,
  () => useCaseUi.getState().setPanelOpen(false),
);

const STANCE_OPTIONS = [
  { value: 'supports', label: 'For' },
  { value: 'contradicts', label: 'Against' },
];

// ── Add to case (from an item's Evidence menu / lightbox sidebar) ───────

function AddToCaseDialog() {
  const ids = useCaseUi((s) => s.linking);
  return ids && ids.length > 0 ? <AddToCaseBody key={ids.join(',')} ids={ids} /> : null;
}

function AddToCaseBody({ ids }: { ids: string[] }) {
  const close = () => useCaseUi.getState().link(null);
  const itemsById = useDocumentStore((s) => s.doc.items);
  const cases = useMemo(
    () => Object.values(itemsById).filter((it): it is CaseItem => it.type === 'case'),
    [itemsById],
  );
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '');
  const chosen = cases.find((c) => c.id === caseId) ?? cases[0];
  const [conclusionId, setConclusionId] = useState('');
  const [stance, setStance] = useState<Stance>('supports');
  const conclusion =
    chosen?.conclusions.find((c) => c.id === conclusionId) ?? chosen?.conclusions[0];
  const items = ids.map((id) => itemsById[id]).filter((it): it is Item => !!it);
  const names = items.map((it) => mediaMeta(it).title).join(', ');
  return (
    <UiDialog title="Add to case" onClose={close} className="case-link-sheet" testId="add-to-case">
      <div className="plugin-settings">
        <p className="settings-hint" data-testid="add-to-case-items">
          {names}
        </p>
        {cases.length === 0 ? (
          <p className="settings-hint">No cases on this board yet. Add one from the Add menu.</p>
        ) : (
          <>
            <label className="settings-row">
              <span>Case</span>
              <UiSelect
                value={chosen?.id ?? ''}
                ariaLabel="Case"
                testId="add-to-case-case"
                options={cases.map((c) => ({ value: c.id, label: c.name ?? c.title }))}
                onChange={(v) => {
                  setCaseId(v);
                  setConclusionId('');
                }}
              />
            </label>
            <label className="settings-row">
              <span>Conclusion</span>
              <UiSelect
                value={conclusion?.id ?? ''}
                ariaLabel="Conclusion"
                testId="add-to-case-conclusion"
                options={(chosen?.conclusions ?? []).map((c) => ({ value: c.id, label: c.label }))}
                onChange={setConclusionId}
              />
            </label>
            <label className="settings-row">
              <span>Side</span>
              <UiSelect
                value={stance}
                ariaLabel="Side"
                testId="add-to-case-stance"
                options={STANCE_OPTIONS}
                onChange={(v) => setStance(v as Stance)}
              />
            </label>
            <div className="ui-dialog-actions">
              <button
                type="button"
                className="suggest-conn-btn"
                data-testid="add-to-case-confirm"
                disabled={!chosen || !conclusion}
                onClick={() => {
                  if (chosen && conclusion) linkEvidence(chosen.id, ids, conclusion.id, stance);
                  close();
                }}
              >
                Link
              </button>
            </div>
          </>
        )}
      </div>
    </UiDialog>
  );
}

// ── the Cases panel ─────────────────────────────────────────────────────

function focusCase(item: CaseItem) {
  revealItemPage(item.id);
  useSessionStore.getState().setSelection([item.id]);
  fitViewportTo(rotatedRectAABB(item), getCanvasContainer());
}

function CasesPanel() {
  const open = useCaseUi((s) => s.panelOpen);
  const itemsById = useDocumentStore((s) => s.doc.items);
  const selection = useSessionStore((s) => s.selection);
  const ranked = useMemo(() => {
    const rows = Object.values(itemsById)
      .filter((it): it is CaseItem => it.type === 'case')
      .map((item) => ({
        item,
        leader: caseLeader(itemsById, item),
        count: caseItemCount(itemsById, item),
      }));
    rows.sort(
      (a, b) =>
        (b.leader?.net ?? 0) - (a.leader?.net ?? 0) || a.item.title.localeCompare(b.item.title),
    );
    return rows;
  }, [itemsById]);
  if (!open) return null;
  return (
    <div className="cases-panel" data-testid="cases-panel">
      <header className="cases-panel-head">
        <h3>Cases</h3>
        <button
          type="button"
          aria-label="Close cases"
          data-testid="cases-close"
          onClick={() => useCaseUi.getState().setPanelOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="cases-list">
        {ranked.length === 0 && (
          <p className="cases-empty">No cases yet. Add one from the Add menu (Structure).</p>
        )}
        {ranked.map(({ item, leader, count }) => (
          <button
            type="button"
            key={item.id}
            className={`cases-row${selection.includes(item.id) ? ' active' : ''}`}
            data-testid="cases-row"
            onClick={() => focusCase(item)}
          >
            <span className="cases-row-top">
              <span className="cases-row-name">{item.name ?? item.title}</span>
              {leader && (
                <span
                  className={`cases-row-score${leader.net > 0 ? ' pos' : leader.net < 0 ? ' neg' : ''}`}
                  data-testid="cases-row-score"
                >
                  {formatScore(leader.net)}
                </span>
              )}
            </span>
            <span className="cases-row-sub" data-testid="cases-row-leader">
              {leader ? `Leading: ${leader.conclusion.label}` : 'No conclusions'} · {count} item
              {count === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CasesCornerButton() {
  const open = useCaseUi((s) => s.panelOpen);
  const view = useSessionStore((s) => s.view);
  const hasCases = useDocumentStore((s) =>
    Object.values(s.doc.items).some((it) => it.type === 'case'),
  );
  if (view !== 'canvas' || !hasCases) return null;
  return (
    <UiTooltip label={open ? 'Hide cases' : 'Cases'}>
      <button
        type="button"
        className={`corner-toggle${open ? ' active' : ''}`}
        data-testid="cases-toggle"
        aria-pressed={open}
        aria-label="Cases"
        onClick={() => useCaseUi.getState().setPanelOpen(!open)}
      >
        <ScaleIcon />
      </button>
    </UiTooltip>
  );
}

function CaseDialogs() {
  useEffect(() => {
    const onLink = (e: Event) => {
      const detail = (e as CustomEvent<{ ids: string[] }>).detail;
      useCaseUi.getState().link(detail.ids);
    };
    window.addEventListener('boardcache:add-to-case', onLink);
    return () => window.removeEventListener('boardcache:add-to-case', onLink);
  }, []);
  return (
    <>
      <AddToCaseDialog />
      <CasesPanel />
    </>
  );
}

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 59,
    name: 'Cases',
    description:
      'Weigh evidence: rate items 1–5, link them for or against the conclusions of a case, and compare the conclusions by score.',
  },
  addMenu: [
    {
      label: 'Add Case',
      category: 'structure',
      icon: <ScaleIcon />,
      onSelect: () => {
        createCaseItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
      },
    },
  ],
  CornerButton: CasesCornerButton,
  Component: CaseDialogs,
});
