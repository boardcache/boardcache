import { focusAppWindow } from './platform';
import { localNotifyNow } from './iosNative';

/**
 * One system notification (task and project reminders). In a browser this is
 * the web Notification; in the desktop app the same call is delivered by the
 * operating system (Notification Centre, Windows toasts, libnotify). Clicking
 * it brings the app forward. Returns false when it could not be shown — not
 * permitted, unsupported, or the constructor threw — so callers can retry.
 */
export function systemNotify(
  title: string,
  opts: { body?: string; tag?: string; onClick?: () => void } = {},
): boolean {
  // The iOS shell has no web Notification; the system's own does the job.
  if (localNotifyNow(title, opts.body, opts.tag ?? title)) return true;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, {
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
    });
    n.onclick = () => {
      focusAppWindow();
      opts.onClick?.();
      n.close?.();
    };
    return true;
  } catch {
    return false; // constructor can throw in unsupported contexts
  }
}
