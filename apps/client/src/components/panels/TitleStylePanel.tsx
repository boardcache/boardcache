import type { TitleItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { boardFontFamilies } from '../../lib/media/fontRegistry';
import { TEXT_FONTS } from '../../lib/text/textOptions';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import {
  SunMoonIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  VAlignBottomIcon,
  VAlignMiddleIcon,
  VAlignTopIcon,
} from '../icons';

import { splitHexAlpha, withAlpha } from '../../lib/color/color';
import { textCardDefaults } from '../../lib/themes';
import { resolveTheme } from '../../state/sessionStore';
import { BackgroundWell, InkWell } from './colorWells';

/**
 * Style controls for title items (no font size — the box IS the size):
 * font, bold/italic, both alignments, and the same text-color and
 * background wells text boxes have. Shown whenever the selection is
 * entirely titles.
 */

export function TitleStylePanel() {
  const boardFonts = useDocumentStore(useShallow((s) => boardFontFamilies(s.doc)));
  // Reactive selection: an item→item switch must re-derive the panel.
  const selection = useSessionStore(useShallow((s) => s.selection));
  const sheetOpen = useSessionStore((s) => s.mobileStyleSheetOpen);
  const dark = resolveTheme(useSessionStore((s) => s.theme)) === 'dark';
  const titles = useDocumentStore(
    useShallow((s) =>
      selection
        .map((id) => s.doc.items[id])
        .filter((i): i is TitleItem => i?.type === 'title' && !i.locked),
    ),
  );
  const selectionLength = selection.length;

  if (titles.length === 0 || titles.length !== selectionLength) return null;
  const ref = titles[0]!;
  // Background as the well shows it: none = the theme's paper at zero opacity.
  const bg =
    ref.background === null
      ? { hex: textCardDefaults(dark).background, alpha: 0 }
      : splitHexAlpha(ref.background);

  const set = (label: string, recipe: (d: TitleItem) => void) =>
    updateItems(
      titles.map((t) => t.id),
      label,
      (d) => {
        if (d.type === 'title') recipe(d);
      },
    );

  return (
    <div
      className={`shape-style-panel title-style-panel${sheetOpen ? ' mobile-open' : ''}`}
      data-testid="title-style-panel"
    >
      <select
        value={ref.fontFamily}
        onChange={(e) => set('Title font', (d) => (d.fontFamily = e.target.value))}
        aria-label="Font family"
        data-testid="title-font"
        className="title-font-select"
      >
        {TEXT_FONTS.map((f) => (
          <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
            {f.label}
          </option>
        ))}
        {boardFonts.length > 0 && (
          <optgroup label="Board fonts">
            {boardFonts.map((f) => (
              <option key={f} value={`'${f}'`}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <button
        type="button"
        className={`ssp-width title-b${ref.bold ? ' active' : ''}`}
        onClick={() => set('Bold', (d) => (d.bold = !d.bold))}
        title="Bold"
        data-testid="title-bold"
      >
        B
      </button>
      <button
        type="button"
        className={`ssp-width title-i${ref.italic ? ' active' : ''}`}
        onClick={() => set('Italic', (d) => (d.italic = !d.italic))}
        title="Italic"
        data-testid="title-italic"
      >
        I
      </button>

      <span className="ssp-label">Align</span>
      {(['left', 'center', 'right'] as const).map((a) => (
        <button
          key={a}
          type="button"
          className={`ssp-width${ref.alignH === a ? ' active' : ''}`}
          onClick={() => set('Align', (d) => (d.alignH = a))}
          title={`Align ${a}`}
          data-testid={`title-align-${a}`}
        >
          {a === 'left' ? (
            <TextAlignLeftIcon size={15} />
          ) : a === 'center' ? (
            <TextAlignCenterIcon size={15} />
          ) : (
            <TextAlignRightIcon size={15} />
          )}
        </button>
      ))}
      {(['top', 'middle', 'bottom'] as const).map((a) => (
        <button
          key={a}
          type="button"
          className={`ssp-width${ref.alignV === a ? ' active' : ''}`}
          onClick={() => set('Align', (d) => (d.alignV = a))}
          title={`Align ${a}`}
          data-testid={`title-valign-${a}`}
        >
          {a === 'top' ? (
            <VAlignTopIcon size={15} />
          ) : a === 'middle' ? (
            <VAlignMiddleIcon size={15} />
          ) : (
            <VAlignBottomIcon size={15} />
          )}
        </button>
      ))}

      <InkWell
        color={ref.color ?? (dark ? '#e6e8ea' : '#1b1f24')}
        onChange={(hex) => set('Title color', (d) => (d.color = hex))}
        onReset={() => set('Title color', (d) => (d.color = null))}
        testId="title-color"
        historyLabel="Title color"
      />
      <BackgroundWell
        hex={bg.hex}
        alpha={bg.alpha}
        onChange={(hex, alpha) =>
          set('Title background', (d) => (d.background = alpha <= 0 ? null : withAlpha(hex, alpha)))
        }
        onReset={() => set('Title background', (d) => (d.background = null))}
        resetLabel="No background"
        resetTestId="title-no-bg"
        label="Box background color and opacity"
        testId="title-bg"
        historyLabel="Title background"
      />
      {(ref.color !== null || ref.background !== null) && (
        <button
          type="button"
          className="ssp-width"
          onClick={() =>
            set('Theme colors', (d) => {
              d.color = null;
              d.background = null;
            })
          }
          title="Reset to the theme's light/dark colors"
          aria-label="Reset to theme colors"
          data-testid="title-theme-reset"
        >
          <SunMoonIcon size={15} />
        </button>
      )}
    </div>
  );
}
