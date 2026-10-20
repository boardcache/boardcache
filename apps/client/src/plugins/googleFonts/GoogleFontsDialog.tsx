import { useEffect, useState } from 'react';
import { importGoogleFont, searchFamilies } from '../../lib/integrations/googleFonts';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../../components/ui/Dialog';
import { TypeIcon } from '../../components/icons';

/** Search the Google Fonts catalogue and import a family as a font item. */
export function GoogleFontsDialog() {
  const open = useSessionStore((s) => s.googleFontsOpen);
  return open ? <GoogleFontsBody /> : null;
}

function GoogleFontsBody() {
  const close = () => useSessionStore.getState().setGoogleFontsOpen(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void searchFamilies(query).then((names) => {
        if (alive) setMatches(names);
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Preview faces: one stylesheet for the visible matches, subset (text=) to
  // just the characters each name needs — a few KB total. Removed on close.
  useEffect(() => {
    if (matches.length === 0) return;
    const families = matches.slice(0, 30);
    const chars = [...new Set(families.join(''))].join('');
    const params = families
      .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400`)
      .join('&');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${params}&text=${encodeURIComponent(chars)}&display=swap`;
    document.head.append(link);
    return () => link.remove();
  }, [matches]);

  const doImport = async (family: string) => {
    if (busy) return;
    setBusy(family);
    setError(null);
    try {
      await importGoogleFont(family);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
      setBusy(null);
    }
  };

  return (
    <UiDialog
      title="Add Google Font"
      onClose={close}
      className="gfonts-sheet"
      testId="gfonts-dialog"
      dismissable={!busy}
    >
      <div className="gfonts-body">
        <input
          className="gfonts-search"
          value={query}
          placeholder="Search Google Fonts"
          autoFocus
          data-autofocus
          data-testid="gfonts-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) void doImport(matches[0]);
          }}
        />
        {error && (
          <p className="sync-error" role="alert" data-testid="gfonts-error">
            {error}
          </p>
        )}
        <div className="gfonts-list" data-testid="gfonts-list">
          {matches.map((family) => (
            <button
              key={family}
              type="button"
              className="gfonts-item"
              disabled={busy !== null}
              onClick={() => void doImport(family)}
              data-testid={`gfonts-item-${family}`}
            >
              <TypeIcon />
              <span className="gfonts-name" style={{ fontFamily: `'${family}'` }}>
                {family}
              </span>
              {busy === family && <span className="gfonts-busy">Importing</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="settings-hint">No matches.</p>}
        </div>
        <p className="settings-hint">
          The regular weight downloads into this board as a normal font asset — no live Google
          dependency afterwards.
        </p>
      </div>
    </UiDialog>
  );
}
