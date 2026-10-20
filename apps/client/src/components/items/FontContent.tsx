import { useEffect, useRef, useState } from 'react';
import type { FontItem } from '@boardcache/schema';
import { ensureFont } from '../../lib/media/fontRegistry';

const PANGRAM = 'The quick brown fox jumps over the lazy dog';

/** Design width of the specimen layout; the card scales as one unit from
 *  this, so resizing the box scales all type proportionally. */
const BASE_WIDTH = 320;

/** Typeface specimen card: the file's family rendered at several sizes. */
export function FontContent({ item }: { item: FontItem }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Live box size: during a resize drag the DOM box changes before the
  // document commits, so deriving scale from the doc made contents jump on
  // release. Observing the rendered box scales them in real time.
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setLive({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    void ensureFont(item.family, item.assetId).then((ok) => {
      if (!alive) return;
      if (ok) setReady(true);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [item.family, item.assetId]);

  const family = `'${item.family.replace(/'/g, '')}'`;
  const width = live?.w ?? item.width;
  const height = live?.h ?? item.height;
  const scale = width / BASE_WIDTH;

  return (
    <div className="font-card" data-testid="font-card" ref={rootRef}>
      <div
        className="font-card-scale"
        data-testid="font-card-scale"
        style={{
          width: BASE_WIDTH,
          height: height / scale,
          transform: `scale(${scale})`,
        }}
      >
        <div className="font-card-name">{item.family}</div>
        {failed ? (
          <div className="font-card-missing">Font file missing</div>
        ) : (
          <div
            className={`font-card-specimen${ready ? '' : ' loading'}`}
            style={ready ? { fontFamily: family } : undefined}
          >
            <div className="font-card-preview" data-testid="font-card-preview">
              {item.previewText}
            </div>
            <div className="font-card-numbers">0123456789</div>
            <div className="font-card-pangram">{PANGRAM}</div>
            <div className="font-card-glyphs">
              ABCDEFGHIJKLMNOPQRSTUVWXYZ
              <br />
              abcdefghijklmnopqrstuvwxyz
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
