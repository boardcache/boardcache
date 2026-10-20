import { create } from 'zustand';

/**
 * Live collaboration session state for a TEAM board (server-readable class).
 * `active` gates everything: patch mirroring, persistence bypass, presence.
 */
export interface ChatMessage {
  id: string;
  name: string;
  color: string;
  role: 'owner' | 'editor' | 'guest';
  text: string;
  at: string;
  /** Sender's account id (members only) — resolves their avatar. */
  userId?: string | null;
}

export interface RemoteBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface CollabPeer {
  id: string;
  name: string;
  color: string;
  role: 'owner' | 'editor' | 'guest';
  cursor: { x: number; y: number } | null;
  selection: string[];
  /** Item this peer is viewing fullscreen (lightbox), if any. */
  lightbox?: string | null;
  /** Account members with an uploaded avatar (room avatar route serves it). */
  hasAvatar?: boolean;
  /** Page (sheet) this peer is on; null/absent = the first page. */
  page?: string | null;
}

type CollabStatus = 'off' | 'connecting' | 'online' | 'reconnecting';

interface CollabState {
  status: CollabStatus;
  boardId: string | null;
  role: 'owner' | 'editor' | 'guest' | null;
  self: CollabPeer | null;
  peers: Record<string, CollabPeer>;
  guestSlug: string | null;
  members: { userId: string; username: string; role: string }[];
  /** Asset ids currently downloading from the room (drives loading boxes). */
  fetchingAssets: Record<string, true>;
  /** Live drag previews from peers: itemId → bounds (tagged by owner peer). */
  remoteOverrides: Record<string, { peer: string; bounds: RemoteBounds }>;
  /** Live text-editing previews from peers: itemId → draft text. */
  remoteDrafts: Record<string, { peer: string; text: string }>;
  /** Team chat: rolling history + unread count while the window is closed. */
  chat: ChatMessage[];
  chatOpen: boolean;
  chatUnread: number;

  set: (patch: Partial<CollabState>) => void;
  setAssetFetching: (id: string, on: boolean) => void;
  /** Replace a peer's live gesture (null clears everything they held). */
  setPeerGesture: (peer: string, overrides: Record<string, RemoteBounds> | null) => void;
  setPeerDraft: (peer: string, itemId: string, text: string | null) => void;
  clearPeerDrafts: (peer: string) => void;
  setChat: (messages: ChatMessage[]) => void;
  appendChat: (message: ChatMessage) => void;
  setChatOpen: (open: boolean) => void;
  upsertPeer: (peer: CollabPeer) => void;
  removePeer: (id: string) => void;
  reset: () => void;
}

const initial = {
  status: 'off' as CollabStatus,
  boardId: null,
  role: null,
  self: null,
  peers: {},
  guestSlug: null,
  members: [],
  fetchingAssets: {},
  remoteOverrides: {},
  remoteDrafts: {},
  chat: [],
  chatOpen: false,
  chatUnread: 0,
};

export const useCollabStore = create<CollabState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  setAssetFetching: (id, on) =>
    set((s) => {
      const fetchingAssets = { ...s.fetchingAssets };
      if (on) fetchingAssets[id] = true;
      else delete fetchingAssets[id];
      return { fetchingAssets };
    }),
  setPeerGesture: (peer, overrides) =>
    set((s) => {
      const remoteOverrides: CollabState['remoteOverrides'] = {};
      for (const [id, entry] of Object.entries(s.remoteOverrides)) {
        if (entry.peer !== peer) remoteOverrides[id] = entry;
      }
      if (overrides) {
        for (const [id, bounds] of Object.entries(overrides)) {
          remoteOverrides[id] = { peer, bounds };
        }
      }
      return { remoteOverrides };
    }),
  setPeerDraft: (peer, itemId, text) =>
    set((s) => {
      const remoteDrafts = { ...s.remoteDrafts };
      if (text === null) {
        if (remoteDrafts[itemId]?.peer === peer) delete remoteDrafts[itemId];
      } else {
        remoteDrafts[itemId] = { peer, text };
      }
      return { remoteDrafts };
    }),
  clearPeerDrafts: (peer) =>
    set((s) => {
      const remoteDrafts: CollabState['remoteDrafts'] = {};
      for (const [id, d] of Object.entries(s.remoteDrafts)) {
        if (d.peer !== peer) remoteDrafts[id] = d;
      }
      return { remoteDrafts };
    }),
  setChat: (chat) => set({ chat }),
  appendChat: (message) =>
    set((s) => {
      if (s.chat.some((m) => m.id === message.id)) return s;
      return {
        chat: [...s.chat.slice(-199), message],
        chatUnread: s.chatOpen ? 0 : s.chatUnread + 1,
      };
    }),
  setChatOpen: (chatOpen) => set(chatOpen ? { chatOpen, chatUnread: 0 } : { chatOpen }),
  upsertPeer: (peer) => set((s) => ({ peers: { ...s.peers, [peer.id]: peer } })),
  removePeer: (id) =>
    set((s) => {
      const peers = { ...s.peers };
      delete peers[id];
      const remoteOverrides: CollabState['remoteOverrides'] = {};
      for (const [oid, entry] of Object.entries(s.remoteOverrides)) {
        if (entry.peer !== id) remoteOverrides[oid] = entry;
      }
      return { peers, remoteOverrides };
    }),
  reset: () => set({ ...initial }),
}));

/** True while the open document is a live team board. */
export function collabActive(): boolean {
  return useCollabStore.getState().status !== 'off';
}
