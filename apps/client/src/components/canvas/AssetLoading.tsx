import { retryAsset } from '../../lib/board/assetStore';
import { useCollabStore } from '../../state/collabStore';

/**
 * Team-board asset loading state: while a peer's large upload is still being
 * pulled from the room, the box says so instead of sitting empty.
 */
export function useTeamAssetFetching(ids: (string | null | undefined)[]): boolean {
  return useCollabStore((s) => ids.some((id) => id && s.fetchingAssets[id]));
}

/** The bytes are not on this device and no source could fetch them yet. */
export function AssetMissingBox({ assetId, label }: { assetId: string; label: string }) {
  return (
    <div className="item-placeholder asset-missing" data-testid="asset-missing">
      <span className="asset-loading-text">
        {label[0]!.toUpperCase() + label.slice(1)} not downloaded
      </span>
      <button
        type="button"
        className="asset-missing-retry"
        data-testid="asset-retry"
        onPointerDown={(e) => e.stopPropagation()}
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
