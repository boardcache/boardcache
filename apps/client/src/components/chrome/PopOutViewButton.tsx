import { currentViewPath } from '../../lib/router';
import { POPPED_WINDOW_PREFIX, isPoppedView } from '../../lib/poppedView';
import { useSessionStore } from '../../state/sessionStore';
import { CloseIcon, PopOutIcon } from '../icons';
import { UiTooltip } from '../ui/Tooltip';

/**
 * Open this view in a window of its own and bring this window back to the
 * canvas, so a view (notes, feeds, mail, the calendar) and the board can be
 * worked side by side. The new window is a popup, chrome kept to the
 * minimum the browser allows (the desktop app draws none), named so the
 * app knows it is a view on its own: no canvas, the bar as its handle.
 * In such a window the same place holds the control that closes it.
 */
export function PopOutViewButton({ testId = 'view-popout' }: { testId?: string }) {
  if (isPoppedView()) {
    return (
      <UiTooltip label="Close this window">
        <button
          type="button"
          className="view-icon-btn"
          aria-label="Close this window"
          data-testid={`${testId}-close`}
          onClick={() => window.close()}
        >
          <CloseIcon size={16} />
        </button>
      </UiTooltip>
    );
  }
  return (
    <UiTooltip label="Open this view in a new window">
      <button
        type="button"
        className="view-icon-btn"
        aria-label="Open this view in a new window"
        data-testid={testId}
        onClick={() => {
          const view = useSessionStore.getState().pluginView ?? 'view';
          const w = Math.min(1180, Math.round(window.screen.availWidth * 0.8));
          const h = Math.min(820, Math.round(window.screen.availHeight * 0.85));
          window.open(
            `${location.origin}${currentViewPath()}`,
            `${POPPED_WINDOW_PREFIX}-${view}`,
            `popup=yes,width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`,
          );
          // The new window takes the view, this one takes the board.
          useSessionStore.getState().setView('canvas');
        }}
      >
        <PopOutIcon size={16} />
      </button>
    </UiTooltip>
  );
}
