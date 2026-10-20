/**
 * Invite links: `https://app/?invite=BC-XXXX-XXXX-XXXX`. The code is taken
 * off the URL at boot and kept until an account is created with it, so a
 * reload (or a tab opened later) still lands on a pre-filled sign-up form.
 */
const KEY = 'boardcache.invite';

/** Read `?invite=` off the address bar, remember it, and clean the URL.
 *  Returns the code only on the load that carried it: later loads just
 *  find it waiting in the sign-up form rather than being greeted by it. */
export function consumeInviteLink(): string | null {
  let code: string | null = null;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('invite');
    if (raw) {
      code = raw.trim().toUpperCase();
      url.searchParams.delete('invite');
      window.history.replaceState(window.history.state, '', url.toString());
      localStorage.setItem(KEY, code);
    }
  } catch {
    /* no storage or an odd URL: the form stays empty */
  }
  return code;
}

/** The remembered code, if any. */
export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Forget it (the account exists, or the user cleared the field). */
export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
