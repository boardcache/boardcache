import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Item } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { itemType } from '../../itemTypes';
import { mediaMeta } from '../../lib/mediaItems';
import { findMediaByTitle, mediaTitle } from '../../lib/text/linkTitles';
import { useDocumentStore } from '../../state/documentStore';

/**
 * `![[Title]]` in a note embeds an item from the board. The renderers
 * (marked for the page, CodeMirror for the live editor) leave a host
 * element, `<span class="md-embed" data-embed="Title">`, and this fills
 * every host inside a root with the item: a picture, a player, or a card
 * for anything else, through React portals, so the media URL can resolve
 * asynchronously as it does everywhere else in the app.
 */

const keys = new WeakMap<HTMLElement, number>();
let nextKey = 1;
const keyOf = (el: HTMLElement): number => {
  let k = keys.get(el);
  if (!k) {
    k = nextKey++;
    keys.set(el, k);
  }
  return k;
};

/** True when the event target sits inside an embed (its click is its own). */
export function isEmbedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.md-embed');
}

/** Every `.md-embed` host under `root`, kept current as the DOM changes.
 *  A passive effect: the portals may sit inside the root, whose ref is
 *  attached after a child's layout effects would run. */
function useEmbedHosts(root: RefObject<HTMLElement | null>): HTMLElement[] {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const scan = () => {
      const next = [...el.querySelectorAll<HTMLElement>('.md-embed')];
      setHosts((prev) =>
        prev.length === next.length && prev.every((h, i) => h === next[i]) ? prev : next,
      );
    };
    const observer = new MutationObserver(scan);
    observer.observe(el, { childList: true, subtree: true });
    queueMicrotask(scan);
    return () => observer.disconnect();
  }, [root]);
  return hosts;
}

export function EmbedPortals({
  root,
  onOpen,
  onLayout,
}: {
  root: RefObject<HTMLElement | null>;
  /** An embed clicked: open its item (the lightbox, usually). */
  onOpen?: (itemId: string) => void;
  /** An embed changed size after loading (a host editor may re-measure). */
  onLayout?: () => void;
}): ReactNode {
  const hosts = useEmbedHosts(root);
  return hosts.map((host) =>
    createPortal(
      <EmbedView
        title={host.dataset.embed ?? ''}
        size={host.dataset.size ? Number(host.dataset.size) : null}
        onOpen={onOpen}
        onLayout={onLayout}
      />,
      host,
      String(keyOf(host)),
    ),
  );
}

function EmbedView({
  title,
  size,
  onOpen,
  onLayout,
}: {
  title: string;
  size: number | null;
  onOpen?: ((itemId: string) => void) | undefined;
  onLayout?: (() => void) | undefined;
}) {
  const item = useDocumentStore((s) => findMediaByTitle(s.doc, title));
  if (!item) {
    return (
      <span className="md-embed-missing" data-testid="md-embed-missing">
        Nothing on the board is called “{title}”
      </span>
    );
  }
  return <EmbedItem item={item} size={size} onOpen={onOpen} onLayout={onLayout} />;
}

function EmbedItem({
  item,
  size,
  onOpen,
  onLayout,
}: {
  item: Item;
  size: number | null;
  onOpen?: ((itemId: string) => void) | undefined;
  onLayout?: (() => void) | undefined;
}) {
  const def = itemType(item);
  const assetId =
    item.type === 'image'
      ? (item.previewAssetId ?? item.assetId)
      : item.type === 'video' || item.type === 'audio'
        ? item.assetId
        : (def.cardAsset?.(item) ?? null);
  const url = useAssetUrl(assetId);
  const style = size && Number.isFinite(size) ? { width: size } : undefined;
  // The pointer passes through to the note (a drag by the embed moves the
  // box); only a STILL click opens the item. The guard lives here because a
  // portal's events climb the React tree, past the note's own handlers.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  // The open waits out the double-click window: a double-click on the
  // embed is the note's (it edits the box), not two opens.
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );
  const open = (e: React.MouseEvent) => {
    const d = down.current;
    down.current = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    e.stopPropagation();
    e.preventDefault();
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      onOpen?.(item.id);
    }, 260);
  };
  const onDoubleClick = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  const title = mediaTitle(item);

  if (item.type === 'image' && url) {
    return (
      <img
        className="md-embed-img"
        src={url}
        alt={title}
        title={title}
        style={style}
        draggable={false}
        data-testid="md-embed-image"
        onLoad={onLayout}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onClick={open}
      />
    );
  }
  if (item.type === 'video' && url) {
    return (
      <video
        className="md-embed-video"
        src={url}
        controls
        playsInline
        style={style}
        onLoadedMetadata={onLayout}
      />
    );
  }
  if (item.type === 'audio' && url) {
    return <audio className="md-embed-audio" src={url} controls onLoadedMetadata={onLayout} />;
  }
  const color = def.cardColor?.(item);
  return (
    <button
      type="button"
      className="md-embed-card"
      style={style}
      title="Open in the lightbox"
      data-testid="md-embed-card"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={open}
    >
      {url ? (
        <img src={url} alt="" draggable={false} onLoad={onLayout} />
      ) : color ? (
        <i style={{ background: color }} />
      ) : null}
      <span className="md-embed-card-text">
        <span className="md-embed-card-title">{title}</span>
        <span className="md-embed-card-type">{mediaMeta(item).typeLabel}</span>
      </span>
    </button>
  );
}
