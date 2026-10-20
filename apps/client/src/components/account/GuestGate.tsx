import { useEffect, useState } from 'react';
import { openGuestBoard } from '../../lib/sync/collab';
import { useCollabStore } from '../../state/collabStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';

/**
 * Guest-link landing (/guest/:slug): a name gate before joining a team board
 * anonymously. Prefills the last-used or a generated "Adjective Animal" name.
 */

const ADJECTIVES = [
  'Amber',
  'Coral',
  'Indigo',
  'Jade',
  'Lilac',
  'Maple',
  'Onyx',
  'Pearl',
  'Sage',
  'Teal',
];
const ANIMALS = [
  'Fox',
  'Heron',
  'Lynx',
  'Otter',
  'Panda',
  'Raven',
  'Seal',
  'Swift',
  'Tiger',
  'Wren',
];
const NAME_KEY = 'boardcache:guestName';

const randomName = () =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${
    ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  }`;

export function GuestGate() {
  const slug = useSessionStore((s) => s.guestJoin);
  const collabStatus = useCollabStore((s) => s.status);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || randomName());
  const [boardName, setBoardName] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!slug) return;
    void fetch(`/api/guest/${encodeURIComponent(slug)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { board: { name: string } }) : null))
      .then((data) => (data ? setBoardName(data.board.name) : setInvalid(true)))
      .catch(() => setInvalid(true));
  }, [slug]);

  if (!slug || collabStatus !== 'off') return null;

  const join = async () => {
    setJoining(true);
    const finalName = name.trim() || randomName();
    localStorage.setItem(NAME_KEY, finalName);
    const ok = await openGuestBoard(slug, finalName);
    if (!ok) setInvalid(true);
    setJoining(false);
  };

  return (
    <UiDialog
      title={invalid ? 'Link not valid' : `Join “${boardName ?? '…'}”`}
      onClose={() => useSessionStore.getState().setGuestJoin(null)}
      className="guest-sheet"
      testId="guest-gate"
    >
      <div className="guest-body">
        {invalid ? (
          <p className="settings-hint">
            This guest link is no longer valid — ask the board owner for a fresh one.
          </p>
        ) : (
          <>
            <p className="settings-hint">
              You've been invited to edit this board live. Pick a display name — no account needed.
            </p>
            <div className="guest-name-row">
              <input
                type="text"
                value={name}
                maxLength={40}
                data-testid="guest-name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void join();
                }}
              />
              <button
                type="button"
                className="guest-shuffle"
                title="Random name"
                data-testid="guest-shuffle"
                onClick={() => setName(randomName())}
              >
                🎲
              </button>
            </div>
            <button
              type="button"
              className="sync-primary guest-join"
              disabled={joining}
              data-testid="guest-join"
              onClick={() => void join()}
            >
              {joining ? 'Joining' : 'Join board'}
            </button>
          </>
        )}
      </div>
    </UiDialog>
  );
}
