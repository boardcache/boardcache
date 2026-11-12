import { useEffect, useState } from 'react';
import { vaultThumbUrl, type VaultBoard } from '../../lib/vault/vaultStore';

/** A board folder's preview, read from its thumbnail file on first show
 *  and again only when the file's stamp changes. */
export function VaultThumb({ board, dark }: { board: VaultBoard; dark: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const stamp = dark ? board.thumbDark : board.thumb;
  useEffect(() => {
    let live = true;
    void vaultThumbUrl(board, dark).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
    // The path and stamp are what identify the file; the record object changes on every scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.path, stamp, dark]);
  return url ? (
    <img src={url} alt="" draggable={false} />
  ) : (
    <span className="board-thumb-empty">∅</span>
  );
}
