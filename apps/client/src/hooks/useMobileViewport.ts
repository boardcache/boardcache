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
