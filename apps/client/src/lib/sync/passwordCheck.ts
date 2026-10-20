/**
 * Breached-password check at registration via the Pwned Passwords range
 * API (k-anonymity: only the first five hex characters of the SHA-1 leave
 * the browser, with padding requested so response sizes reveal nothing).
 * Fails OPEN: when the service is unreachable the password is accepted —
 * the check is a guard against the worst choices, not a gate on sign-up.
 */
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Number of times the password appears in known breaches (0 = not found or check unavailable). */
export async function breachCount(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  try {
    const hash = await sha1Hex(password);
    const res = await fetchImpl(`${RANGE_URL}${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return 0;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [sfx, count] = line.trim().split(':');
      if (sfx === suffix) return Number(count ?? 0) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
