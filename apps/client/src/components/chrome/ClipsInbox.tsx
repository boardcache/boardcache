import { useCallback, useEffect, useState } from 'react';
import { publishWidgetData } from '../../lib/iosNative';
import { create } from 'zustand';
import type { Clip } from '../../lib/sync/clipsInbox';
import { dismissClip, fetchClips, fetchDesktopClips, importClip } from '../../lib/sync/clipsInbox';
import { desktopClips } from '../../lib/platform';
import { publishBoardDirectory } from '../../lib/sync/boardDirectory';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { UiDialog } from '../ui/Dialog';
import { UiTooltip } from '../ui/Tooltip';
import { CloseIcon, InboxIcon } from '../icons';

/**
 * Clip inbox: clips sent by the browser clipper (or scripts) wait either on
 * the sync server (signed-in accounts with a sync plan) or, in the desktop
 * app, in its local inbox on this computer. This button surfaces both and
 * imports them into the open board. Polls the server while signed in (focus
 * + a slow interval); the desktop app says when a local clip arrives.
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
 * Boxes on the canvas for clips announced but not yet here (a screenshot
 * being stitched in the browser): one per pending clip aimed at the open
 * board, at the view's centre, draggable like any loading card. The real
 * clip lands where its box is and the box goes; an announcement that is
 * withdrawn or expires takes its box with it.
 */
const PENDING_BOX = { width: 320, height: 200 };
const boxes = new Map<string, { url: string | null }>();
const boxId = (clipId: string) => `clip:${clipId}`;

function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function syncPendingBoxes(pending: Clip[]): void {
  const session = useSessionStore.getState();
  const live = new Set(pending.map((c) => c.id));
  for (const id of [...boxes.keys()]) {
    if (!live.has(id)) {
      boxes.delete(id);
      session.removePendingImport(boxId(id));
    }
  }
  pending.forEach((clip, i) => {
    if (boxes.has(clip.id)) return;
    boxes.set(clip.id, { url: clip.url });
    const centre = clientToCanvas(window.innerWidth / 2 + i * 40, window.innerHeight / 2 + i * 40);
    session.addPendingImport({
      id: boxId(clip.id),
      x: centre.x - PENDING_BOX.width / 2,
      y: centre.y - PENDING_BOX.height / 2,
      width: PENDING_BOX.width,
      height: PENDING_BOX.height,
      label: 'Screenshot on its way',
      name: clip.title ?? hostOf(clip.url),
    });
  });
}

/** Where a clip's announcement box sits now (the user may have moved it),
 *  matched by the page it was announced from; the box is taken away. */
