import { useCallback, useEffect, useState } from 'react';
import { publishWidgetData } from '../../lib/iosNative';
import { create } from 'zustand';
import type { Clip } from '../../lib/sync/clipsInbox';
import { dismissClip, fetchClips, importClip } from '../../lib/sync/clipsInbox';
import { publishBoardDirectory } from '../../lib/sync/boardDirectory';
import { useDocumentStore } from '../../state/documentStore';
import { useSyncStore } from '../../state/syncStore';
import { UiDialog } from '../ui/Dialog';
import { UiTooltip } from '../ui/Tooltip';
import { CloseIcon, InboxIcon } from '../icons';

/**
 * Clip inbox: clips POSTed by external producers (browser extension, scripts)
 * land server-side; this button surfaces them and imports them into the open
 * board. Polls while signed in (focus + a slow interval).
 */

const useClipsStore = create<{
  clips: Clip[];
  open: boolean;
  setClips: (clips: Clip[]) => void;
  setOpen: (open: boolean) => void;
}>((set) => ({
  clips: [],
  open: false,
  setClips: (clips) => {
    set({ clips });
    publishWidgetData({ inbox: clips.length });
  },
  setOpen: (open) => set({ open }),
}));

// One auto-import at a time — overlapping polls must not double-place items.
let autoImporting = false;

/**
 * Headless clip poller + importing indicator. Mounted on BOTH board views
 * (canvas and gallery) so targeted clips land in real time wherever you're
 * looking — decoding media takes a moment, so an "Importing" pill shows the
 * instant work starts instead of items just popping in seconds later.
 */
let onImporting: ((n: number) => void) | null = null;

/** Poll the inbox; auto-import clips targeted at the open board. Shared by
 *  the poller component and the dialog's manual refresh. */
function refreshClips(): void {
  if (useSyncStore.getState().status !== 'signedIn') return;
  void (async () => {
    let list = await fetchClips();
    // Clips aimed at the OPEN board land by themselves — that's what
    // targeting means. Everything else stays in the manual inbox.
    const here = useDocumentStore.getState().doc.id;
    const targeted = list.filter((c) => c.boardId === here);
    if (targeted.length > 0 && !autoImporting) {
      autoImporting = true;
      onImporting?.(targeted.length);
      try {
        for (const [i, clip] of targeted.entries()) {
          if (await importClip(clip, i)) await dismissClip(clip.id);
          onImporting?.(targeted.length - i - 1);
        }
        list = await fetchClips();
      } finally {
        autoImporting = false;
        onImporting?.(0);
      }
    }
    useClipsStore.getState().setClips(list);
  })();
  // Same cadence keeps the opt-in board directory fresh for the clipper.
  void publishBoardDirectory();
}

