import type { FileItem } from '@boardcache/schema';
import { DownloadIcon } from '../icons';
import { FileFamilyIcon, fileTitle } from '../items/FileContent';
import { fileKind, formatFileSize } from '../../lib/files/fileKind';
import { downloadFileItem } from '../../lib/files/downloadFile';

/** The lightbox stage for a file: what it is, and the download. */
export function LightboxFile({ item }: { item: FileItem }) {
  const kind = fileKind(item.fileName, item.mime);
  const rows: [string, string][] = [
    ['File name', item.fileName],
    ['Kind', kind.label],
    ['Size', formatFileSize(item.size)],
    ['Type', item.mime],
  ];
  return (
    <div className="lightbox-file" data-testid="lightbox-file" onClick={(e) => e.stopPropagation()}>
      <span className="lightbox-file-icon" aria-hidden>
        <FileFamilyIcon item={item} size={96} />
      </span>
      <h2 className="lightbox-file-title">{fileTitle(item)}</h2>
      <dl className="lightbox-file-rows">
        {rows.map(([k, v]) => (
          <div className="lightbox-file-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="btn file-stage-download"
        data-testid="file-stage-download"
        onClick={() => void downloadFileItem(item)}
      >
        <DownloadIcon size={16} /> Download
      </button>
    </div>
  );
}
