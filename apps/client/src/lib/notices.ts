import { create } from 'zustand';

/**
 * Lightweight app notices: non-blocking messages for boundary/limitation
 * awareness (oversize media, storage-full autosave failures, …). Not a
 * dialog — a dismissible strip that never steals focus. Sticky notices stay
 * until dismissed by code (e.g. autosave recovering) or the user.
 */

export interface NoticeAction {
  label: string;
  /** App path to open (the notice dismisses itself). */
  path: string;
}

interface AppNotice {
  id: string;
  text: string;
  kind: 'warn' | 'info';
  sticky: boolean;
  action?: NoticeAction;
}

interface NoticeState {
  notices: AppNotice[];
}

export const useNotices = create<NoticeState>(() => ({ notices: [] }));

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function dismissNotice(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  useNotices.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

export function showNotice(
  text: string,
  opts: {
    id?: string;
    kind?: 'warn' | 'info';
    sticky?: boolean;
    timeoutMs?: number;
    action?: NoticeAction;
  } = {},
): string {
  const id = opts.id ?? `n-${Math.random().toString(36).slice(2)}`;
  const notice: AppNotice = {
    id,
    text,
    kind: opts.kind ?? 'warn',
    sticky: opts.sticky ?? false,
    ...(opts.action ? { action: opts.action } : {}),
  };
  useNotices.setState((s) => ({
    notices: [...s.notices.filter((n) => n.id !== id), notice],
  }));
  const t = timers.get(id);
  if (t) clearTimeout(t);
  if (!notice.sticky) {
    timers.set(
      id,
      setTimeout(() => dismissNotice(id), opts.timeoutMs ?? 10_000),
    );
  }
  return id;
}