export function ClipsAutoImport() {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const boardId = useDocumentStore((s) => s.doc.id);
  const [importing, setImporting] = useState(0);

  const refresh = useCallback(() => refreshClips(), []);
  useEffect(() => {
    onImporting = setImporting;
    return () => {
      if (onImporting === setImporting) onImporting = null;
    };
  }, []);

  // Refresh on sign-in, on board switch (targeted clips land on open),
  // on window focus, and on a slow interval.
  useEffect(() => {
    if (!signedIn) return;
    refresh();
    const interval = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [signedIn, boardId, refresh]);

  if (importing === 0) return null;
  return (
    <div className="clips-importing" data-testid="clips-importing" role="status">
      <span className="export-spinner" aria-hidden />
      Importing {importing} clip{importing === 1 ? '' : 's'}…
    </div>
  );
}

export function ClipsInboxButton() {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const clips = useClipsStore((s) => s.clips);
  const open = useClipsStore((s) => s.open);

  if (!signedIn || clips.length === 0) return null;
  return (
    <>
      <UiTooltip label={`${clips.length} clip${clips.length === 1 ? '' : 's'} waiting`}>
        <button
          type="button"
          className="corner-toggle clips-toggle"
          data-testid="clips-toggle"
          aria-label="Clip inbox"
          onClick={() => useClipsStore.getState().setOpen(true)}
        >
          <InboxIcon />
          <span className="clips-badge" data-testid="clips-badge">
            {clips.length}
          </span>
        </button>
      </UiTooltip>
      {open && <ClipsDialog clips={clips} refresh={refreshClips} />}
    </>
  );
}

function clipLabel(clip: Clip): string {
  if (clip.title) return clip.title;
  if (clip.url) return clip.url;
  if (clip.body) return clip.body.replace(/\s+/g, ' ').slice(0, 80);
  return clip.kind;
}

function ClipsDialog({ clips, refresh }: { clips: Clip[]; refresh: () => void }) {
  const close = () => useClipsStore.getState().setOpen(false);
  const [busy, setBusy] = useState<string | null>(null);
  const currentBoard = useDocumentStore((s) => s.doc.id);
  // Board names for target chips (local library lookup — names never come
  // from the server unless the user opted into the directory anyway).
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void import('../../lib/board/boardLibrary').then(({ listBoards, revokeSummaries }) =>
      listBoards().then((bs) => {
        setNames(Object.fromEntries(bs.map((b) => [b.id, b.name])));
        revokeSummaries(bs);
      }),
    );
  }, []);

  // Smart routing: for homeless clips, the OTHER board whose content reads
  // most similar (reuses the cross-board search index; local only).
  const [routes, setRoutes] = useState<Record<string, { boardId: string; name: string }>>({});
  const clipKey = clips.map((c) => c.id).join('|');
  useEffect(() => {
    let live = true;
    void (async () => {
      const { searchLibrary } = await import('../../lib/board/libraryIndex');
      const out: Record<string, { boardId: string; name: string }> = {};
      for (const clip of clips.filter((c) => !c.boardId).slice(0, 8)) {
        const q = `${clip.title ?? ''} ${clip.body ?? ''}`.trim().slice(0, 200);
        if (q.length < 8) continue;
        const r = await searchLibrary(q, 6).catch(() => null);
        if (!r) continue;
        const counts = new Map<string, { n: number; name: string }>();
        for (const h of r.hits) {
          if (h.boardId === currentBoard) continue;
          const c = counts.get(h.boardId) ?? { n: 0, name: h.boardName };
          c.n += 1;
          counts.set(h.boardId, c);
        }
        const best = [...counts.entries()].sort((x, y) => y[1].n - x[1].n)[0];
        if (best && best[1].n >= 2) out[clip.id] = { boardId: best[0], name: best[1].name };
      }
      if (live) setRoutes(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey, currentBoard]);

  const [error, setError] = useState<string | null>(null);
  const add = async (clip: Clip, offset = 0) => {
    setBusy(clip.id);
    setError(null);
    const ok = await importClip(clip, offset).catch(() => false);
    if (ok) await dismissClip(clip.id);
    else setError('Couldn’t import that clip — its media may be missing or unsupported.');
    setBusy(null);
    refresh();
  };

  // Clips aimed at the open board float to the top.
  const sorted = [...clips].sort(
    (a, b) => Number(b.boardId === currentBoard) - Number(a.boardId === currentBoard),
  );

  return (
    <UiDialog title="Clip Inbox" onClose={close} className="clips-sheet" testId="clips-dialog">
      {error && (
        <p className="sync-note sync-warn" role="alert" data-testid="clips-error">
          {error}
        </p>
      )}
      <div className="clips-body">
        <p className="settings-hint">
          Captured from your browser. Clips aimed at a board add themselves when that board is open
          — these are waiting for a home.
        </p>
        {sorted.map((clip) => (
          <div className="clips-row" key={clip.id} data-testid="clips-row">
            <span className={`clips-kind clips-kind-${clip.kind}`}>{clip.kind}</span>
            {clip.boardId && (
              <span
                className={`clips-target${clip.boardId === currentBoard ? ' clips-target-here' : ''}`}
                data-testid="clips-target"
              >
                →{' '}
                {clip.boardId === currentBoard
                  ? 'this board'
                  : (names[clip.boardId] ?? 'other board')}
              </span>
            )}
            <span className="clips-label" title={clip.url ?? undefined}>
              {clipLabel(clip)}
            </span>
            {!clip.boardId && routes[clip.id] && (
              <button
                type="button"
                className="clips-route"
                data-testid="clips-route"
                title={`Content reads similar to “${routes[clip.id]!.name}” — open it and add this clip there`}
                disabled={busy !== null}
                onClick={() => {
                  const target = routes[clip.id]!;
                  void (async () => {
                    setBusy(clip.id);
                    const { openBoard } = await import('../../lib/board/boardLibrary');
                    if (await openBoard(target.boardId)) await add(clip);
                    else setBusy(null);
                  })();
                }}
              >
                fits “{routes[clip.id]!.name}”?
              </button>
            )}
            <button
              type="button"
              className="sync-primary clips-add"
              disabled={busy !== null}
              data-testid="clips-add"
              onClick={() => void add(clip)}
            >
              {busy === clip.id ? 'Adding' : 'Add'}
            </button>
            <button
              type="button"
              className="clips-dismiss"
              title="Dismiss"
              aria-label="Dismiss clip"
              disabled={busy !== null}
              data-testid="clips-dismiss"
              onClick={() => {
                void dismissClip(clip.id).then(refresh);
              }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        ))}
        {clips.length > 1 && (
          <button
            type="button"
            className="clips-add-all"
            disabled={busy !== null}
            data-testid="clips-add-all"
            onClick={() => {
              void (async () => {
                for (const [i, clip] of sorted.entries()) await add(clip, i);
                close();
              })();
            }}
          >
            Add all to this board
          </button>
        )}
      </div>
    </UiDialog>
  );
}

// The iOS shell posts shared items here and says so; refresh without waiting for the poll.
if (typeof window !== 'undefined') {
  window.addEventListener('boardcache:clips-changed', () => refreshClips());
}
