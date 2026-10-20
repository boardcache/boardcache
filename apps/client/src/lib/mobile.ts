/**
 * Small-screen check for mobile-specific behavior (breakpoint matches the
 * @media rules in src/styles). Mobile is a view-first experience: the canvas
 * is pan/zoom-only — touch never edits; the gallery is one tap away.
 */
/** Matches the mobile-experience @media condition in src/styles — keep the
 *  two in sync. Phones by width; tablets (iPad, Android — touch with no
 *  hover) at their native resolution. */
export const MOBILE_MEDIA_QUERY =
  '(max-width: 760px), ((hover: none) and (pointer: coarse) and (max-width: 1400px))';

/** TRUE PHONES only (width): tablets get desktop menus/dialogs where room
 *  allows, while keeping the mobile view-first canvas experience. */
export const isPhoneViewport = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

export const isMobileViewport = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches;

/**
 * Apple touch device (iPhone, iPod, iPad — including iPadOS, which reports
 * itself as "MacIntel" but exposes multiple touch points). Radix's modal
 * layers have repeatedly presented invisibly on these devices while eating
 * every tap, so dialogs route around Radix here regardless of screen size.
 */
export const isAppleTouch = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

/**
 * Screen capture (share / record / screenshot) rides on getDisplayMedia,
 * which iOS Safari doesn't implement. Feature-detected, not UA-sniffed —
 * platforms that gain it light the features up automatically.
 */
export const canCaptureScreen = (): boolean =>
  typeof navigator.mediaDevices?.getDisplayMedia === 'function';

/** Inside a native shell (Capacitor, iOS or Android): the bridge says so. */
export const isNativeShell = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location.protocol === 'capacitor:' ||
    Boolean(
      (
        window as { Capacitor?: { isNativePlatform?: () => boolean } }
      ).Capacitor?.isNativePlatform?.(),
    ));

/** Which shell: 'ios', 'android', or null on the web and desktop. */
export const shellPlatform = (): 'ios' | 'android' | null => {
  if (!isNativeShell()) return null;
  const p = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return p === 'android' ? 'android' : 'ios';
};

/**
 * Whether the app may show plans, prices and checkout at all. The native
 * shells show none of it (App Store and Play rules on purchases made outside
 * the store); accounts bought on the web still sign in and work there.
 */
export const canPurchase = (): boolean => !isNativeShell();
