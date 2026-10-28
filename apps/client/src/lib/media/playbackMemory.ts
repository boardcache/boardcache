/**
 * Per-device memory of where playback left off, and whether it was left
 * paused, keyed by item+asset. Lives in localStorage (like scroll position —
 * device state, not document content), so leaving the board, switching views,
 * or reloading the app resumes media where it stopped, and a clip that was
 * paused stays paused instead of autoplaying. Entries are pruned oldest-first
 * past a cap; a clip that plays to its end forgets its position so it
 * restarts cleanly.
 */
const KEY = 'boardcache:playbackPositions';
/** How long a pause must stand before it is taken as the user's. */
const PAUSE_SETTLE_MS = 250;
const MAX_ENTRIES = 300;
/** Ignore trailing/leading slivers: resume only meaningful positions. */
const MIN_RESUME_S = 1;

interface Entry {
  t: number;
  at: number;
  /** Left paused by the user (an autoplaying clip stays quiet next time). */
  paused?: boolean;
}

type Store = Record<string, Entry>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function persist(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable */
  }
}

let cache: Store | null = null;
function store(): Store {
  cache ??= load();
  return cache;
}

export function rememberPosition(key: string, seconds: number, paused = false): void {
  const s = store();
  if (seconds < MIN_RESUME_S && !paused) {
    if (s[key]) {
      delete s[key];
      persist(s);
    }
    return;
  }
  s[key] = { t: seconds, at: Date.now(), ...(paused ? { paused: true } : {}) };
  const keys = Object.keys(s);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => s[a]!.at - s[b]!.at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete s[k]);
  }
  persist(s);
}

export function recallPosition(key: string): number | null {
  const e = store()[key];
  return e && e.t >= MIN_RESUME_S ? e.t : null;
}

/** Was this clip left paused? (False when nothing is remembered.) */
export function recallPaused(key: string): boolean {
  return store()[key]?.paused === true;
}

export function forgetPosition(key: string): void {
  const s = store();
  if (s[key]) {
    delete s[key];
    persist(s);
  }
}

/**
 * Wire a media element to the memory: restore the stored position once
 * metadata is known (and, with `autoplay`, start it unless it was left
 * paused), save (throttled) while playing, note a pause the user made, and
 * forget when the clip plays to its natural end. A pause the app made itself
 * (off-screen hygiene, a hand-off to another player) is marked
 * `data-auto-paused` on the element first and does not count. Returns a
 * cleanup that also saves the final position and state (so unmounts don't
 * lose the last second).
 */
export function bindPlaybackMemory(
  el: HTMLMediaElement,
  key: string,
  opts: { restore?: boolean; autoplay?: boolean } = {},
): () => void {
  const doRestore = opts.restore !== false;
  let lastSave = 0;
  // What the user wants: remembered, then followed through play/pause events
  // (the element's own `paused` is unreliable at unmount and during hand-offs).
  let paused = recallPaused(key);
  // The last position seen while playing: teardown (a board closing, a source
  // revoked) resets currentTime to 0 and fires a pause; that is not the user
  // pausing, and the position it reports is not where they left off.
  let lastTime = 0;
  const tearingDown = () =>
    el.isConnected === false || (el.currentTime === 0 && lastTime >= MIN_RESUME_S && !el.ended);

  const restore = () => {
    if (doRestore) {
      const t = recallPosition(key);
      if (t !== null) {
        const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
        // Don't resume into the very tail (looks like a stuck ending).
        if (t < dur - 2) {
          try {
            el.currentTime = t;
          } catch {
            /* not seekable yet */
          }
        }
      }
    }
    if (opts.autoplay && !paused) void el.play()?.catch(() => {});
  };
  if (el.readyState >= 1) restore();
  else el.addEventListener('loadedmetadata', restore, { once: true });

  const onTime = () => {
    lastTime = el.currentTime;
    const now = Date.now();
    if (now - lastSave < 1000) return;
    lastSave = now;
    rememberPosition(key, el.currentTime, paused);
  };
  const onPlay = () => {
    clearTimeout(pendingPause);
    paused = false;
    rememberPosition(key, el.currentTime, false);
  };
  // A pause counts as the user's only once the element is still there a
  // moment later: a board closing or a source going away pauses the element
  // too, with teardown following within the tick.
  let pendingPause: ReturnType<typeof setTimeout> | undefined;
  const onPause = () => {
    // Before metadata (a source being set or swapped) the element pauses on
    // its own; only a pause of something playable can be the user's.
    if (el.readyState === 0 || tearingDown()) return;
    rememberPosition(key, el.currentTime, paused);
    if (el.dataset.autoPaused) return;
    clearTimeout(pendingPause);
    pendingPause = setTimeout(() => {
      pendingPause = undefined;
      if (!el.paused || tearingDown() || el.readyState === 0) return;
      paused = true;
      rememberPosition(key, el.currentTime, true);
    }, PAUSE_SETTLE_MS);
  };
  const onEmptied = () => clearTimeout(pendingPause);
  // Leaving the page (a reload, a closed tab) right after pausing: the pause
  // stands, so settle it now rather than lose it with the timer.
  const onPageHide = () => {
    if (pendingPause === undefined) return;
    clearTimeout(pendingPause);
    pendingPause = undefined;
    if (el.paused && el.isConnected && el.readyState > 0) {
      paused = true;
      rememberPosition(key, el.currentTime, true);
    }
  };
  const win = typeof window === 'undefined' ? null : window;
  win?.addEventListener('pagehide', onPageHide);
  const onEnded = () => {
    paused = false;
    forgetPosition(key);
  };
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('emptied', onEmptied);
  el.addEventListener('ended', onEnded);

  return () => {
    el.removeEventListener('loadedmetadata', restore);
    el.removeEventListener('timeupdate', onTime);
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('emptied', onEmptied);
    el.removeEventListener('ended', onEnded);
    win?.removeEventListener('pagehide', onPageHide);
    clearTimeout(pendingPause);
    // An element that never had a source (the binding before the asset
    // arrived) has nothing to say; otherwise the last position, and the
    // pause only if it was the user's.
    const t = el.currentTime > 0 ? el.currentTime : lastTime;
    if (t > 0) rememberPosition(key, t, paused);
    else if (paused && el.readyState > 0) rememberPosition(key, 0, true);
  };
}
