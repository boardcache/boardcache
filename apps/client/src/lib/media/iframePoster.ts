import { getPlatformCaps, platform } from '../platform';
import { putAsset } from '../board/assetStore';
import { setIframePoster } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Capture a webpage embed's poster via the server screenshot endpoint and store
 * it on the item. Best-effort: if the server is unreachable (offline / not
 * signed in) the embed simply keeps no poster. Deduped per item so a create +
 * navigate burst doesn't fire twice; resolves to whether a poster was stored.
 */
const inFlight = new Set<string>();

export async function captureIframePoster(itemId: string): Promise<boolean> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'iframe' || !item.url) return false;
  if (inFlight.has(itemId)) return false;
  inFlight.add(itemId);

  const { url } = item;
  const width = Math.round(item.width);
  const height = Math.round(item.height);
  try {
    if (!getPlatformCaps().screenshot) return false;
    const res = await platform.screenshot({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url, width, height }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return false;
    const assetId = await putAsset(blob);
    setIframePoster(itemId, assetId, url);
    return true;
  } catch {
    return false; // best-effort — no poster without the server
  } finally {
    inFlight.delete(itemId);
  }
}
