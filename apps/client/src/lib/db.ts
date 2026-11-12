import type { Kdf } from '@boardcache/e2ee';
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { migrateMediaPerBoard } from './board/mediaMigration';

/**
 * Client storage: one store for board documents, one for media blobs
 * (architectural rule: media lives outside the document, §3.3).
 */
export interface BoardcacheDB extends DBSchema {
  boards: {
    key: string; // board id (uuid)
    value: {
      id: string;
      /** Raw document object; validated with the shared schema on load.
       *  null while the board is password-locked (see `lock`). */
      doc: unknown;
      /** Denormalized for the library list (no doc parse needed). */
      name: string;
      updatedAt: string;
      thumbnail?: Blob;
      /** Theme-aware previews (thumbnail stays as a legacy fallback). */
      thumbnailLight?: Blob;
      thumbnailDark?: Blob;
      /** Estimated on-disk size in bytes (document + referenced assets). */
      size?: number;
      /** Lazy sync: listed from the account's meta envelope, NOT downloaded
       *  yet (doc is null; opening or Download pulls the real board). */
      remote?: boolean;
      /** A board kept in the board folder on disk (lib/vault), cached here
       *  only while it is open; never a library board, never listed. */
      vault?: true;
      /** The remote (undownloaded) board is password-locked. */
      remoteLocked?: boolean;
      /** Stubbed synced template (meta.isTemplate) — shows in My Templates. */
      remoteTemplate?: boolean;
      /** Password lock: the document is stored AES-GCM encrypted with the
       *  board's media key, which the password-derived key wraps (`key`).
       *  Locks from before 2026-11 have no `key`: the password-derived key
       *  encrypted the document and media directly. */
      lock?: {
        salt: string; // base64 salt for the password derivation
        /** Which derivation made the key: absent = PBKDF2 (locks from before
         *  2026-10), 'argon2id-v1' for locks made since. */
        kdf?: Kdf;
        /** base64 iv|ciphertext of the media key under the password key. */
        key?: string;
        doc: string; // base64 iv|ciphertext of the JSON document
        /** Referenced asset ids (plaintext hashes) — lets sync move a locked
         *  board's media without ever reading the document. */
        assets?: string[];
      };
      /** The media key of a board that was locked before and is open now
       *  (base64 raw). The next lock wraps this same key, so media sealed
       *  under an earlier lock — on the server, on another device — opens
       *  again with it. Nothing an unlocked board stores is secret from it. */
      mediaKey?: string;
    };
  };
  /**
   * Media, one copy per board: keyed by (board id, sha-256 of the plaintext
   * bytes). A board's media is exactly the records under its id — deleting
   * the board deletes them, locking it seals them — and the hash keeps one
   * record per distinct file within a board.
   */
  media: {
    key: [string, string];
    value: {
      board: string;
      hash: string;
      /** Plain media bytes — or iv|ciphertext of packAsset(mime, bytes) when
       *  `locked` is set (sealed with the board's media key). */
      blob: Blob;
      mime: string;
      bytes: number;
      locked?: true;
    };
    indexes: { byHash: string };
  };
  /** The store media lived in before it was kept per board (one record per
   *  hash, shared by every board). Emptied by the one-time migration on
   *  open; kept only so that migration can read it. */
  assets: {
    key: string;
    value: {
      hash: string;
      blob: Blob;
      mime: string;
      bytes: number;
      lock?: { boardId: string };
    };
  };
  /**
   * Small key/value store for sync secrets — currently the unwrapped account
   * data key (a NON-extractable CryptoKey, so its bytes can't be read out even
   * by injected script). Out-of-line keys (e.g. 'adk').
   */
  keys: {
    key: string;
    value: CryptoKey;
  };
  /** Per-board sync state for boards opted into cloud sync. */
  sync: {
    key: string; // board id
    value: {
      id: string;
      /** Last server revision we're based on (0 = never pushed). */
      rev: number;
      /** Local content changed since the last successful push. */
      dirty: boolean;
      /** Synced board deleted locally; needs a server tombstone. */
      deleted?: boolean;
    };
  };
  /** Small key/value store for app metadata — currently the library
   *  organization (folders, board tags, manual order). Out-of-line keys. */
  meta: {
    key: string;
    value: unknown;
  };
  /** Cached expensive text extractions for board search (PDF text layers,
   *  HTML-embed bodies), keyed by item id; `hash` is the content signature
   *  the text was extracted from. Purely a local cache — never synced. */
  extract: {
    key: string;
    value: { hash: string; text: string };
  };
  /** Semantic-search chunk embeddings, keyed by item id (see semanticIndex).
   *  Versioned by content signature + model; local cache, never synced. */
  vectors: {
    key: string;
    value: {
      key: string;
      model: string;
      dims: number;
      chunks: { text: string; vec: ArrayBuffer }[];
    };
  };
  /** CLIP image embeddings, keyed by item id (see clipIndex). `key` is the
   *  asset id the vector was computed from, `board` the board the item was
   *  on (absent in records from before clip routing read the whole store);
   *  local cache, never synced. */
  clipVectors: {
    key: string;
    value: { key: string; model: string; dims: number; vec: ArrayBuffer; board?: string };
  };
}

