import { useEffect, useMemo, useRef } from 'react';
import { useSessionStore } from '../../state/sessionStore';

/**
 * SPA 404 as a tiny boardCache board: the digits 404 assemble from dozens of
 * miniature board items (photos, swatches, sticky notes, text cards) that
 * spring in from the edges, then idle-float on a canvas grid. The pointer —
 * and a lost ghost collaborator wandering the page — push pieces aside with
 * a springy return. Pure transforms in one rAF loop; honors reduced motion.
 *
 * Board links that fail to OPEN still fall back to the library — a synced
 * board that isn't pulled yet is not a 404.
 */

const DIGITS: Record<string, string[]> = {
  '4': ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};
const TEXT = '404';
const COLS = TEXT.length * 5 + (TEXT.length - 1); // digits + 1-cell gaps
const ROWS = 7;

/** Deterministic PRNG so StrictMode double-renders build the same board. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = 'photo' | 'swatch' | 'note' | 'text';
const KINDS: Kind[] = ['photo', 'swatch', 'photo', 'text', 'swatch', 'note'];

interface Piece {
  col: number;
  row: number;
  kind: Kind;
  hue: number;
  /** Resting rotation (deg) + float phase/speed. */
  rot: number;
  phase: number;
  speed: number;
  /** Physics state (offsets from home, px). */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

function buildPieces(): Piece[] {
  const rand = mulberry32(404);
  const pieces: Piece[] = [];
  let colBase = 0;
  for (const ch of TEXT) {
    const rows = DIGITS[ch]!;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < 5; c++) {
        if (rows[r]![c] !== '1') continue;
        pieces.push({
          col: colBase + c,
          row: r,
          kind: KINDS[pieces.length % KINDS.length]!,
          hue: Math.floor(rand() * 360),
          rot: (rand() - 0.5) * 14,
          phase: rand() * Math.PI * 2,
          speed: 0.6 + rand() * 0.9,
          // Start scattered far away with a shove — the springs assemble it.
          ox: (rand() - 0.5) * 1600,
          oy: (rand() - 0.5) * 1200,
          vx: (rand() - 0.5) * 30,
          vy: (rand() - 0.5) * 30,
        });
      }
    }
    colBase += 6;
  }
  return pieces;
}

export function NotFoundScreen() {
  const pieces = useMemo(() => buildPieces(), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pieceRefs = useRef<(HTMLDivElement | null)[]>([]);

  const goHome = () => {
    history.replaceState(null, '', '/');
    useSessionStore.getState().setView('library');
  };
  const goCommunity = () => {
    history.replaceState(null, '', '/community');
    const s = useSessionStore.getState();
    s.setCommunityRoute(null);
    s.setView('community');
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Home positions from the stage size (recomputed on resize).
    let cell = 24;
    let originX = 0;
    let originY = 0;
    const layout = () => {
      const rect = stage.getBoundingClientRect();
      cell = Math.max(14, Math.min(34, rect.width / (COLS + 4), rect.height / (ROWS + 2)));
      originX = rect.width / 2 - (COLS * cell) / 2;
      originY = rect.height / 2 - (ROWS * cell) / 2;
      for (let i = 0; i < pieces.length; i++) {
        const el = pieceRefs.current[i];
        const p = pieces[i]!;
        if (!el) continue;
        el.style.left = `${originX + p.col * cell}px`;
        el.style.top = `${originY + p.row * cell}px`;
        el.style.width = `${cell * 0.86}px`;
        el.style.height = `${cell * 0.86}px`;
      }
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(stage);

    if (reduced) {
      // Assembled, motionless (rotation only).
      for (let i = 0; i < pieces.length; i++) {
        const el = pieceRefs.current[i];
        if (el) el.style.transform = `rotate(${pieces[i]!.rot}deg)`;
      }
      ghostRef.current?.style.setProperty('display', 'none');
      return () => ro.disconnect();
    }

    const pointer = { x: -9999, y: -9999 };
    const onMove = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);

    const SPRING = 0.045;
    const DAMP = 0.86;
    const RADIUS = 130;
    const PUSH = 1.9;
    let raf = 0;
    const start = performance.now();
    const repel = (p: Piece, px: number, py: number, cx: number, cy: number, radius: number) => {
      const dx = cx - px;
      const dy = cy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius || d2 === 0) return;
      const d = Math.sqrt(d2);
      const f = ((radius - d) / radius) * PUSH;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
    };
    const step = (now: number) => {
      const t = (now - start) / 1000;
      const rect = stage.getBoundingClientRect();
      // The lost collaborator drifts on a lissajous path — and pushes pieces.
      const gx = rect.width * (0.5 + 0.38 * Math.sin(t * 0.31 + 1.3));
      const gy = rect.height * (0.45 + 0.3 * Math.sin(t * 0.23));
      const ghost = ghostRef.current;
      if (ghost) ghost.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!;
        const el = pieceRefs.current[i];
        if (!el) continue;
        const homeX = originX + p.col * cell;
        const homeY = originY + p.row * cell;
        const cx = homeX + p.ox + cell / 2;
        const cy = homeY + p.oy + cell / 2;
        repel(p, cx, cy, pointer.x, pointer.y, RADIUS);
        repel(p, cx, cy, gx, gy, RADIUS * 0.7);
        p.vx += -p.ox * SPRING;
        p.vy += -p.oy * SPRING;
        p.vx *= DAMP;
        p.vy *= DAMP;
        p.ox += p.vx;
        p.oy += p.vy;
        const floatY = Math.sin(t * p.speed + p.phase) * 2.2;
        const rot = p.rot + p.ox * 0.04;
        el.style.transform = `translate3d(${p.ox}px, ${p.oy + floatY}px, 0) rotate(${rot}deg)`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
    };
  }, [pieces]);

  return (
    <div className="notfound-screen" data-testid="notfound-screen">
      <div className="nf-stage" ref={stageRef} aria-hidden>
        {pieces.map((p, i) => (
          <div
            key={i}
            ref={(el) => {
              pieceRefs.current[i] = el;
            }}
            className={`nf-piece nf-${p.kind}`}
            style={
              p.kind === 'swatch' || p.kind === 'photo'
                ? { ['--nf-h' as string]: String(p.hue) }
                : undefined
            }
          />
        ))}
        <div className="nf-ghost" ref={ghostRef}>
          <svg width="15" height="18" viewBox="0 0 15 18" aria-hidden>
            <path
              d="M1 1 L14 9 L8 10.2 L10.6 16.4 L8 17.4 L5.6 11.2 L1 14.6 Z"
              fill="currentColor"
              stroke="var(--bg-index, #fff)"
              strokeWidth="1"
            />
          </svg>
          <span className="nf-ghost-tag">lost?</span>
        </div>
      </div>
      <div className="nf-copy">
        <h1>This board doesn’t exist</h1>
        <p>The link may be broken, out of date — or the board was never pinned here at all.</p>
        <div className="nf-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={goHome}
            data-testid="notfound-home"
          >
            Go to your boards
          </button>
          <button
            type="button"
            className="nf-secondary"
            onClick={goCommunity}
            data-testid="notfound-community"
          >
            Browse the community
          </button>
        </div>
      </div>
    </div>
  );
}
