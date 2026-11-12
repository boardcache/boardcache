import { getSessionLock } from './boardLock';

/**
 * A locked board opened in one window stays openable in another of the
 * same browser profile without the password again: the window asked for
 * a board's key answers over a BroadcastChannel with the session key it
 * holds (a CryptoKey travels by structured clone, never as bytes). Nothing
 * answers for a board that is not open and unlocked somewhere.
 */
const CHANNEL = 'boardcache-lock';

type Ask = { ask: string; nonce: string };
type Answer = { answer: string; nonce: string; key: CryptoKey };

let channel: BroadcastChannel | null = null;
function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

let started = false;
/** Mount once: answer other windows' requests for keys this one holds. */
export function startLockHandover(): void {
  if (started) return;
  started = true;
  const ch = open();
  if (!ch) return;
  ch.addEventListener('message', (e: MessageEvent<Ask | Answer>) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || !('ask' in msg)) return;
    const lock = getSessionLock(msg.ask);
    if (lock) ch.postMessage({ answer: msg.ask, nonce: msg.nonce, key: lock.key } satisfies Answer);
  });
}

/** Ask the other windows for a board's key; null when none answers in time. */
export function requestLockKey(boardId: string, timeoutMs = 500): Promise<CryptoKey | null> {
  const ch = open();
  if (!ch) return Promise.resolve(null);
  const nonce = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const done = (key: CryptoKey | null) => {
      clearTimeout(timer);
      ch.removeEventListener('message', onMessage);
      resolve(key);
    };
    const onMessage = (e: MessageEvent<Ask | Answer>) => {
      const msg = e.data;
      if (msg && typeof msg === 'object' && 'answer' in msg && msg.nonce === nonce) done(msg.key);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    ch.addEventListener('message', onMessage);
    ch.postMessage({ ask: boardId, nonce } satisfies Ask);
  });
}
