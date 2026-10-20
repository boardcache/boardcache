import { useEffect, useState } from 'react';
import type { CanvasDocument, Connection, Item } from '@boardcache/schema';
import { connectionsFor } from '../../lib/canvas/connections';
import { relColor, relName } from '../../lib/canvas/connectionTypes';
import { mediaMeta } from '../../lib/mediaItems';
import { similarItems, type ScoredItem } from '../../lib/search/similarity';
import { useShallow } from 'zustand/react/shallow';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { groupMembers } from '../../lib/canvas/grouping';

/**
 * Lightbox sidebar tab: the item's connection graph — outgoing (→) and
 * incoming (←) links, plus links that touch the item's whole group. Item
 * rows jump the lightbox to that item.
 */

function endpointLabel(doc: CanvasDocument, ep: Connection['from']): string {
  if (ep.kind === 'group') {
    const group = doc.groups[ep.id];
    const count = groupMembers(doc, ep.id).length;
    return `${group?.name ?? 'Group'} · ${count} item${count === 1 ? '' : 's'}`;
  }
  const item = doc.items[ep.id];
  return item ? mediaMeta(item).title : 'Missing item';
}

function RelatedRow({
  doc,
  connection,
  selfId,
}: {
  doc: CanvasDocument;
  connection: Connection;
  selfId: string;
}) {
  const outgoing = connection.from.id === selfId;
  const rel = connection.rel ?? 'relates';
  const tint = relColor(rel);
  const other = outgoing ? connection.to : connection.from;
  const otherItem = other.kind === 'item' ? doc.items[other.id] : undefined;
  const typeLabel =
    other.kind === 'group' ? 'Group' : otherItem ? mediaMeta(otherItem).typeLabel : '';

  const open = () => {
    if (!otherItem) return;
    const session = useSessionStore.getState();
    // A gallery group scope that excludes the target would strand the
    // lightbox — widen it before jumping.
    if (session.lightboxGroupScope && otherItem.groupId !== session.lightboxGroupScope) {
      session.setLightboxGroupScope(null);
    }
    session.setLightbox(other.id);
  };

  return (
    <button
      type="button"
      className="related-row"
      data-testid="related-row"
      disabled={!otherItem}
      onClick={open}
      title={otherItem ? 'Open in the lightbox' : undefined}
    >
      <span
        className="related-dir"
        style={tint ? { color: tint } : undefined}
        aria-label={outgoing ? 'connects to' : 'connected from'}
      >
        {outgoing ? '→' : '←'}
      </span>
      <span
        className="related-rel"
        style={tint ? { color: tint } : undefined}
        data-testid="related-rel"
      >
        {relName(rel)}
      </span>
      <span className="related-name">{endpointLabel(doc, other)}</span>
      <span className="related-type">{typeLabel}</span>
      {connection.label && <span className="related-label">{connection.label}</span>}
    </button>
  );
}

/** Two asset-backed items showing the same bytes (a real duplicate, not a self-match). */
function sameAsset(a: Item, b: Item): boolean {
  const asset = (i: Item) => ('assetId' in i && typeof i.assetId === 'string' ? i.assetId : null);
  const x = asset(a);
  return x !== null && x === asset(b);
}

export function RelatedPanel({ item }: { item: Item }) {
  const doc = useDocumentStore((s) => s.doc);
  const direct = useDocumentStore(
    useShallow((s) => connectionsFor(s.doc, item.id).map((c) => c.id)),
  );
  const viaGroup = useDocumentStore(
    useShallow((s) => (item.groupId ? connectionsFor(s.doc, item.groupId).map((c) => c.id) : [])),
  );

  // Content-similar items (local vectors) — computed once per item view.
  const [similar, setSimilar] = useState<ScoredItem[] | null>(null);
  // A different item clears the previous list during render: while the new
  // similarity computes, the old rows would still show — including the item
  // now being viewed.
  const [similarFor, setSimilarFor] = useState(item.id);
  if (similarFor !== item.id) {
    setSimilarFor(item.id);
    setSimilar(null);
  }
  useEffect(() => {
    let live = true;
    similarItems(item.id)
      .then((r) => {
        if (live) setSimilar(r.filter((s) => s.id !== item.id));
      })
      .catch(() => {
        if (live) setSimilar([]);
      });
    return () => {
      live = false;
    };
  }, [item.id]);

  const similarRows =
    similar && similar.length > 0 ? (
      <>
        <span className="lsp-field-label">Similar content</span>
        {similar.map((s) => {
          const other = doc.items[s.id];
          if (!other) return null;
          return (
            <button
              key={s.id}
              type="button"
              className="related-row"
              data-testid="related-similar-row"
              title={
                sameAsset(item, other)
                  ? 'Duplicate of this item'
                  : s.terms.length
                    ? `Shared: ${s.terms.join(', ')}`
                    : 'Similar content'
              }
              onClick={() => {
                const session = useSessionStore.getState();
                if (session.lightboxGroupScope && other.groupId !== session.lightboxGroupScope) {
                  session.setLightboxGroupScope(null);
                }
                session.setLightbox(s.id);
              }}
            >
              <span className="related-dir" aria-label="similar to">
                ≈
              </span>
              <span className="related-name">{mediaMeta(other).title}</span>
              <span className="related-type">{Math.round(s.score * 100)}%</span>
            </button>
          );
        })}
      </>
    ) : null;

  if (direct.length === 0 && viaGroup.length === 0) {
    return (
      <div className="lsp-section" data-testid="related-panel">
        <p className="related-empty" data-testid="related-empty">
          No connections yet. Select this item on the canvas and drag from one of its connect
          handles onto another item or group to link them.
        </p>
        {similarRows}
      </div>
    );
  }

  return (
    <div className="lsp-section" data-testid="related-panel">
      {direct.length > 0 && (
        <>
          <span className="lsp-field-label">Connections</span>
          {direct.map((cid) => {
            const c = doc.connections[cid];
            return c ? <RelatedRow key={cid} doc={doc} connection={c} selfId={item.id} /> : null;
          })}
        </>
      )}
      {viaGroup.length > 0 && item.groupId && (
        <>
          <span className="lsp-field-label">
            Via group{doc.groups[item.groupId]?.name ? ` · ${doc.groups[item.groupId]!.name}` : ''}
          </span>
          {viaGroup.map((cid) => {
            const c = doc.connections[cid];
            return c ? (
              <RelatedRow key={cid} doc={doc} connection={c} selfId={item.groupId!} />
            ) : null;
          })}
        </>
      )}
      {similarRows}
    </div>
  );
}
