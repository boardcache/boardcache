import { useState } from 'react';
import { CONNECTION_RELS, relDirectional, relName } from '../../lib/canvas/connectionTypes';
import { endpointRect } from '../../lib/canvas/connections';
import { rectCenter } from '../../lib/canvas/geometry';
import {
  removeConnection,
  setConnectionLabel,
  setConnectionRel,
  swapConnection,
} from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { SwapIcon, TrashIcon } from '../icons';
import { mediaMeta } from '../../lib/mediaItems';
import type { CanvasDocument, ConnectionEndpoint } from '@boardcache/schema';

/**
 * Floating editor for the selected connection: pick what the link MEANS
 * (typed connections — supports/contradicts/causes/relates/cites, colored
 * to match the line) and give it a label. Positioned in screen space near
 * the line's midpoint; the first label-editing surface connections ever had.
 */
/** Short display name for a connection endpoint (item title or group name). */
function endpointName(doc: CanvasDocument, ep: ConnectionEndpoint): string {
  if (ep.kind === 'group') return doc.groups[ep.id]?.name ?? 'Group';
  const item = doc.items[ep.id];
  return item ? mediaMeta(item).title : 'Item';
}

export function ConnectionEditor() {
  const id = useSessionStore((s) => s.selectedConnectionId);
  const doc = useDocumentStore((s) => s.doc);
  const connection = id ? doc.connections[id] : undefined;
  // Render-phase adjust (the endorsed pattern): reset the draft label when a
  // different connection is selected.
  const [editing, setEditing] = useState<{ id: string | null; label: string }>({
    id,
    label: connection?.label ?? '',
  });
  if (editing.id !== id) setEditing({ id, label: connection?.label ?? '' });
  const label = editing.label;
  const setLabel = (v: string) => setEditing({ id, label: v });

  if (!id || !connection) return null;
  const fromRect = endpointRect(doc, connection.from, {});
  const toRect = endpointRect(doc, connection.to, {});
  if (!fromRect || !toRect) return null;
  const a = rectCenter(fromRect);
  const b = rectCenter(toRect);
  const { scale, x, y } = doc.viewport;
  const mid = {
    x: ((a.x + b.x) / 2) * scale + x,
    y: ((a.y + b.y) / 2) * scale + y,
  };
  const left = Math.max(8, Math.min(mid.x - 150, window.innerWidth - 308));
  const top = Math.max(56, Math.min(mid.y + 18, window.innerHeight - 96));

  return (
    <div className="conn-editor" style={{ left, top }} data-testid="connection-editor">
      <div className="conn-rels" role="radiogroup" aria-label="Connection type">
        {CONNECTION_RELS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={(connection.rel ?? 'relates') === r.id}
            className={`conn-rel${(connection.rel ?? 'relates') === r.id ? ' active' : ''}`}
            data-testid={`conn-rel-${r.id}`}
            title={r.name}
            onClick={() => setConnectionRel(id, r.id)}
          >
            <span
              className="conn-rel-dot"
              style={{ background: r.color ?? 'var(--text-secondary)' }}
            />
            {r.name}
          </button>
        ))}
      </div>
      {relDirectional(connection.rel) && (
        <div className="conn-dir" data-testid="conn-dir">
          <span className="conn-dir-phrase">
            <em>{endpointName(doc, connection.from)}</em> → {relName(connection.rel).toLowerCase()}{' '}
            → <em>{endpointName(doc, connection.to)}</em>
          </span>
          <button
            type="button"
            className="conn-swap"
            title="Reverse direction"
            aria-label="Reverse direction"
            data-testid="conn-swap"
            onClick={() => swapConnection(id)}
          >
            <SwapIcon size={14} />
          </button>
        </div>
      )}
      <div className="conn-editor-row">
        <input
          value={label}
          placeholder="Label (optional)"
          data-testid="conn-label-input"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => setConnectionLabel(id, label)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') setConnectionLabel(id, label);
            if (e.key === 'Escape') useSessionStore.getState().setSelectedConnection(null);
          }}
        />
        <button
          type="button"
          className="conn-delete"
          aria-label="Delete connection"
          data-testid="conn-delete"
          onClick={() => {
            removeConnection(id);
            useSessionStore.getState().setSelectedConnection(null);
          }}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
}
