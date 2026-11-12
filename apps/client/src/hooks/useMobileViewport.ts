import { useSyncExternalStore } from 'react';
import { MOBILE_MEDIA_QUERY } from '../lib/mobile';

const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const read = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches;

/** True on the mobile experience (same query as `isMobileViewport`), re-rendering on rotation. */
export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

const PHONE_QUERY = '(max-width: 760px)';
const subscribePhone = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const readPhone = () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;

/** True on PHONES only (same 760px line as `isPhoneViewport`), re-rendering on rotation. */
export function usePhoneViewport(): boolean {
  return useSyncExternalStore(subscribePhone, readPhone, () => false);
}

const NARROW_QUERY = '(max-width: 760px) and (orientation: portrait)';
const subscribeNarrow = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const readNarrow = () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;

/** True on a phone held upright: too narrow for two panes side by side. */
export function useNarrowPortrait(): boolean {
  return useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
}
