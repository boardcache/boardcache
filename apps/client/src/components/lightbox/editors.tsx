/** Lightbox sidebar editors: title, note and URL. */
import { safeHttpUrl } from '../../lib/text/safeUrl';
import { useState } from 'react';
import type { Item } from '@boardcache/schema';
import { mediaMeta } from '../../lib/mediaItems';
import { renameGroup, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { LinkIcon, PopOutIcon } from '../icons';
import { effectiveUrl } from '../../lib/text/itemUrl';
import { WEIGHT_LEVELS, weightMeta } from '../../lib/text/evidenceWeight';
import { membershipsOf, unlinkEvidence } from '../../lib/structure/cases';

function lightboxTitle(
  doc: ReturnType<typeof useDocumentStore.getState>['doc'],
  item: Item,
): string {
  if (item.type === 'palette') return item.name ?? 'Palette';
  if (item.type === 'swatch' && item.groupId) {
    return doc.groups[item.groupId]?.name ?? 'Color Swatch';
  }
  return mediaMeta(item).title;
}

/** Editable title for ANY lightbox item; commits the right field on blur/Enter. */
export function LightboxTitleEditor({ item }: { item: Item }) {
  const doc = useDocumentStore.getState().doc;
  const stored =
    item.type === 'palette'
      ? (item.name ?? '')
      : item.type === 'swatch' && item.groupId
        ? (doc.groups[item.groupId]?.name ?? '')
        : item.type === 'audio'
          ? (item.title ?? item.name ?? '')
          : (item.name ?? '');
  const [value, setValue] = useState(stored);
  const placeholder = lightboxTitle(doc, item) || mediaMeta(item).typeLabel;

  const commit = () => {
    const t = value.trim();
    if (item.type === 'palette') {
      updateItems([item.id], 'Rename', (d) => {
        if (d.type !== 'palette') return;
        if (t) d.name = t;
        else delete d.name;
      });
    } else if (item.type === 'swatch' && item.groupId) {
      renameGroup(item.groupId, value);
    } else if (item.type === 'audio') {
      updateItems([item.id], 'Rename', (d) => {
        if (d.type === 'audio') d.title = t || null;
      });
    } else {
      updateItems([item.id], 'Rename', (d) => {
        d.name = t || undefined;
      });
    }
  };

  return (
    <input
      className="lightbox-title-input"
      data-testid="lightbox-title-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setValue(stored);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A link field for the item: edits url (link/iframe) or linkUrl (everything
 *  else); video embeds show their URL read-only. */
export function LightboxNoteEditor({ item }: { item: Item }) {
  const [value, setValue] = useState(item.notes ?? '');
  const commit = () => {
    const v = value.trim();
    if (v === (item.notes ?? '')) return;
    updateItems([item.id], 'Edit note', (d) => {
      if (v) d.notes = v;
      else delete d.notes;
    });
  };
  return (
    <textarea
      className="lightbox-note"
      data-testid="lightbox-note"
      value={value}
      placeholder="Write a note"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') return; // let the lightbox close
        e.stopPropagation();
      }}
    />
  );
}

/** Evidence strength 1–5 (how far a case may lean on the item); a second
 *  click on the current level clears it back to unrated. */
export function LightboxStrengthEditor({ item }: { item: Item }) {
  const set = (weight: number | undefined) =>
    updateItems([item.id], weight ? 'Set evidence strength' : 'Clear evidence strength', (d) => {
      if (weight) d.weight = weight;
      else delete d.weight;
    });
  return (
    <div className="lightbox-strength" role="radiogroup" aria-label="Evidence strength">
      {WEIGHT_LEVELS.map((w) => (
        <button
          key={w.value}
          type="button"
          className={`lightbox-strength-step${item.weight && item.weight >= w.value ? ' on' : ''}`}
          role="radio"
          aria-checked={item.weight === w.value}
          title={`${w.value}/5 · ${w.name}`}
          data-testid={`lightbox-strength-${w.value}`}
          onClick={() => set(item.weight === w.value ? undefined : w.value)}
        >
          {w.value}
        </button>
      ))}
      <span className="lightbox-strength-name" data-testid="lightbox-strength-name">
        {weightMeta(item.weight)?.name ?? 'Unrated'}
      </span>
    </div>
  );
}

/** The cases an item is linked to, with unlink, and the way to link more. */
export function LightboxCasesEditor({ item }: { item: Item }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const memberships = membershipsOf(itemsById, item.id);
  const anyCase = Object.values(itemsById).some((it) => it.type === 'case');
  return (
    <div className="lightbox-cases" data-testid="lightbox-cases">
      {memberships.map((m) => (
        <span className="lightbox-case-chip" key={`${m.caseId}:${m.conclusion.id}`}>
          <span className={`lightbox-case-side ${m.stance}`} aria-hidden />
          <span className="lightbox-case-text">
            {m.caseTitle} · {m.conclusion.label}
          </span>
          <button
            type="button"
            aria-label="Unlink from case"
            data-testid="lightbox-case-unlink"
            onClick={() => unlinkEvidence(m.caseId, [item.id], m.conclusion.id)}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="lightbox-cases-add"
        data-testid="lightbox-cases-add"
        disabled={!anyCase}
        title={anyCase ? undefined : 'Add a case to the board first'}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent('boardcache:add-to-case', { detail: { ids: [item.id] } }),
          )
        }
      >
        Add to case
      </button>
    </div>
  );
}

export function LightboxUrlEditor({ item }: { item: Item }) {
  const readonly = item.type === 'video' && !!item.embed;
  const isUrlField = item.type === 'link' || item.type === 'iframe';
  const stored = isUrlField ? ((item as { url?: string }).url ?? '') : (item.linkUrl ?? '');
  const [value, setValue] = useState(stored);
  const url = effectiveUrl(item);

  if (readonly) {
    return url ? (
      <a
        className="lightbox-url"
        href={safeHttpUrl(url) ?? undefined}
        target="_blank"
        rel="noreferrer noopener"
        title={url}
      >
        <LinkIcon />
        <span>{url}</span>
      </a>
    ) : null;
  }

  const commit = () => {
    const v = value.trim();
    updateItems([item.id], 'Set link', (d) => {
      if (d.type === 'link' || d.type === 'iframe') d.url = v;
      else d.linkUrl = v || undefined;
    });
  };

  return (
    <div className="lightbox-url-row">
      <LinkIcon />
      <input
        className="lightbox-url-input"
        data-testid="lightbox-url-input"
        value={value}
        placeholder="Add a link"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setValue(stored);
            e.currentTarget.blur();
          }
        }}
      />
      {url && (
        <a
          className="lightbox-url-open"
          href={safeHttpUrl(url) ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
          title="Open link"
          onClick={(e) => e.stopPropagation()}
        >
          <PopOutIcon />
        </a>
      )}
    </div>
  );
}
