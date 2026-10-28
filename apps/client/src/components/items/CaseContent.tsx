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
import { WEIGHT_LEVELS, weightLabel } from '../../lib/text/evidenceWeight';
import { updateItems } from '../../state/commands';
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
    <span className="case-stage-weight unrated" title="Unrated: counts for nothing yet">
      –
    </span>
  );
}

/** Strength choices: unrated, then 1–5 by name. The strength belongs to the
 *  item (every case it sits in reads it), so the stage sets it on the item. */
const STRENGTH_OPTIONS = [
  { value: '0', label: 'Unrated' },
  ...WEIGHT_LEVELS.map((w) => ({ value: String(w.value), label: `${w.value} · ${w.name}` })),
];

/** The dataTransfer type a dragged evidence slot carries (never text/plain:
 *  the canvas turns dropped plain text into a new item). */
const EVIDENCE_DRAG = 'application/x-boardcache-evidence';

/** Keys the lightbox must not see from a field (arrows browse, Escape closes). */
const keepKeys = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape') return;
  e.stopPropagation();
};

/**
 * Text that edits in place: shown as wrapping text, and a tap (or click)
 * turns it into a text area that grows with its lines. Blur or Enter
 * commits, Escape puts the old text back. The test id stays on whichever
 * element is showing.
 */
function InlineField({
  value,
  placeholder,
  ariaLabel,
  testId,
  className,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  testId: string;
  className: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };
  if (!editing) {
    return (
      <div
        className={`${className} case-stage-text${value ? '' : ' is-empty'}`}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {value || placeholder}
      </div>
    );
  }
  return (
    <textarea
      className={`${className} case-stage-text-input`}
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid={testId}
      rows={1}
      autoFocus
      ref={(el) => {
        grow(el);
        el?.select();
      }}
      onInput={(e) => grow(e.currentTarget)}
      onBlur={(e) => {
        onCommit(e.target.value);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.value = value;
          e.currentTarget.blur();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
          return;
        }
        keepKeys(e);
      }}
    />
  );
}

/**
 * Lightbox stage: the case at full size, and its editor. Title and question
 * edit in place; each conclusion is a section with its score, an editable
 * label, the linked items as raster thumbs (each with a For/Against toggle,
 * unlink), and a picker to link more items.
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
      <InlineField
        className="case-stage-title"
        value={item.title}
        ariaLabel="Case title"
        testId="case-stage-title"
        onCommit={(v) =>
          setField('Rename case', (c) => {
            c.title = v.trim() || 'Case';
          })
        }
      />
      <InlineField
        className="case-stage-question"
        value={item.question}
        placeholder="What question do the conclusions answer?"
        ariaLabel="Question"
        testId="case-stage-question"
        onCommit={(v) =>
          setField('Edit question', (c) => {
            c.question = v.trim();
          })
        }
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
              <InlineField
                className="case-stage-label"
                value={row.conclusion.label}
                ariaLabel="Conclusion"
                testId="case-stage-label"
                onCommit={(v) =>
                  setField('Rename conclusion', (c) => {
                    const x = c.conclusions.find((y) => y.id === row.conclusion.id);
                    if (x) x.label = v.trim() || x.label;
                  })
                }
              />
              <span
                className={`case-stage-score${scoreClass(row.net)}`}
                data-testid="case-stage-score"
              >
                {formatScore(row.net)}
              </span>
              <span className="case-stage-breakdown" data-testid="case-stage-breakdown">
                {formatScore(row.supports, false)} for · {formatScore(row.contradicts, false)}{' '}
                against
                {row.unrated > 0 && (
                  <span title="An item with no strength counts for nothing: set one on its row">
                    {` · ${row.unrated} unrated`}
                  </span>
                )}
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
                  <UiSelect
                    value={String(it.weight ?? 0)}
                    ariaLabel="Strength: how far a case may lean on this item"
                    testId="case-stage-strength"
                    options={STRENGTH_OPTIONS}
                    onChange={(v) =>
                      updateItems(
                        [it.id],
                        Number(v) ? 'Set evidence strength' : 'Clear evidence strength',
                        (d) => {
                          if (Number(v)) d.weight = Number(v);
                          else delete d.weight;
                        },
                      )
                    }
                  />
                  <div className="seg case-stage-side" role="radiogroup" aria-label="Side">
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
