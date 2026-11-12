import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Item } from '@boardcache/schema';
import { mediaMeta } from '../../lib/mediaItems';
import { mediaTitle } from '../../lib/text/linkTitles';
import { insertEmbed } from '../../lib/text/mdFormat';
import type { ActiveEditor } from '../../lib/text/mdEditorRegistry';
import { useDocumentStore } from '../../state/documentStore';
import { UiDialog } from '../ui/Dialog';
import { ItemThumb } from './ItemThumb';

interface EmbedPickerState {
  open: boolean;
  /** The editor the pick goes into (the one that was active at the click). */
  target: ActiveEditor | null;
  openFor: (target: ActiveEditor | null) => void;
  close: () => void;
}

/** The embed picker: opened by the toolbar's paper clip for the editor
 *  that had the focus. */
export const useEmbedPicker = create<EmbedPickerState>((set) => ({
  open: false,
  target: null,
  openFor: (target) => set({ open: true, target }),
  close: () => set({ open: false, target: null }),
}));

const isEmbeddable = (it: Item) => it.type !== 'text';

/**
 * A launcher of the board's items to embed in a note: a search field and
 * pills by kind along the top, then tiles with a picture of each item and
 * its title. Picking one writes `![[Title]]` where the caret was.
 */
export function EmbedPickerDialog() {
  const open = useEmbedPicker((s) => s.open);
  return open ? <Body /> : null;
}

function Body() {
  const close = useEmbedPicker((s) => s.close);
  const target = useEmbedPicker((s) => s.target);
  const items = useDocumentStore(
    useShallow((s) => Object.values(s.doc.items).filter(isEmbeddable)),
  );
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const kinds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items)
      seen.set(mediaMeta(it).typeLabel, (seen.get(mediaMeta(it).typeLabel) ?? 0) + 1);
    return [...seen.keys()].sort();
  }, [items]);
  const shown = items.filter(
    (it) =>
      (kind === 'all' || mediaMeta(it).typeLabel === kind) &&
      (!q || mediaTitle(it).toLowerCase().includes(q)),
  );
  const pick = (it: Item) => {
    target?.apply(insertEmbed(mediaTitle(it)));
    close();
  };
  return (
    <UiDialog
      title="Embed an item"
      size="full"
      className="add-sheet embed-picker"
      testId="embed-picker"
      onClose={close}
    >
      <div className="add-sheet-body">
        <div className="add-head">
          <input
            className="input add-search"
            placeholder="Search"
            aria-label="Search the board's items"
            autoFocus
            value={query}
            data-testid="embed-picker-search"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="seg add-cats" role="radiogroup" aria-label="Kind">
            {['all', ...kinds].map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={kind === k ? 'active' : ''}
                data-testid="embed-picker-kind"
                onClick={() => setKind(k)}
              >
                {k === 'all' ? 'All' : k}
              </button>
            ))}
          </div>
        </div>
        <div className="add-groups">
          {items.length === 0 ? (
            <p className="add-empty">
              Nothing on the board to embed yet: add a picture or a file first.
            </p>
          ) : shown.length === 0 ? (
            <p className="add-empty">Nothing matches.</p>
          ) : (
            <div className="pick-tiles">
              {shown.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="pick-tile"
                  title={`${mediaTitle(it)} · ${mediaMeta(it).typeLabel}`}
                  data-testid="embed-picker-tile"
                  onClick={() => pick(it)}
                >
                  <span className="pick-thumb">
                    <ItemThumb item={it} />
                  </span>
                  <span className="pick-label">{mediaTitle(it)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </UiDialog>
  );
}
