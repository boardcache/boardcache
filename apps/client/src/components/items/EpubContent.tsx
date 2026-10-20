import type { EpubItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { BookIcon } from '../icons';

/**
 * ePub card on the canvas: the extracted cover (stored as an ordinary asset,
 * so the offline viewer needs no epubjs), title/author footer, bookmark
 * count. Reading happens in the lightbox — double-click opens it.
 */
export function EpubContent({ item }: { item: EpubItem }) {
  const coverUrl = useAssetUrl(item.coverAssetId);
  const marks = item.bookmarks.length;
  return (
    <div className="epub-card" data-testid="epub-card">
      {coverUrl ? (
        <img className="epub-cover" src={coverUrl} alt="" draggable={false} />
      ) : (
        <div className="epub-cover epub-cover-fallback">
          <BookIcon size={40} />
        </div>
      )}
      <div className="epub-meta">
        <span className="epub-title">{item.bookTitle ?? item.name ?? 'ePub'}</span>
        {item.author && <span className="epub-author">{item.author}</span>}
      </div>
      {marks > 0 && (
        <span className="epub-marks" title={`${marks} bookmark${marks === 1 ? '' : 's'}`}>
          {marks}
        </span>
      )}
    </div>
  );
}
