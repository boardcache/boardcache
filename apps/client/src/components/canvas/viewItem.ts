import type { Item } from '@boardcache/schema';
import { openLightbox } from '../lightbox/Lightbox';
import { openUrl } from '../../lib/text/itemUrl';

/**
 * Open an item for LOOKING, never editing: what a double-click (or a
 * view-mode tap) does on a locked canvas, in the viewer, and on a locked
 * item. Links open their URL; a webpage embed is already live, so nothing;
 * everything else goes to the lightbox.
 */
export function viewItem(item: Item): void {
  if (item.type === 'link') {
    openUrl(item.url);
    return;
  }
  if (item.type === 'iframe') return;
  openLightbox(item);
}
