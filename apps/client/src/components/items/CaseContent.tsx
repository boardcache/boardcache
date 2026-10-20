import { useMemo, useState } from 'react';
import type { CaseItem, Item } from '@boardcache/schema';
import { PencilIcon } from '../icons';
import { editItem } from '../../lib/itemEditors';
import { mediaMeta } from '../../lib/mediaItems';
import {
  CASE_CARD_W,
  addConclusion,
  canBeEvidence,
  caseItemCount,
  conclusionScores,
  formatScore,
  linkEvidence,
  moveEvidence,
  removeConclusion,
  unlinkEvidence,
  updateCase,
  type ConclusionScore,
  type Stance,
} from '../../lib/structure/cases';
import { weightLabel } from '../../lib/text/evidenceWeight';
import { useDocumentStore } from '../../state/documentStore';
import { UiSelect } from '../ui/Select';
import { StageThumb } from './TimelineContent';
import { ScaledCard } from './ScaledCard';

/**
 * The case card is a scoreboard: the question, then every conclusion ranked
 * by its score with a for/against bar. Evidence stays where it is on the
 * canvas; the lightbox stage (below) is where the case is read AND edited.
 */

function ScoreBar({ row, largest }: { row: ConclusionScore; largest: number }) {
  return (
    <span className="case-bar" aria-hidden>
      <span className="case-bar-for" style={{ width: `${(row.supports / largest) * 100}%` }} />
      <span
        className="case-bar-against"
        style={{ width: `${(row.contradicts / largest) * 100}%` }}
      />
    </span>
  );
}

const scoreClass = (n: number) => (n > 0 ? ' pos' : n < 0 ? ' neg' : '');

export function CaseContent({ item }: { item: CaseItem }) {
  // Selecting the map and scoring in a memo: a selector returning a fresh
  // object every call would re-render without end.
  const itemsById = useDocumentStore((s) => s.doc.items);
  const rows = useMemo(() => conclusionScores(itemsById, item), [itemsById, item]);
  const linked = useMemo(() => caseItemCount(itemsById, item), [itemsById, item]);
  const largest = Math.max(1, ...rows.map((r) => r.supports + r.contradicts));
  const unrated = rows.reduce((n, r) => n + r.unrated, 0);

  // Uniform-zoom chassis like the task list and project cards: a corner
  // drag scales everything, an edge drag reflows the content into the box.
  return (
    <ScaledCard item={item} baseW={CASE_CARD_W}>
      <div className="case-card" data-testid="case-card">
        <div className="case-header">
          <span className="case-titles">
            <span className="case-title">{item.title}</span>
            {item.question && (
              <span className="case-question" data-testid="case-question">
                {item.question}
              </span>
            )}
          </span>
          <button
            type="button"
            className="case-edit"
            data-testid="case-edit"
            aria-label="Edit case"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              editItem(item);
            }}
          >
            <PencilIcon size={14} />
          </button>
        </div>
        <ol className="case-conclusions">
          {rows.length === 0 && <li className="case-empty">No conclusions yet</li>}
          {rows.map((row, i) => (
            <li
              key={row.conclusion.id}
              className={`case-conclusion${i === 0 && row.net > 0 ? ' leading' : ''}`}
              data-testid="case-conclusion"
            >
              <span className="case-conclusion-top">
                <span className="case-conclusion-label">{row.conclusion.label}</span>
                <span
                  className={`case-conclusion-score${scoreClass(row.net)}`}
                  data-testid="case-conclusion-score"
                >
                  {formatScore(row.net)}
                </span>
              </span>
              <ScoreBar row={row} largest={largest} />
            </li>
          ))}
        </ol>
        <div className="case-footer" data-testid="case-footer">
          {linked} item{linked === 1 ? '' : 's'} of evidence
          {unrated > 0 && `, ${unrated} unrated`}
        </div>
      </div>
    </ScaledCard>
  );
}

/** A linked item's strength, as the stage shows it beside each thumb. */
function WeightPill({ item }: { item: Item }) {
  return item.weight ? (
    <span className="case-stage-weight" title={weightLabel(item.weight)}>
      {item.weight}
    </span>
  ) : (
    <span className="case-stage-weight unrated" title="Unrated: counts for nothing">
      –
    </span>
  );
}

