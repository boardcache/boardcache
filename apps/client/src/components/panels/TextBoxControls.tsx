import type { ReactNode } from 'react';
import { textCardDefaults } from '../../lib/themes';
import {
  SunMoonIcon,
  TextSizeIcon,
  TypeIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  VAlignBottomIcon,
  VAlignMiddleIcon,
  VAlignTopIcon,
} from '../icons';
import type { TextAlign, TextItem, TextVerticalAlign } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { measureMarkdownHeight } from '../../lib/text/markdown';
import { splitHexAlpha, withAlpha } from '../../lib/color/color';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { boardFontFamilies } from '../../lib/media/fontRegistry';
import { useDocumentStore } from '../../state/documentStore';
import { useShallow } from 'zustand/react/shallow';
import { BackgroundWell, InkWell } from './colorWells';
import { UiSelect } from '../ui/Select';

/** Root font sizes; markdown headings scale up from these (em-based). */
import { TEXT_FONTS as FONTS, TEXT_SIZES as SIZES } from '../../lib/text/textOptions';

const ALIGNS: TextAlign[] = ['left', 'center', 'right'];
const ALIGN_ICONS: Record<TextAlign, ReactNode> = {
  left: <TextAlignLeftIcon size={16} />,
  center: <TextAlignCenterIcon size={16} />,
  right: <TextAlignRightIcon size={16} />,
};
const ALIGN_LABELS: Record<TextAlign, string> = {
  left: 'Align text left',
  center: 'Center text',
  right: 'Align text right',
};

const V_ALIGNS: TextVerticalAlign[] = ['top', 'middle', 'bottom'];
const V_ALIGN_ICONS: Record<TextVerticalAlign, ReactNode> = {
  top: <VAlignTopIcon size={16} />,
  middle: <VAlignMiddleIcon size={16} />,
  bottom: <VAlignBottomIcon size={16} />,
};
const V_ALIGN_LABELS: Record<TextVerticalAlign, string> = {
  top: 'Text at the top of the box',
  middle: 'Text in the middle of the box',
  bottom: 'Text at the bottom of the box',
};

/** Box-level text styling (font, alignment, color, background) — shared by the
 *  canvas style panel and the lightbox editor. Content formatting is markdown. */
