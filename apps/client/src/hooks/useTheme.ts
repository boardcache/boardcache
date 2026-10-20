import { useEffect } from 'react';
import { resolveTheme, useSessionStore } from '../state/sessionStore';
import { useDocumentStore } from '../state/documentStore';
import { applyThemeTokens } from '../lib/themes';

/**
 * Keeps `<html data-theme>` (mode) and the color-family token overrides in
 * sync with the stored preferences, following OS theme changes live while
 * the preference is 'system'. First paint is handled by the inline script
 * in index.html — same keys, same logic.
 *
 * A board can OVERRIDE the family (settings.themeId): it wins while that
 * board is open (canvas/gallery); the library and everything else keep the
 * global choice. Light/dark mode stays a per-device preference either way.
 */
export function useTheme() {
  const theme = useSessionStore((s) => s.theme);
  const themeId = useSessionStore((s) => s.themeId);
  const view = useSessionStore((s) => s.view);
  const activePage = useSessionStore((s) => s.activePageId);
  const boardThemeId = useDocumentStore((s) => {
    // Pages: the active page's theme override wins over the board's.
    const page = s.doc.pages.find((p) => p.id === activePage);
    return page?.themeId ?? s.doc.settings.themeId;
  });
  const inBoard = view === 'canvas' || view === 'gallery' || view === 'plugin';
  const overriding = Boolean(inBoard && boardThemeId);
  const effectiveId = inBoard && boardThemeId ? boardThemeId : themeId;

  useEffect(() => {
    const apply = () => {
      const mode = resolveTheme(theme);
      document.documentElement.dataset.theme = mode;
      applyThemeTokens(effectiveId, mode, { persistBoot: !overriding });
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, effectiveId, overriding]);
}