/** The dataTransfer type a dragged evidence slot carries (never text/plain:
 *  the canvas turns dropped plain text into a new item). */
const EVIDENCE_DRAG = 'application/x-boardcache-evidence';

/** Relevance steps; an in-between stored value (from the assistant) is listed too. */
const RELEVANCE_STEPS = [100, 75, 50, 25, 10];
function relevanceOptions(relevance: number) {
  const current = Math.round(relevance * 100);
  const steps = RELEVANCE_STEPS.includes(current)
    ? RELEVANCE_STEPS
    : [...RELEVANCE_STEPS, current].sort((a, b) => b - a);
  return steps.map((n) => ({ value: String(n), label: `${n}%` }));
}

/** Keys the lightbox must not see from a field (arrows browse, Escape closes). */
const keepKeys = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape') return;
  e.stopPropagation();
};

/**
 * Lightbox stage: the case at full size, and its editor. Title and question
 * edit in place; each conclusion is a section with its score, an editable
 * label, the linked items as raster thumbs (each with a For/Against toggle,
 * a relevance dropdown and unlink), and a picker to link more items.
 * Dragging a thumb onto another conclusion moves its link there; the picker
 * is how one item bears on several conclusions.
 */
export function CaseStage({ item }: { item: CaseItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const rows = useMemo(() => conclusionScores(itemsById, item), [itemsById, item]);
  const candidates = useMemo(
    () =>
      Object.values(itemsById)
        .filter((it) => canBeEvidence(it) && !it.hidden)
        .map((it) => ({ value: it.id, label: mediaMeta(it).title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [itemsById],
  );
  const [over, setOver] = useState<string | null>(null);
  const [newConclusion, setNewConclusion] = useState('');
  const largest = Math.max(1, ...rows.map((r) => r.supports + r.contradicts));

  const setField = (label: string, recipe: (c: CaseItem) => void) =>
    updateCase(item.id, label, recipe);

  return (
    <div className="case-stage" data-testid="case-stage" onClick={(e) => e.stopPropagation()}>
      <input
        className="case-stage-title"
        defaultValue={item.title}
        aria-label="Case title"
        data-testid="case-stage-title"
        onBlur={(e) =>
          setField('Rename case', (c) => {
            c.title = e.target.value.trim() || 'Case';
          })
        }
        onKeyDown={keepKeys}
      />
      <input
        className="case-stage-question"
        defaultValue={item.question}
        placeholder="What question do the conclusions answer?"
        aria-label="Question"
        data-testid="case-stage-question"
        onBlur={(e) =>
          setField('Edit question', (c) => {
            c.question = e.target.value.trim();
          })
        }
        onKeyDown={keepKeys}
      />
      {rows.map((row) => {
        const links = item.evidence
          .filter((e) => e.conclusionId === row.conclusion.id)
          .map((e) => ({ ev: e, it: itemsById[e.itemId] }))
          .filter((x): x is { ev: (typeof item.evidence)[number]; it: Item } => !!x.it);
        const linkedIds = new Set(links.map((l) => l.it.id));
        const free = candidates.filter((c) => !linkedIds.has(c.value));
        const patch = (
          itemId: string,
          label: string,
          fn: (e: (typeof item.evidence)[number]) => void,
        ) =>
          setField(label, (c) => {
            const e = c.evidence.find(
              (x) => x.itemId === itemId && x.conclusionId === row.conclusion.id,
            );
            if (e) fn(e);
          });
        return (
          <section
            key={row.conclusion.id}
            className={`case-stage-conclusion${over === row.conclusion.id ? ' drop-over' : ''}`}
            data-testid="case-stage-conclusion"
            onDragOver={(e) => {
              // The payload rides in the dataTransfer under our own type, so
              // the drop target needs no shared state with the dragged slot.
              if (!e.dataTransfer.types.includes(EVIDENCE_DRAG)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(row.conclusion.id);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setOver((o) => (o === row.conclusion.id ? null : o));
            }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(EVIDENCE_DRAG);
              if (!raw) return;
              e.preventDefault();
              setOver(null);
              const d = JSON.parse(raw) as { itemId: string; from: string };
              moveEvidence(item.id, d.itemId, d.from, row.conclusion.id);
            }}
          >
            <header className="case-stage-head">
              <input
                className="case-stage-label"
                defaultValue={row.conclusion.label}
                aria-label="Conclusion"
                data-testid="case-stage-label"
                onBlur={(e) =>
                  setField('Rename conclusion', (c) => {
                    const x = c.conclusions.find((y) => y.id === row.conclusion.id);
                    if (x) x.label = e.target.value.trim() || x.label;
                  })
                }
                onKeyDown={keepKeys}
              />
              <span
                className={`case-stage-score${scoreClass(row.net)}`}
                data-testid="case-stage-score"
              >
                {formatScore(row.net)}
              </span>
              <span className="case-stage-breakdown">
                {formatScore(row.supports, false)} for · {formatScore(row.contradicts, false)}{' '}
                against
                {row.unrated > 0 && ` · ${row.unrated} unrated`}
              </span>
              <button
                type="button"
                className="case-stage-remove"
                aria-label="Remove conclusion"
                title="Remove conclusion"
                data-testid="case-stage-remove-conclusion"
                disabled={item.conclusions.length <= 1}
                onClick={() => removeConclusion(item.id, row.conclusion.id)}
              >
                ×
              </button>
            </header>
            <ScoreBar row={row} largest={largest} />
            <div className="case-stage-shelf">
              {links.length === 0 && <span className="case-stage-empty">No evidence linked</span>}
              {links.map(({ ev, it }) => (
                <div
                  key={it.id}
                  className={`case-stage-slot case-${ev.stance}`}
                  draggable
                  data-testid="case-stage-slot"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      EVIDENCE_DRAG,
                      JSON.stringify({ itemId: it.id, from: row.conclusion.id }),
                    );
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setOver(null)}
                >
                  <span className="case-stage-thumb">
                    <StageThumb item={it} returnTo={item.id} />
                    <WeightPill item={it} />
                  </span>
                  <div
                    className="plan-interval case-stage-side"
                    role="radiogroup"
                    aria-label="Side"
                  >
                    {(
                      [
                        ['supports', 'For'],
                        ['contradicts', 'Against'],
                      ] as [Stance, string][]
                    ).map(([stance, label]) => (
                      <button
                        key={stance}
                        type="button"
                        role="radio"
                        aria-checked={ev.stance === stance}
                        className={ev.stance === stance ? 'active' : ''}
                        data-testid={`case-stage-side-${stance}`}
                        onClick={() =>
                          patch(it.id, 'Change evidence side', (e) => {
                            e.stance = stance;
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <UiSelect
                    value={String(Math.round(ev.relevance * 100))}
                    ariaLabel="Relevance: how much of its strength applies here"
                    testId="case-stage-relevance"
                    options={relevanceOptions(ev.relevance)}
                    onChange={(v) =>
                      patch(it.id, 'Set evidence relevance', (x) => {
                        x.relevance = Number(v) / 100;
                      })
                    }
                  />
                  <button
                    type="button"
                    className="case-stage-unlink"
                    aria-label="Unlink"
                    title="Unlink from this conclusion"
                    data-testid="case-stage-unlink"
                    onClick={() => unlinkEvidence(item.id, [it.id], row.conclusion.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {free.length > 0 && (
              <div className="case-stage-link">
                <UiSelect
                  value=""
                  placeholder="Link an item"
                  ariaLabel="Link an item"
                  testId="case-stage-link"
                  options={free}
                  onChange={(v) => {
                    if (v) linkEvidence(item.id, [v], row.conclusion.id, 'supports');
                  }}
                />
              </div>
            )}
          </section>
        );
      })}
      <form
        className="case-stage-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newConclusion.trim()) return;
          addConclusion(item.id, newConclusion);
          setNewConclusion('');
        }}
      >
        <input
          value={newConclusion}
          placeholder="New conclusion"
          aria-label="New conclusion"
          data-testid="case-stage-new-conclusion"
          onChange={(e) => setNewConclusion(e.target.value)}
          onKeyDown={keepKeys}
        />
        <button
          type="submit"
          data-testid="case-stage-add-conclusion"
          disabled={!newConclusion.trim()}
        >
          Add conclusion
        </button>
      </form>
    </div>
  );
}
