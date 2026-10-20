import { createPortal } from 'react-dom';
import { RefreshIcon } from '../icons';
import { useAppUpdate } from '../../lib/appUpdate';
import { useSessionStore } from '../../state/sessionStore';

/**
 * A floating pill above the bottom controls once a newer build is waiting:
 * the reload happens on the user's terms. Portaled to the body (fixed
 * positioning must not inherit a transformed ancestor) and quiet while
 * presenting.
 */
export function UpdatePill() {
  const ready = useAppUpdate((s) => s.ready);
  const apply = useAppUpdate((s) => s.apply);
  const presenting = useSessionStore((s) => s.presenting);
  if (!ready || !apply || presenting) return null;
  return createPortal(
    <div className="update-pill" data-testid="update-pill">
      <button type="button" onClick={apply} title="A newer version is ready">
        <RefreshIcon size={15} /> Update ready · Reload
      </button>
    </div>,
    document.body,
  );
}
