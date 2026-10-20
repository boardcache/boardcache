import { useEffect, useState } from 'react';
import type {
  CanvasDocument,
  Item,
  StoryboardItem,
  TierlistItem,
  TreeItem,
} from '@boardcache/schema';
import { renderRegion, type RenderCache } from '../lib/media/thumbnail';
import { useDocumentStore } from '../state/documentStore';
import { resolveTheme, useSessionStore } from '../state/sessionStore';

// Container cards (tree, tier list, storyboard) raster the REAL thing — the
// container plus its attached items — through the board-cover painter, so the
// preview shows actual images on the shelves rather than counts or label pills.
const containerThumbCache = new Map<string, string>();
const containerRenderCache: RenderCache = new Map();

export function ContainerCard({
  item,
  testId,
  label,
}: {
  item: TreeItem | TierlistItem | StoryboardItem;
  testId: string;
  label: string;
}) {
  const dark = resolveTheme(useSessionStore((s) => s.theme)) === 'dark';
  const doc = useDocumentStore.getState().doc;
  const attachedIds =
    item.type === 'tree'
      ? item.nodes.flatMap((n) => n.itemIds)
      : item.type === 'storyboard'
        ? item.panels.flatMap((p) => p.itemIds)
        : item.rows.flatMap((r) => r.itemIds);
  const attached = attachedIds
    .map((id) => doc.items[id])
    .filter((it): it is Item => it !== undefined);
  // Content-address the raster: the container itself, everything attached to
  // it (position, size, crop, asset), and the theme mode.
  const sig = JSON.stringify([item, attached, dark]);
  const [thumb, setThumb] = useState<{ sig: string; url: string } | null>(null);
  // Stale-while-revalidate: show the previous raster while an edit re-renders.
  const src = containerThumbCache.get(sig) ?? thumb?.url ?? null;

  useEffect(() => {
    if (containerThumbCache.has(sig)) return;
    let cancelled = false;
    void (async () => {
      try {
        const mini: CanvasDocument = {
          ...doc,
          items: Object.fromEntries([item, ...attached].map((it) => [it.id, it])),
        };
        const outW = 560;
        const outH = Math.max(1, Math.round((item.height / Math.max(1, item.width)) * outW));
        const blob = await renderRegion(
          mini,
          { x: item.x, y: item.y, width: item.width, height: item.height },
          outW,
          Math.min(outH, 1600),
          null,
          dark,
          containerRenderCache,
        );
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error as Error);
          r.readAsDataURL(blob);
        });
        if (!cancelled) {
          if (containerThumbCache.size > 64) containerThumbCache.clear();
          containerThumbCache.set(sig, dataUrl);
          setThumb({ sig, url: dataUrl });
        }
      } catch (err) {
        if (!cancelled) console.error('boardCache: container thumbnail failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig covers item/attached/dark
  }, [sig]);

  return src ? (
    <img src={src} alt="" draggable={false} className="gallery-raster" data-testid={testId} />
  ) : (
    <span className="gallery-generic" data-testid={testId}>
      {label}
    </span>
  );
}