let dbPromise: Promise<IDBPDatabase<BoardcacheDB>> | null = null;

/** Every media record of one board: the key range under its id. */
export const mediaRange = (board: string): IDBKeyRange =>
  IDBKeyRange.bound([board, ''], [board, '\uffff']);

function createStores(db: IDBPDatabase<BoardcacheDB>): void {
  if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'hash' });
  if (!db.objectStoreNames.contains('media')) {
    const media = db.createObjectStore('media', { keyPath: ['board', 'hash'] });
    media.createIndex('byHash', 'hash');
  }
  if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
  if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
  if (!db.objectStoreNames.contains('extract')) db.createObjectStore('extract');
  if (!db.objectStoreNames.contains('vectors')) db.createObjectStore('vectors');
  if (!db.objectStoreNames.contains('clipVectors')) db.createObjectStore('clipVectors');
}

/** One-time copy from the pre-rebrand "refboard" database. The legacy DB is
 *  left in place as a fallback; it's never written again. */
async function migrateLegacyDb(db: IDBPDatabase<BoardcacheDB>): Promise<void> {
  if ((await db.count('boards')) > 0) return; // already have data
  const names = (await indexedDB.databases?.().catch(() => []))?.map((d) => d.name) ?? [];
  if (!names.includes('refboard')) return;
  const legacy = await openDB<BoardcacheDB>('refboard', 4, { upgrade: createStores });
  try {
    let copied = 0;
    for (const store of ['boards', 'assets', 'sync'] as const) {
      for (const record of await legacy.getAll(store)) {
        await db.put(store, record as never);
        copied++;
      }
    }
    for (const store of ['keys', 'meta'] as const) {
      const keys = await legacy.getAllKeys(store);
      for (const key of keys) {
        const value = await legacy.get(store, key as never);
        if (value !== undefined) {
          await db.put(store, value as never, key as never);
          copied++;
        }
      }
    }
    if (copied > 0)
      console.info(`boardCache: migrated ${copied} records from the RefBoard database.`);
  } finally {
    legacy.close();
  }
}

/** Copy pre-rebrand "refboard:*" localStorage prefs to their new keys. */
function migrateLegacyPrefs(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('refboard:')) continue;
      const next = `boardcache:${key.slice('refboard:'.length)}`;
      if (localStorage.getItem(next) === null) {
        localStorage.setItem(next, localStorage.getItem(key)!);
      }
    }
  } catch {
    /* storage unavailable */
  }
}

/** An open request that never settles (seen on iOS right after the app
 *  wakes) must fail so the caller can reset and try again. */
const OPEN_TIMEOUT_MS = 10_000;

// ── Blobs where the browser refuses them ──
// Safari in private browsing (and some content-blocker setups) rejects any
// IndexedDB write that holds a Blob or File ("Error preparing Blob/File data
// to be stored in object store"), while plain bytes store fine. Thumbnails
// and media are Blobs, so creating a board or adding an image silently
// failed there. The handle below retries such a write with each Blob frozen
// to its bytes and type, and thaws them on the way back out. Only top-level
// fields ever hold Blobs (board thumbnails, an asset's blob), so the walk is
// shallow and cheap.

const FROZEN = '__boardcacheBlob';
interface FrozenBlob {
  [FROZEN]: true;
  type: string;
  data: ArrayBuffer;
}
type Row = Record<string, unknown>;

