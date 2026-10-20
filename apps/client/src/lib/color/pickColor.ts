/** Color acquisition helpers: EyeDropper API with a picker-input fallback. */

interface EyeDropperResult {
  sRGBHex: string;
}

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<EyeDropperResult> };
  }
}

/** The EyeDropper spec hands back a `#rrggbb` string. */
const HEX6 = /^#[0-9a-f]{6}$/;

/** Normalize to a usable `#rrggbb` color, or null if it isn't one. */
function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  return HEX6.test(s) ? s : null;
}

export function supportsEyeDropper(): boolean {
  return typeof window !== 'undefined' && typeof window.EyeDropper === 'function';
}

type EyeDropperOutcome =
  | { status: 'picked'; hex: string }
  | { status: 'cancelled' }
  | { status: 'failed' };

/**
 * Open the EyeDropper. Returns 'cancelled' when the user dismisses it, and
 * 'failed' when the API resolves with an unusable value — which happens on some
 * Linux builds (notably Brave), where it can hand back a blank/garbage hex
 * instead of the sampled pixel, producing a colorless swatch.
 */
async function openEyeDropper(): Promise<EyeDropperOutcome> {
  if (!window.EyeDropper) return { status: 'failed' };
  let result: EyeDropperResult;
  try {
    result = await new window.EyeDropper().open();
  } catch {
    return { status: 'cancelled' }; // user pressed Escape
  }
  const hex = normalizeHex(result?.sRGBHex);
  return hex ? { status: 'picked', hex } : { status: 'failed' };
}

/** Native color input as a promise; resolves null when dismissed. */
export function pickColorViaInput(initial = '#4f8ef7'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = initial;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    const done = (value: string | null) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => done(input.value.toLowerCase()), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    input.click();
  });
}

/**
 * Pick a color: prefer the EyeDropper (sample any on-screen pixel), but fall
 * back to the native color input when the API is missing or returns an unusable
 * value — so a swatch is never created with an empty color. An explicit cancel
 * is respected (returns null without popping the fallback).
 */
export async function pickColorViaScreen(): Promise<string | null> {
  if (supportsEyeDropper()) {
    const outcome = await openEyeDropper();
    if (outcome.status === 'picked') return outcome.hex;
    if (outcome.status === 'cancelled') return null;
    // 'failed' → fall through to the reliable native input.
  }
  return pickColorViaInput();
}
