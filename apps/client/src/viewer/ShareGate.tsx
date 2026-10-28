import { useEffect, useState } from 'react';
import { parseDocument } from '@boardcache/schema';
import type { CanvasDocument } from '@boardcache/schema';
import type { ViewerAssetMeta } from '../lib/viewerMode';
import { useDocumentStore } from '../state/documentStore';
import { ViewerApp } from './ViewerApp';

/**
 * Entry shell for /s/<id> share links: fetches the board (the document plus
 * where each asset lives), asks for the password when the server says the
 * share is locked, and renders the read-only ViewerApp. Assets are fetched by
 * the canvas as items come into view, like a community preview.
 */

interface SharePayload {
  title: string;
  doc: CanvasDocument;
  assets: Record<string, ViewerAssetMeta>;
}

async function fetchShare(id: string, ticket: string | null): Promise<SharePayload | 'locked'> {
  const q = ticket ? `?t=${encodeURIComponent(ticket)}` : '';
  const res = await fetch(`/api/share/${encodeURIComponent(id)}${q}`);
  if (res.status === 401) return 'locked';
  if (res.status === 404) {
    throw new Error('This share link no longer exists — the owner may have stopped sharing.');
  }
  if (!res.ok) throw new Error(`Could not load the shared board (${res.status}).`);
  return (await res.json()) as SharePayload;
}

export function ShareGate({ id }: { id: string }) {
  const [phase, setPhase] = useState<'loading' | 'password' | 'ready' | 'fatal'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (payload: SharePayload) => {
    window.__BOARD_ASSETS__ = payload.assets;
    const doc = parseDocument(JSON.stringify(payload.doc));
    window.__BOARD__ = doc;
    useDocumentStore.getState().replaceDoc(doc);
    document.title = `${payload.title || doc.name} — boardCache`;
    setPhase('ready');
  };

  useEffect(() => {
    void (async () => {
      try {
        if (!id) throw new Error('This share link is malformed.');
        const payload = await fetchShare(id, null);
        if (payload === 'locked') {
          setPhase('password');
          return;
        }
        open(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the shared board.');
        setPhase('fatal');
      }
    })();
  }, [id]);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(id)}/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) throw new Error('Wrong password.');
      if (res.status === 429) throw new Error('Too many attempts. Try again later.');
      if (!res.ok) throw new Error(`Could not unlock the board (${res.status}).`);
      const { ticket } = (await res.json()) as { ticket: string };
      const payload = await fetchShare(id, ticket);
      if (payload === 'locked') throw new Error('Wrong password.');
      open(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong password.');
      setBusy(false);
    }
  };

  if (phase === 'ready') return <ViewerApp />;

  return (
    <div className="share-gate">
      <div className="share-gate-panel" data-testid="share-gate">
        <h1>boardCache</h1>
        {phase === 'loading' && <p>Loading shared board</p>}
        {phase === 'fatal' && (
          <p className="sync-error" role="alert" data-testid="share-error">
            {error}
          </p>
        )}
        {phase === 'password' && (
          <>
            <p>This shared board is password-protected.</p>
            <input
              type="password"
              value={password}
              placeholder="Password"
              autoFocus
              data-testid="share-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void unlock();
                }
              }}
            />
            {error && (
              <p className="sync-error" role="alert" data-testid="share-error">
                {error}
              </p>
            )}
            <button
              type="button"
              className="sync-primary"
              disabled={!password || busy}
              data-testid="share-unlock"
              onClick={() => void unlock()}
            >
              {busy ? 'Unlocking' : 'View board'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
