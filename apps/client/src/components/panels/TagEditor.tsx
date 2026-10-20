import { useEffect, useState } from 'react';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { suggestTags } from '../../lib/search/similarity';
import { allTags, normalizeTag, withoutTag, withTag } from '../../lib/text/tags';
import { CloseIcon } from '../icons';

/**
 * Add / remove metadata tags on one or more items. Shows the union of the
 * selection's tags; adding or removing applies to every targeted item. Used by
 * the Tags dialog (context menu) and the lightbox detail view.
 */
export function TagEditor({
  itemIds,
  autoFocus,
  testId = 'tag-editor',
}: {
  itemIds: string[];
  autoFocus?: boolean;
  testId?: string;
}) {
  const doc = useDocumentStore((s) => s.doc);
  const [draft, setDraft] = useState('');

  const seen = new Map<string, string>();
  for (const id of itemIds) {
    for (const tag of doc.items[id]?.tags ?? []) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  const tags = [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const add = (raw: string) => {
    const t = normalizeTag(raw);
    setDraft('');
    if (!t) return;
    updateItems(itemIds, 'Add tag', (d) => {
      d.tags = withTag(d.tags ?? [], t);
    });
  };
  const remove = (tag: string) => {
    updateItems(itemIds, 'Remove tag', (d) => {
      const next = withoutTag(d.tags ?? [], tag);
      if (next.length) d.tags = next;
      else delete d.tags;
    });
  };

  const suggestions = allTags(doc).filter(
    (t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()),
  );

  // Content-based tag suggestions: existing tags whose items read similar
  // to this selection (local vectors; nothing is applied automatically).
  const [smart, setSmart] = useState<string[]>([]);
  const tagKey = tags.join('|');
  useEffect(() => {
    let live = true;
    void suggestTags(itemIds).then((r) => {
      if (live) setSmart(r);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIds.join('|'), tagKey]);
  const smartLeft = smart.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));

  return (
    <div className="tag-editor" data-testid={testId}>
      <div className="tag-chips">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag} data-testid="tag-chip">
            <span className="tag-chip-label">{tag}</span>
            <button
              type="button"
              className="tag-chip-remove"
              onClick={() => remove(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              <CloseIcon />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="tag-empty">No tags yet</span>}
      </div>
      <input
        className="tag-input"
        list={`${testId}-suggest`}
        value={draft}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        placeholder="Add a tag"
        data-testid={`${testId}-input`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return; // let the dialog / lightbox close
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            remove(tags[tags.length - 1]!);
          }
        }}
        onBlur={() => add(draft)}
      />
      {smartLeft.length > 0 && (
        <div className="tag-smart" data-testid={`${testId}-smart`}>
          <span className="tag-smart-label">Suggested:</span>
          {smartLeft.map((t) => (
            <button
              key={t}
              type="button"
              className="tag-smart-chip"
              data-testid="tag-smart-chip"
              title="Suggested from similar items' tags"
              onClick={() => add(t)}
            >
              + {t}
            </button>
          ))}
        </div>
      )}
      <datalist id={`${testId}-suggest`}>
        {suggestions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
