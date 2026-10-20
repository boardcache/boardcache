import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '../state/documentStore';
import { ViewerApp } from './ViewerApp';
import { decryptShare, fetchShare } from './shareLoader';

/**
 * Entry shell for /s/<id> share links: fetches the encrypted snapshot, then
 * either decrypts with the link-fragment secret or asks the viewer for the
 * share password. Renders the read-only ViewerApp once the board is loaded.
 */
export function ShareGate({ id }: { id: string }) {
  const [phase, setPhase] = useState<'loading' | 'password' | 'ready' | 'fatal'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const blobRef = useRef<Blob | null>(null);

  const open = async (blob: Blob, secret: string) => {
    const doc = await decryptShare(blob, secret);
    useDocumentStore.getState().replaceDoc(doc);
    document.title = `${doc.name} — boardCache`;
    setPhase('ready');
  };

  useEffect(() => {
    void (async () => {
      try {
        if (!id) throw new Error('This share link is malformed.');
        const { blob, hasPassword } = await fetchShare(id);
        blobRef.current = blob;
        if (hasPassword) {
          setPhase('password');
          return;
        }
        const secret = decodeURIComponent(location.hash.slice(1));
        if (!secret) throw new Error('This share link is missing its key — copy the full link.');
        await open(blob, secret);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the shared board.');
        setPhase('fatal');
      }
    })();
  }, [id]);

  const unlock = async () => {
    if (!password || busy || !blobRef.current) return;
    setBusy(true);
    setError(null);
    try {
      await open(blobRef.current, password);
    } catch {
      setError('Wrong password.');
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
