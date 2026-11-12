import type { FileItem } from '@boardcache/schema';
import type { ReactNode } from 'react';
import {
  DownloadIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileDataIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
} from '../icons';
import type { FileFamily } from '../../lib/files/fileKind';
import { fileKind, formatFileSize } from '../../lib/files/fileKind';
import { downloadFileItem } from '../../lib/files/downloadFile';

const FAMILY_ICONS: Record<FileFamily, (size: number) => ReactNode> = {
  archive: (size) => <FileArchiveIcon size={size} />,
  spreadsheet: (size) => <FileSpreadsheetIcon size={size} />,
  code: (size) => <FileCodeIcon size={size} />,
  text: (size) => <FileTextIcon size={size} />,
  data: (size) => <FileDataIcon size={size} />,
  image: (size) => <FileImageIcon size={size} />,
  audio: (size) => <FileAudioIcon size={size} />,
  video: (size) => <FileVideoIcon size={size} />,
  file: (size) => <FileIcon size={size} />,
};

/** The icon for a file's family, at a size. */
export function FileFamilyIcon({ item, size }: { item: FileItem; size: number }) {
  return <>{FAMILY_ICONS[fileKind(item.fileName, item.mime).family](size)}</>;
}

/** The card's title: the item's own name, else the file's. */
export const fileTitle = (item: FileItem): string => item.name?.trim() || item.fileName;

/** "ZIP archive · 1.5 MB" */
export const fileDetail = (item: FileItem): string =>
  `${fileKind(item.fileName, item.mime).label} · ${formatFileSize(item.size)}`;

/**
 * A file the board keeps but cannot show: its icon, name and size, and the
 * one thing to do with it. The row scales with the card's height so a
 * larger card reads from further away.
 */
export function FileContent({ item }: { item: FileItem }) {
  return (
    <div className="file-card" data-testid="file-card">
      <span className="file-card-icon" aria-hidden>
        <FileFamilyIcon item={item} size={36} />
      </span>
      <span className="file-card-text">
        <span className="file-card-name" data-testid="file-card-name" title={item.fileName}>
          {fileTitle(item)}
        </span>
        <span className="file-card-detail" data-testid="file-card-detail">
          {fileDetail(item)}
        </span>
      </span>
      <button
        type="button"
        className="btn btn-sm file-card-download"
        data-testid="file-card-download"
        data-view-ok=""
        title={`Download ${item.fileName}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void downloadFileItem(item);
        }}
      >
        <DownloadIcon size={14} /> Download
      </button>
    </div>
  );
}

/** Gallery card: the icon over the extension, like a desktop file. */
export function FileCard({ item }: { item: FileItem }) {
  const kind = fileKind(item.fileName, item.mime);
  return (
    <span className="file-gallery" data-testid="file-gallery">
      <FileFamilyIcon item={item} size={44} />
      {kind.ext && <span className="file-gallery-ext">{kind.ext.toUpperCase()}</span>}
    </span>
  );
}
