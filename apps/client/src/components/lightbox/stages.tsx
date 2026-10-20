import { safeHttpUrl } from '../../lib/text/safeUrl';
import { useState } from 'react';
import type { Item } from '@boardcache/schema';
import { colorFormats, luminance } from '../../lib/color/color';
import { mediaMeta } from '../../lib/mediaItems';
import type { ColorEntry } from '../../lib/mediaItems';
import { CheckIcon, CopyIcon } from '../icons';

export function GenericStage({ item }: { item: Item }) {
  const meta = mediaMeta(item);
  const url = 'url' in item ? item.url : null;
  return (
    <div className="lightbox-generic">
      <div className="lightbox-generic-type">{meta.typeLabel}</div>
      <div className="lightbox-generic-title">{meta.title}</div>
      {url && (
        <a
          href={safeHttpUrl(url) ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
          className="lightbox-generic-link"
        >
          {url}
        </a>
      )}
    </div>
  );
}

/** Grid of selectable color cells (palette / swatch group / single swatch). */
export function ColorStage({
  colors,
  selected,
  onSelect,
  multi,
}: {
  colors: ColorEntry[];
  selected: number;
  onSelect: (i: number) => void;
  multi: boolean;
}) {
  if (!multi) {
    const c = colors[0]!;
    return <div className="lightbox-color-single" style={{ background: c.color }} />;
  }
  return (
    <div className="lightbox-color-grid" data-testid="lightbox-color-grid">
      {colors.map((c, i) => {
        const labelColor = luminance(c.color) > 0.55 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)';
        return (
          <button
            key={`${c.color}-${i}`}
            type="button"
            className={`lightbox-color-cell${i === selected ? ' active' : ''}`}
            style={{ background: c.color }}
            onClick={() => onSelect(i)}
            data-testid="lightbox-color-cell"
          >
            <span style={{ color: labelColor }}>{c.name ?? c.color}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Right sidebar: hex / rgb / hsl / hsv / cmyk for the active color, copyable.
 *  With onChange, the preview is a color picker and the hex field commits. */
export function ColorDetails({
  color,
  name,
  onChange,
}: {
  color: string;
  name?: string;
  onChange?: (hex: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const formats = colorFormats(color);
  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
  };
  const commitHex = () => {
    if (hexDraft === null) return;
    const t = hexDraft.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
    if (/^#[0-9a-f]{6}$/i.test(t)) onChange?.(t.toLowerCase());
    setHexDraft(null);
  };
  return (
    <aside className="lightbox-sidebar" data-testid="color-details">
      {onChange ? (
        <label className="cd-preview cd-preview-edit" title="Edit color">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}
            aria-label="Edit color"
            data-testid="cd-color-input"
            onChange={(e) => onChange(e.target.value)}
          />
          <span style={{ background: color }} />
        </label>
      ) : (
        <div className="cd-preview" style={{ background: color }} />
      )}
      {onChange && (
        <input
          className="cd-hex-input"
          value={hexDraft ?? color}
          spellCheck={false}
          aria-label="Hex color"
          data-testid="cd-hex-input"
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') setHexDraft(null);
          }}
        />
      )}
      {name && <div className="cd-name">{name}</div>}
      <div className="cd-formats">
        {formats.map((f) => (
          <button
            key={f.label}
            type="button"
            className="cd-row"
            onClick={() => copy(f.label, f.value)}
            title={`Copy ${f.label}`}
          >
            <span className="cd-label">{f.label}</span>
            <span className="cd-value">{f.value}</span>
            <span className="cd-copy" aria-hidden>
              {copied === f.label ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
