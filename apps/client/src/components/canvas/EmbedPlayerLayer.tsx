import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  attachEmbedIframe,
  deactivateEmbed,
  embedPlayersSnapshot,
  embedTime,
  subscribeEmbedPlayers,
} from '../../lib/media/embedPlayers';
import type { ActiveEmbedPlayer } from '../../lib/media/embedPlayers';
import { moveItemsBy, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { CloseIcon, ExpandIcon, FlagIcon } from '../icons';
import { canvasReadOnly, useCanvasReadOnly } from '../../lib/canvas/readOnly';

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Floating window for one active provider player. The iframe mounts ONCE and
 * is repositioned every frame to cover its target: the lightbox stage when
 * that item is open there, else the canvas item. Never remounted → playback
 * is never interrupted by view changes.
 */
function EmbedWindow({ player }: { player: ActiveEmbedPlayer }) {
  const readOnly = useCanvasReadOnly();
  const wrapRef = useRef<HTMLDivElement>(null);
  // Bar-drag state. The item is moved LIVE through the session gesture
  // overrides (exactly like a normal canvas drag), so the poster underneath
  // travels with the window; one Move command commits on release.
  const drag = useRef<{
    startX: number;
    startY: number;
    itemX: number;
    itemY: number;
    dx: number;
    dy: number;
  } | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = wrapRef.current;
      if (el) {
        const stage = document.querySelector<HTMLElement>(`[data-embed-stage="${player.itemId}"]`);
        const target =
          stage ?? document.querySelector<HTMLElement>(`[data-item-id="${player.itemId}"]`);
        if (target) {
          const r = target.getBoundingClientRect();
          // Audio players need their full height — hang the bar above the item.
          const barUp = player.kind === 'audio' && !stage ? 26 : 0;
          el.style.display = 'flex';
          el.style.transform = `translate(${r.left}px, ${r.top - barUp}px)`;
          el.style.width = `${r.width}px`;
          el.style.height = `${r.height + barUp}px`;
          // The iframe is laid out at the item's WORLD size and scaled with
          // the canvas, so the provider's UI zooms with the board instead of
          // rendering at screen size inside a shrinking box. Spotify draws
          // its player at exactly 352 (full) or 152 (compact) CSS px and
          // leaves black beyond that — snap to the layout that fits and
          // centre it, so the box and the player agree at any size.
          const scale = stage ? 1 : useDocumentStore.getState().doc.viewport.scale || 1;
          const worldW = r.width / scale;
          const worldH = r.height / scale;
          const frameH =
            player.provider === 'spotify'
              ? worldH >= SPOTIFY_FULL
                ? SPOTIFY_FULL
                : SPOTIFY_COMPACT
              : worldH;
          const frame = el.querySelector<HTMLIFrameElement>('iframe');
          if (frame) {
            frame.style.width = `${worldW}px`;
            frame.style.height = `${frameH}px`;
            frame.style.transform = `translateY(${((worldH - frameH) / 2) * scale}px) scale(${scale})`;
          }
          // Above the lightbox (z 2000) when docked to its stage. On the
          // canvas: above world content but UNDER all chrome (menubar, pills
          // and style panels sit at z 20+) — menus win over playing embeds.
          el.style.zIndex = stage ? '2400' : '15';
        } else {
          el.style.display = 'none'; // e.g. the library view
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player.itemId, player.kind, player.provider]);

  // The title bar doubles as the drag handle for the underlying canvas item
  // (the iframe itself has to stay interactive for the provider's controls).
  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || canvasReadOnly()) return; // a published board never moves
    // Docked onto the lightbox stage: nothing to move there.
    if (document.querySelector(`[data-embed-stage="${player.itemId}"]`)) return;
    const item = useDocumentStore.getState().doc.items[player.itemId];
    if (!item || item.locked) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      itemX: item.x,
      itemY: item.y,
      dx: 0,
      dy: 0,
    };
    useSessionStore.getState().setSelection([player.itemId]);
  };
  const onBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.startX;
    d.dy = e.clientY - d.startY;
    const scale = useDocumentStore.getState().doc.viewport.scale || 1;
    // Live-move the item itself (poster and all); the window follows its rect.
    useSessionStore.getState().setGesture({
      kind: 'move',
      overrides: { [player.itemId]: { x: d.itemX + d.dx / scale, y: d.itemY + d.dy / scale } },
    });
  };
  const onBarPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    useSessionStore.getState().setGesture(null);
    if (d.dx === 0 && d.dy === 0) return;
    const scale = useDocumentStore.getState().doc.viewport.scale || 1;
    moveItemsBy([player.itemId], d.dx / scale, d.dy / scale);
  };

  const addMarker = () => {
    const t = embedTime(player.itemId);
    const label = window.prompt('Marker label:', formatTime(t));
    if (label === null) return;
    updateItems([player.itemId], 'Add marker', (it) => {
      if (it.type !== 'video') return;
      it.markers = [...it.markers, { time: t, label: label.trim() || formatTime(t) }].sort(
        (a, b) => a.time - b.time,
      );
    });
  };

  return (
    <div ref={wrapRef} className="embed-window" data-testid="embed-window">
      <div
        className="embed-window-bar"
        title={readOnly ? undefined : 'Drag to move on the canvas'}
        data-testid="embed-drag-bar"
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerUp}
      >
        <span className="embed-window-title">{player.provider}</span>
        {player.kind === 'video' && !readOnly && (
          <button
            type="button"
            title="Add a time marker"
            data-testid="embed-add-marker"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={addMarker}
          >
            <FlagIcon size={13} />
          </button>
        )}
        <button
          type="button"
          title="Open in the lightbox"
          data-testid="embed-open-lightbox"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => useSessionStore.getState().setLightbox(player.itemId)}
        >
          <ExpandIcon size={13} />
        </button>
        <button
          type="button"
          title="Close the player (back to the poster)"
          data-testid="embed-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => deactivateEmbed(player.itemId)}
        >
          <CloseIcon />
        </button>
      </div>
      <iframe
        ref={(f) => attachEmbedIframe(player.itemId, f)}
        src={player.src}
        title={player.provider}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
        allowFullScreen
      />
    </div>
  );
}

/** Spotify's embed layouts: it renders one of these two heights, never in between. */
const SPOTIFY_FULL = 352;
const SPOTIFY_COMPACT = 152;

/** All active provider players, portalled to <body>. */
export function EmbedPlayerLayer() {
  const players = useSyncExternalStore(subscribeEmbedPlayers, embedPlayersSnapshot);
  if (players.length === 0) return null;
  return createPortal(
    <>
      {players.map((p) => (
        <EmbedWindow key={p.itemId} player={p} />
      ))}
    </>,
    document.body,
  );
}
