import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { MoonIcon, SunIcon } from '../icons';
import { UiTooltip } from '../ui/Tooltip';

/** A single light/dark toggle button. Shared by the canvas chrome, the gallery
 *  index, and the lightbox so appearance can be switched from anywhere. */
export function ThemeToggle({
  className,
  testId = 'theme-toggle',
}: {
  className?: string;
  testId?: string;
}) {
  const theme = useSessionStore((s) => s.theme);
  const setTheme = useSessionStore((s) => s.setTheme);
  const resolved = resolveTheme(theme);
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <UiTooltip label={`Switch to ${next} theme`}>
      <button
        type="button"
        className={className}
        onClick={() => setTheme(next)}
        aria-label="Toggle light/dark theme"
        data-testid={testId}
      >
        {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
    </UiTooltip>
  );
}
