import { create } from 'zustand';

/**
 * App updates: the service worker is registered in 'prompt' mode, so a newer
 * build waits until the user asks for it. (Auto-update reloaded the page the
 * moment a new worker took control — mid-gesture on phones after a deploy.)
 */
export const useAppUpdate = create<{
  ready: boolean;
  apply: (() => void) | null;
  setReady: (apply: () => void) => void;
}>((set) => ({
  ready: false,
  apply: null,
  setReady: (apply) => set({ ready: true, apply }),
}));

export function initAppUpdate(): void {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return;
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          useAppUpdate.getState().setReady(() => {
            // update(true) tells the waiting worker to take over and reloads
            // on controllerchange. Some browsers (Brave with Shields, a
            // worker that already took over in another tab) never fire it,
            // so the page reloads itself after a moment regardless.
            const fallback = setTimeout(() => window.location.reload(), 1500);
            void update(true).finally(() => clearTimeout(fallback));
          });
        },
      });
    })
    .catch(() => {
      /* no service worker in this build */
    });
}
