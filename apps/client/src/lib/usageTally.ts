/**
 * Opt-in usage tally: which features get used, as counts. Off by default.
 *
 * The rules that make this compatible with "nothing leaves your device":
 *  - Counts only. Never board content, names, text, prompts, URLs or ids.
 *  - Keyed by a random install id made here, unrelated to any account.
 *  - Accumulated locally and posted once a day (or when 50 events pile up)
 *    to this app's own server, never a third party.
 *  - Readable before it goes: `pendingUsageTally()` feeds the Settings
 *    panel so the user sees exactly what the next send contains.
 */
import { apiFetch, hasSyncServer } from './sync/apiBase';

const ENABLED_KEY = 'boardcache.usage.enabled';
const INSTALL_KEY = 'boardcache.usage.install';
const TALLY_KEY = 'boardcache.usage.tally';
const SENT_KEY = 'boardcache.usage.sentAt';
const SEND_EVERY_MS = 24 * 60 * 60 * 1000;
const SEND_AT_EVENTS = 50;

type Tally = Record<string, number>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: counts are simply lost */
  }
}

export function usageTallyEnabled(): boolean {
  return read<boolean>(ENABLED_KEY, false) === true;
}

/** Flip the setting. Turning it off discards whatever was waiting to send. */
export function setUsageTallyEnabled(on: boolean): void {
  write(ENABLED_KEY, on);
  if (!on) {
    try {
      localStorage.removeItem(TALLY_KEY);
    } catch {
      /* ignore */
    }
  }
}

function installId(): string {
  let id = read<string | null>(INSTALL_KEY, null);
  if (!id) {
    id = crypto.randomUUID();
    write(INSTALL_KEY, id);
  }
  return id;
}

/** What the next send would contain, for the settings panel. */
export function pendingUsageTally(): Tally {
  return read<Tally>(TALLY_KEY, {});
}

/**
 * Count one event. `key` is a fixed, enumerable feature name such as
 * `item.add.image` or `export.dossier`; callers must never interpolate user
 * data into it.
 */
export function tally(key: string): void {
  if (!usageTallyEnabled()) return;
  if (!/^[a-z0-9_.-]{1,64}$/.test(key)) return; // a typo, not a leak
  const t = pendingUsageTally();
  t[key] = (t[key] ?? 0) + 1;
  write(TALLY_KEY, t);
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  if (total >= SEND_AT_EVENTS) void flushUsageTally();
}

/** Post the tally if it is due; called at boot and after a burst. */
export async function flushUsageTally(force = false): Promise<void> {
  if (!usageTallyEnabled()) return;
  const t = pendingUsageTally();
  if (Object.keys(t).length === 0) return;
  const last = read<number>(SENT_KEY, 0);
  if (!force && Date.now() - last < SEND_EVERY_MS) {
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    if (total < SEND_AT_EVENTS) return;
  }
  try {
    if (!hasSyncServer()) return; // nowhere to send; the counts stay local
    const res = await apiFetch('/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        install: installId(),
        build: String(import.meta.env.VITE_BUILD_ID ?? 'dev'),
        counts: t,
      }),
      keepalive: true,
    });
    if (!res.ok) return; // keep the counts; try again later
    write(TALLY_KEY, {});
    write(SENT_KEY, Date.now());
  } catch {
    /* offline: the counts wait */
  }
}
