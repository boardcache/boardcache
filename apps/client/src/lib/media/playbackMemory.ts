/**
 * Per-device memory of where playback left off, keyed by item+asset. Lives in
 * localStorage (like scroll position — device state, not document content), so
 * leaving the board, switching views, or reloading the app resumes media where
 * it stopped. Entries are pruned oldest-first past a cap; a clip that plays to
 * its end forgets its position so it restarts cleanly.
 */
const KEY = 'boardcache:playbackPositions';
const MAX_ENTRIES = 300;
/** Ignore trailing/leading slivers: resume only meaningful positions. */
const MIN_RESUME_S = 1;

interface Entry {
  t: number;
  at: number;
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

export function rememberPosition(key: string, seconds: number): void {
  const s = store();
  if (seconds < MIN_RESUME_S) {
    if (s[key]) {
      delete s[key];
      persist(s);
    }
    return;
  }
  s[key] = { t: seconds, at: Date.now() };
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

export function forgetPosition(key: string): void {
  const s = store();
  if (s[key]) {
    delete s[key];
    persist(s);
  }
}

/**
 * Wire a media element to the memory: restore the stored position once
 * metadata is known, save (throttled) while playing, and forget when the clip
 * plays to its natural end. Returns a cleanup that also saves the final
 * position (so unmounts don't lose the last second).
 */
export function bindPlaybackMemory(
  el: HTMLMediaElement,
  key: string,
  opts: { restore?: boolean } = {},
): () => void {
  const doRestore = opts.restore !== false;
  let lastSave = 0;

  const restore = () => {
    if (!doRestore) return;
    const t = recallPosition(key);
    if (t === null) return;
    const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
    // Don't resume into the very tail (looks like a stuck ending).
    if (t < dur - 2) {
      try {
        el.currentTime = t;
      } catch {
        /* not seekable yet */
      }
    }
  };
  if (el.readyState >= 1) restore();
  else el.addEventListener('loadedmetadata', restore, { once: true });

  const onTime = () => {
    const now = Date.now();
    if (now - lastSave < 1000) return;
    lastSave = now;
    rememberPosition(key, el.currentTime);
  };
  const onPause = () => rememberPosition(key, el.currentTime);
  const onEnded = () => forgetPosition(key);
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onEnded);

  return () => {
    el.removeEventListener('loadedmetadata', restore);
    el.removeEventListener('timeupdate', onTime);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onEnded);
    if (el.currentTime > 0) rememberPosition(key, el.currentTime);
  };
}
