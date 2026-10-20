import { dismissNotice, useNotices } from '../../lib/notices';
import { openPath } from '../../lib/router';
import { CloseIcon } from '../icons';

/** Top-center strip of dismissible app notices (see lib/notices). Class
 *  names deliberately avoid content-blocker tokens (iOS notes). */
export function AppNotices() {
  const notices = useNotices((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="app-notice-stack" data-testid="app-notices">
      {notices.map((n) => (
        <div key={n.id} className={`app-notice ${n.kind}`} role="status" data-testid="app-notice">
          <span>{n.text}</span>
          {n.action && (
            <button
              type="button"
              className="app-notice-action"
              data-testid="app-notice-action"
              onClick={() => {
                dismissNotice(n.id);
                openPath(n.action!.path);
              }}
            >
              {n.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            className="app-notice-x"
            onClick={() => dismissNotice(n.id)}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
