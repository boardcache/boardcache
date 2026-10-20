import type { BackgroundImage } from '@boardcache/schema';

/** CSS for a background image's fit mode — shared by canvas and group layers. */
export function bgImageCss(mode: BackgroundImage['mode']): React.CSSProperties {
  switch (mode) {
    case 'contain':
      return {
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      };
    case 'tile':
      return { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'top left' };
    case 'center':
      return {
        backgroundSize: 'auto',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      };
    default:
      return {
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      };
  }
}
