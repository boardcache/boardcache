import { useEffect, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { resolveMediaSrc } from '../../lib/sync/apiBase';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src: string;
  /** The image could not be loaded (a refused or missing asset). */
  onError?: () => void;
};

/**
 * An <img> for a URL on the sync or community server. In a browser it is the
 * plain tag; in the shells, where requests sign in with a bearer token the
 * tag cannot carry, the bytes come through an authenticated fetch (see
 * resolveMediaSrc). Nothing renders until the source is known, and nothing
 * renders when it fails: a broken-image glyph is never the right answer.
 */
export function AuthedImg({ src, onError, ...rest }: Props) {
  // Keyed by the URL it was resolved for, so a changed src renders nothing
  // (not the previous image) until its own resolution lands.
  const [state, setState] = useState<{ url: string; src: string | null }>({ url: '', src: null });
  useEffect(() => {
    let live = true;
    void resolveMediaSrc(src).then((r) => {
      if (!live) return;
      setState({ url: src, src: r });
      if (r === null) onError?.();
    });
    return () => {
      live = false;
    };
    // onError is a callback prop; the fetch is keyed on the URL alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  if (state.url !== src || state.src === null) return null;
  return (
    <img
      {...rest}
      src={state.src}
      onError={() => {
        setState({ url: src, src: null });
        onError?.();
      }}
    />
  );
}