function takeBoxFor(clip: Clip): { x: number; y: number } | null {
  if (!clip.url) return null;
  const match = [...boxes.entries()].find(([, b]) => b.url === clip.url);
  if (!match) return null;
  const [id] = match;
  const box = useSessionStore.getState().pendingImports.find((p) => p.id === boxId(id));
  boxes.delete(id);
  useSessionStore.getState().removePendingImport(boxId(id));
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

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
  const signedIn = useSyncStore.getState().status === 'signedIn';
  const local = desktopClips() !== null;
  if (!signedIn && !local) {
    useClipsStore.getState().setClips([]);
    return;
  }
  const load = async () => [
    ...(signedIn ? await fetchClips() : []),
    ...(await fetchDesktopClips()),
  ];
  void (async () => {
    let list = await load();
    // Clips aimed at the OPEN board land by themselves — that's what
    // targeting means. Everything else stays in the manual inbox.
    const here = useDocumentStore.getState().doc.id;
    syncPendingBoxes(list.filter((c) => c.boardId === here && c.kind === 'pending'));
    const targeted = list.filter((c) => c.boardId === here && c.kind !== 'pending');
    if (targeted.length > 0 && !autoImporting) {
      autoImporting = true;
      onImporting?.(targeted.length);
      try {
        for (const [i, clip] of targeted.entries()) {
          if (await importClip(clip, i, takeBoxFor(clip))) await dismissClip(clip);
          onImporting?.(targeted.length - i - 1);
        }
        list = await load();
        syncPendingBoxes(list.filter((c) => c.boardId === here && c.kind === 'pending'));
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

  // Desktop: the local inbox pings on every arrival; the account's sync
  // channel does the same for the server's inbox.
  useEffect(() => desktopClips()?.onChanged(refresh), [refresh]);
  useEffect(() => {
    window.addEventListener('boardcache:clips-changed', refresh);
    return () => window.removeEventListener('boardcache:clips-changed', refresh);
  }, [refresh]);

  // Refresh on sign-in or out, on board switch (targeted clips land on
  // open), on window focus, and on a slow interval.
  useEffect(() => {
    refresh();
    if (!signedIn && !desktopClips()) return;
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
  const clips = useClipsStore((s) => s.clips);
  const open = useClipsStore((s) => s.open);

  if (clips.length === 0) return null;
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
      listBoards().then(async (bs) => {
        const { useVaultStore } = await import('../../lib/vault/vaultStore');
        setNames(
          Object.fromEntries([
            ...bs.map((b) => [b.id, b.name]),
            ...useVaultStore.getState().boards.map((b) => [b.id, b.name]),
          ]),
        );
        revokeSummaries(bs);
      }),
    );
  }, []);

  // Smart routing: for homeless clips, the OTHER board whose content reads
  // most similar (the cross-board search index; local only) or, with the
  // image model on, holds pictures the clip resembles: a picture clip by
  // its pixels, any other by its words.
  const [routes, setRoutes] = useState<Record<string, { boardId: string; name: string }>>({});
  const clipKey = clips.map((c) => c.id).join('|');
  useEffect(() => {
    let live = true;
    void (async () => {
      const { searchLibrary } = await import('../../lib/board/libraryIndex');
      const { clipLibraryHits } = await import('../../lib/search/clipIndex');
      const { clipMedia } = await import('../../lib/sync/clipsInbox');
      const out: Record<string, { boardId: string; name: string }> = {};
      for (const clip of clips.filter((c) => !c.boardId).slice(0, 8)) {
        const q = `${clip.title ?? ''} ${clip.body ?? ''}`.trim().slice(0, 200);
        const counts = new Map<string, { n: number; name: string; best: number }>();
        const count = (boardId: string, name: string | undefined, score: number) => {
          if (boardId === currentBoard) return;
          const c = counts.get(boardId) ?? { n: 0, name: name ?? names[boardId] ?? '', best: 0 };
          c.n += 1;
          c.best = Math.max(c.best, score);
          if (!c.name && name) c.name = name;
          counts.set(boardId, c);
        };
        if (q.length >= 8) {
          const r = await searchLibrary(q, 6).catch(() => null);
          for (const h of r?.hits ?? []) count(h.boardId, h.boardName, 0);
        }
        const blob = clip.kind === 'image' ? await clipMedia(clip).catch(() => null) : null;
        const looks = await clipLibraryHits({ text: q, ...(blob ? { blob } : {}) }, 6).catch(
          () => [],
        );
        for (const h of looks) count(h.boardId, undefined, h.score);
        const best = [...counts.entries()].sort(
          (x, y) => y[1].n - x[1].n || y[1].best - x[1].best,
        )[0];
        // Two things on one board, or one picture that is nearly the same.
        if (best && best[1].name && (best[1].n >= 2 || (blob && best[1].best >= 0.85)))
          out[clip.id] = { boardId: best[0], name: best[1].name };
      }
      if (live) setRoutes(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey, currentBoard, names]);

  const [error, setError] = useState<string | null>(null);
  const add = async (clip: Clip, offset = 0) => {
    setBusy(clip.id);
    setError(null);
    const ok = await importClip(clip, offset).catch(() => false);
    if (ok) await dismissClip(clip);
    else setError('Couldn’t import that clip — its media may be missing or unsupported.');
    setBusy(null);
    refresh();
  };

  // Clips aimed at the open board float to the top.
  const sorted = [...clips].sort(
    (a, b) => Number(b.boardId === currentBoard) - Number(a.boardId === currentBoard),
  );

  return (
    <UiDialog
      title="Clip Inbox"
      onClose={close}
      className="clips-sheet"
      size="wide"
      testId="clips-dialog"
    >
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
            <span className={`clips-kind clips-kind-${clip.kind}`}>
              {clip.kind === 'pending' ? 'on its way' : clip.kind}
            </span>
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
            {clip.kind !== 'pending' && (
              <button
                type="button"
                className="sync-primary clips-add"
                disabled={busy !== null}
                data-testid="clips-add"
                onClick={() => void add(clip)}
              >
                {busy === clip.id ? 'Adding' : 'Add'}
              </button>
            )}
            <button
              type="button"
              className="clips-dismiss"
              title="Dismiss"
              aria-label="Dismiss clip"
              disabled={busy !== null}
              data-testid="clips-dismiss"
              onClick={() => {
                void dismissClip(clip).then(refresh);
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
