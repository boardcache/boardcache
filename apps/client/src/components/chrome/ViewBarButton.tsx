import type { ReactNode } from 'react';
import { UiTooltip } from '../ui/Tooltip';

/**
 * A button of the view bar (styles/61-view-bar.css): a flat icon with a
 * tip, the one control every full-screen view's bar is made of. `active`
 * marks a toggle that is on.
 */
export function ViewBarButton({
  label,
  icon,
  onClick,
  testId,
  active,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  testId?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <UiTooltip label={label}>
      <button
        type="button"
        className={`view-icon-btn${active ? ' active' : ''}`}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        data-testid={testId}
        onClick={onClick}
      >
        {icon}
      </button>
    </UiTooltip>
  );
}
