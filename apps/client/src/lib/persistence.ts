import type { CanvasDocument } from '@boardcache/schema';
import { rememberLastBoard, saveBoardRecord } from './board/boardLibrary';
import { probeDb, resetDb } from './db';
import { logDeviceEvent } from './deviceLog';
import { markBoardDirty } from './sync/boardSync';
import { useDocumentStore } from '../state/documentStore';
import { useHistoryStore } from '../state/history';
import { useSessionStore } from '../state/sessionStore';
import { dismissNotice, showNotice } from './notices';
import { collabActive } from '../state/collabStore';

const AUTOSAVE_DEBOUNCE_MS = 500;
/** Reopen-and-retry schedule after a failed save (iOS severs the IndexedDB
 *  connection while the app sleeps, and the fresh open can itself take a
 *  moment to come good). Only once these are spent does anyone hear of it. */
const RETRY_DELAYS_MS = [0, 400, 1200, 3000];
/** While saving keeps failing, try again this often — the connection
 *  usually returns on its own; the notice clears the moment a save lands. */
const BACKGROUND_RETRY_MS = 5000;
const NOTICE_ID = 'autosave-failed';

let started = false;

/** A board is only "open" (and thus autosaved/synced) on the canvas/gallery. */
const boardOpen = () => useSessionStore.getState().view !== 'library';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Save, reopening the database between attempts when it fails. Resolves true
 * once a save lands; false when every attempt failed (the last error is
 * reported through the device log so the exact failure is known).
 */
export async function saveWithRecovery(
  doc: CanvasDocument,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<boolean> {
  let err: unknown;
  try {
    await saveBoardRecord(doc);
    return true;
  } catch (e) {
    err = e;
  }
  console.error('boardCache: autosave failed', err);
  for (const [i, delay] of delays.entries()) {
    resetDb(); // the cached handle may simply be dead — reopen
    await sleep(delay);
    if (!boardOpen()) return false; // closed meanwhile; nothing left to save
    try {
      await saveBoardRecord(doc);
      console.info(`boardCache: autosave recovered on retry ${i + 1}`);
      return true;
    } catch (e) {
      err = e;
    }
  }
  const dom = err instanceof DOMException ? err : null;
  console.error('boardCache: autosave retries exhausted', err);
  logDeviceEvent('autosave-failed', {
    name: dom?.name ?? (err instanceof Error ? err.name : typeof err),
    message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    attempts: delays.length + 1,
  });
  showNotice(
    dom?.name === 'QuotaExceededError'
      ? 'Your changes aren’t being saved — this device’s storage is full. Free up space, then make any edit to retry.'
      : 'Your changes aren’t being saved yet — the storage connection dropped (common on iOS after the app sleeps). Reconnecting automatically; your edits stay open in this tab.',
    { id: NOTICE_ID, sticky: true },
  );
  return false;
}

/**
 * Autosave the open document on every change (debounced). No board is opened
 * on load — the homepage shows the index, and the router opens a board only for
 * a /b/:id URL. While on the index nothing is saved or synced, so a board can't
 * keep churning in the background (which produced sync conflicts across devices).
 */
export async function initPersistence(): Promise<void> {
  if (started) return;
  started = true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;

  const save = async (): Promise<void> => {
    if (saving) return; // one save at a time; the next change reschedules
    if (!boardOpen()) return; // closed while the save was pending
    const doc = useDocumentStore.getState().doc;
    saving = true;
    try {
      if (await saveWithRecovery(doc)) {
        useHistoryStore.getState().markSaved();
        dismissNotice(NOTICE_ID); // saving works again
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        // If this board is synced, queue an encrypted push.
        void markBoardDirty(doc.id);
      } else if (boardOpen()) {
        // Keep trying quietly — the latest document, whenever it lands.
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void save();
        }, BACKGROUND_RETRY_MS);
      }
    } finally {
      saving = false;
    }
  };

  useDocumentStore.subscribe(
    (s) => s.doc,
    (doc) => {
      if (!boardOpen()) return; // on the index → nothing is open
      if (collabActive()) return; // team boards live on the server, not here
      rememberLastBoard(doc.id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void save();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  );

  // Coming back to the foreground is exactly when iOS has severed the
  // connection: check it right away (dropping a dead handle) and, if a save
  // is still owed, land it now rather than at the next retry tick.
  const onResume = () => {
    void probeDb().then(() => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
        void save();
      }
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onResume();
  });
  window.addEventListener('pageshow', onResume);
}
