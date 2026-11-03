import { retryAsset } from '../../lib/board/assetStore';
import type { AssetMiss } from '../../lib/board/assetStore';
import { useCollabStore } from '../../state/collabStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Team-board asset loading state: while a peer's large upload is still being
 * pulled from the room, the box says so instead of sitting empty.
 */
export function useTeamAssetFetching(ids: (string | null | undefined)[]): boolean {
  return useCollabStore((s) => ids.some((id) => id && s.fetchingAssets[id]));
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * The asset cannot be shown, and the box says why: the bytes never reached
 * this device (Retry fetches again), they are here but encrypted with another
 * board's password (Unlock asks for it), or the stored record cannot be read
 * (Retry reads again).
 */
export function AssetMissingBox({
  assetId,
  miss,
  label,
}: {
  assetId: string;
  miss: AssetMiss;
  label: string;
}) {
  const Label = label[0]!.toUpperCase() + label.slice(1);
  if (miss.reason === 'locked') {
    const { owner } = miss;
    const where = owner.name ? `“${owner.name}”` : 'another board';
    return (
      <div
        className="item-placeholder asset-missing"
        data-testid="asset-missing"
        data-reason="locked"
        title={
          owner.local
            ? `This ${label} is encrypted with the password of ${where}. Unlock that board to show it here.`
            : `This ${label} is encrypted with the password of ${where}, which is not on this device.`
        }
      >
        <span className="asset-loading-text">
          {Label} locked with {where}
        </span>
        {owner.local && (
          <button
            type="button"
            className="asset-missing-retry"
            data-testid="asset-unlock"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              useSessionStore.getState().setAssetUnlock({
                boardId: owner.boardId,
                name: owner.name ?? 'Locked board',
                assetId,
              });
            }}
          >
            Unlock
          </button>
        )}
      </div>
    );
  }
  const unreadable = miss.reason === 'unreadable';
  return (
    <div
      className="item-placeholder asset-missing"
      data-testid="asset-missing"
      data-reason={miss.reason}
      title={
        unreadable
          ? `The ${label} is on this device but could not be read.`
          : `The ${label} is not on this device, and no source could fetch it.`
      }
    >
      <span className="asset-loading-text">
        {Label} {unreadable ? "can't be read" : 'not downloaded'}
      </span>
      <button
        type="button"
        className="asset-missing-retry"
        data-testid="asset-retry"
        onPointerDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          retryAsset(assetId);
        }}
      >
        Retry
      </button>
    </div>
  );
}

export function AssetLoadingBox({ label }: { label: string }) {
  return (
    <div className="item-placeholder asset-loading" data-testid="asset-loading">
      <span className="pending-import-spinner" />
      <span className="asset-loading-text">Loading {label}…</span>
    </div>
  );
}