/** Once a write was refused for its Blobs, every later write freezes first. */
let blobsRefused = false;

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFrozen = (v: unknown): v is FrozenBlob => isRow(v) && v[FROZEN] === true;
const holdsBlob = (v: unknown): boolean =>
  isRow(v) && Object.values(v).some((x) => x instanceof Blob);
const isBlobRefusal = (err: unknown): boolean =>
  /Blob\/File/i.test(String((err as { message?: unknown })?.message ?? err));

async function freeze(value: unknown): Promise<unknown> {
  if (!holdsBlob(value)) return value;
  const out: Row = { ...(value as Row) };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Blob) {
      const frozen: FrozenBlob = { [FROZEN]: true, type: v.type, data: await v.arrayBuffer() };
      out[k] = frozen;
    }
  }
  return out;
}

function thaw<T>(value: T): T {
  if (!isRow(value)) return value;
  let out: Row | null = null;
  for (const [k, v] of Object.entries(value)) {
    if (isFrozen(v)) {
      out ??= { ...value };
      out[k] = new Blob([v.data], { type: v.type });
    }
  }
  return (out ?? value) as T;
}

/** The database handle with the Blob fallback on put, get and getAll. */
function withBlobFallback(db: IDBPDatabase<BoardcacheDB>): IDBPDatabase<BoardcacheDB> {
  type AnyFn = (...args: unknown[]) => unknown;
  const raw = db as unknown as Record<string, AnyFn>;
  const put = async (store: string, value: unknown, key?: unknown) => {
    if (!blobsRefused) {
      try {
        return await raw.put!(store, value, key);
      } catch (err) {
        if (!holdsBlob(value) || !isBlobRefusal(err)) throw err;
        blobsRefused = true;
        console.warn('boardCache: this browser refuses Blobs in IndexedDB; storing bytes instead.');
      }
    }
    return raw.put!(store, await freeze(value), key);
  };
  const get = async (store: string, key: unknown) => thaw(await raw.get!(store, key));
  const getAll = async (store: string, query?: unknown, count?: unknown) =>
    ((await raw.getAll!(store, query, count)) as unknown[]).map(thaw);
  const getAllFromIndex = async (store: string, index: string, query?: unknown, count?: unknown) =>
    ((await raw.getAllFromIndex!(store, index, query, count)) as unknown[]).map(thaw);
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'put') return put;
      if (prop === 'get') return get;
      if (prop === 'getAll') return getAll;
      if (prop === 'getAllFromIndex') return getAllFromIndex;
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === 'function' ? (v as AnyFn).bind(target) : v;
    },
  });
}

export function getDb(): Promise<IDBPDatabase<BoardcacheDB>> {
  dbPromise ??= (async () => {
    migrateLegacyPrefs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('IndexedDB did not open in time')),
        OPEN_TIMEOUT_MS,
      );
    });
    const db = await Promise.race([
      openDB<BoardcacheDB>('boardcache', 8, {
        upgrade: createStores,
        // iOS Safari severs the page's IndexedDB connection after the tab
        // sleeps in the background — drop the cached handle so the NEXT call
        // reopens instead of failing forever on a dead connection.
        terminated: () => {
          dbPromise = null;
        },
      }),
      timeout,
    ]).finally(() => clearTimeout(timer));
    await migrateLegacyDb(db);
    const wrapped = withBlobFallback(db);
    await migrateMediaPerBoard(wrapped);
    return wrapped;
  })().catch((err) => {
    dbPromise = null; // a failed open must not poison every later call
    throw err;
  });
  return dbPromise;
}

/**
 * Is the cached connection still alive? A cheap read with a short deadline;
 * a dead or hung handle is dropped so the next call reopens. Called when the
 * app comes back to the foreground, where iOS tends to have severed it.
 */
export async function probeDb(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().then((db) => db.count('meta')),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IndexedDB probe timed out')), 3000);
      }),
    ]);
    return true;
  } catch {
    resetDb();
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Drop the cached connection — for recovery after an operation failed on a
 *  handle that died WITHOUT firing `terminated` (seen on iOS). The next
 *  getDb() opens fresh; legacy migrations are idempotent. */
export function resetDb(): void {
  const stale = dbPromise;
  dbPromise = null;
  void stale
    ?.then((db) => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    })
    .catch(() => undefined);
}