export function TextBoxControls({
  item,
  compact = false,
  leading,
}: {
  item: TextItem;
  /** Phones: font and size become icon buttons that open their lists. */
  compact?: boolean;
  /** Rendered first in the style row (the phone's edit/preview toggle). */
  leading?: ReactNode;
}) {
  const theme = useSessionStore((s) => s.theme);
  const boardFonts = useDocumentStore(useShallow((s) => boardFontFamilies(s.doc)));
  const set = (label: string, recipe: (draft: TextItem) => void) =>
    updateItems([item.id], label, (draft) => {
      if (draft.type === 'text') recipe(draft);
    });

  // Changing the root size rescales the whole hierarchy; refit auto-height boxes.
  const setFontSize = (value: number) =>
    updateItems([item.id], 'Font size', (draft) => {
      if (draft.type !== 'text') return;
      draft.fontSize = value;
      if (draft.autoHeight) {
        draft.height = measureMarkdownHeight(draft.text, draft.width, value, draft.fontFamily);
      }
    });

  const dark = resolveTheme(theme) === 'dark';
  const colorValue = item.color === 'default' ? (dark ? '#e6e8ea' : '#1b1f24') : item.color;

  // Background state: solid hex + 0–1 alpha. Transparency is just alpha 0
  // (stored as null, the long-standing "no card" sentinel).
  const autoBg = textCardDefaults(dark).background;
  const bg =
    item.background === 'auto'
      ? { hex: autoBg, alpha: 1 }
      : item.background === null
        ? { hex: autoBg, alpha: 0 }
        : splitHexAlpha(item.background);
  const writeBg = (hex: string, alpha: number) =>
    set('Text background', (d) => {
      d.background = alpha <= 0 ? null : withAlpha(hex, alpha);
    });

  const themed = item.color === 'default' && item.background === 'auto';

  const fontOptions = [
    ...FONTS.map((f) => ({ value: f.value, label: f.label, style: { fontFamily: f.value } })),
    ...boardFonts.map((family) => ({
      value: `'${family}'`,
      label: family,
      group: 'Board fonts',
      style: { fontFamily: `'${family}'` },
    })),
  ];
  const sizeOptions = [
    ...(SIZES.every((s) => s.value !== item.fontSize)
      ? [{ value: String(item.fontSize), label: 'Custom' }]
      : []),
    ...SIZES.map((s) => ({ value: String(s.value), label: s.label })),
  ];
  const fontAndSize = compact ? (
    <>
      <UiSelect
        value={item.fontFamily}
        options={fontOptions}
        onChange={(v) => set('Font', (d) => (d.fontFamily = v))}
        ariaLabel="Font family"
        testId="text-font"
        trigger={<TypeIcon size={16} />}
      />
      <UiSelect
        value={String(item.fontSize)}
        options={sizeOptions}
        onChange={(v) => setFontSize(Number(v))}
        ariaLabel="Font size"
        testId="text-size"
        trigger={<TextSizeIcon size={16} />}
      />
    </>
  ) : null;

  return (
    <div className="text-box-controls">
      {!compact && (
        <select
          value={item.fontFamily}
          onChange={(e) => set('Font', (d) => (d.fontFamily = e.target.value))}
          title="Font"
          aria-label="Font family"
          data-testid="text-font"
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
          {boardFonts.length > 0 && (
            <optgroup label="Board fonts">
              {boardFonts.map((family) => (
                <option key={family} value={`'${family}'`} style={{ fontFamily: `'${family}'` }}>
                  {family}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}

      {!compact && (
        <select
          value={item.fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          title="Font size (scales the whole hierarchy)"
          aria-label="Font size"
          data-testid="text-size"
        >
          {SIZES.every((s) => s.value !== item.fontSize) && (
            <option value={item.fontSize}>Custom</option>
          )}
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}

      <div className="tbc-style-row">
        {leading}
        <div className="align-buttons" role="group" aria-label="Horizontal alignment">
          {ALIGNS.map((align) => (
            <button
              key={align}
              type="button"
              className={item.align === align ? 'active' : ''}
              aria-pressed={item.align === align}
              onClick={() => set('Text align', (d) => (d.align = align))}
              title={ALIGN_LABELS[align]}
              data-testid={`text-align-${align}`}
            >
              {ALIGN_ICONS[align]}
            </button>
          ))}
        </div>

        <div className="align-buttons" role="group" aria-label="Vertical alignment">
          {V_ALIGNS.map((v) => (
            <button
              key={v}
              type="button"
              className={item.verticalAlign === v ? 'active' : ''}
              aria-pressed={item.verticalAlign === v}
              onClick={() => set('Vertical align', (d) => (d.verticalAlign = v))}
              title={V_ALIGN_LABELS[v]}
              data-testid={`text-valign-${v}`}
            >
              {V_ALIGN_ICONS[v]}
            </button>
          ))}
        </div>
        {fontAndSize}

        <InkWell
          color={colorValue}
          onChange={(hex) => set('Text color', (d) => (d.color = hex))}
          onReset={() => set('Text color', (d) => (d.color = 'default'))}
          testId="text-color"
        />

        <BackgroundWell
          hex={bg.hex}
          alpha={bg.alpha}
          onChange={writeBg}
          onReset={() => set('Text background', (d) => (d.background = 'auto'))}
          resetLabel="Theme card"
          resetTestId="text-bg-auto"
          label="Card background color and opacity"
          testId="text-bg"
          historyLabel="Text background"
        />

        {!themed && (
          <button
            type="button"
            onClick={() =>
              set('Theme colors', (d) => {
                d.color = 'default';
                d.background = 'auto';
              })
            }
            title="Reset to the theme's light/dark colors"
            aria-label="Reset to theme colors"
            data-testid="text-theme-reset"
          >
            <SunMoonIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
