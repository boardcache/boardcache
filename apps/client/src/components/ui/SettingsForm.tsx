import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { CheckIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon } from '../icons';

/**
 * The settings-form kit. Every settings surface (Settings panes, plugin
 * pages, connection forms) is built from these pieces so forms read alike:
 * a titled group card holds field rows; a row puts the label and its hint on
 * the left and one control on the right; badges qualify a label; external
 * links carry the arrow icon; secrets get a reveal toggle. Rules and
 * examples: docs/UI_KIT.md.
 */

/** A titled card of related fields. */
export function SettingsGroup({
  title,
  hint,
  children,
  testId,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="settings-card settings-group"
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <h4>{title}</h4>
      {hint ? <p className="settings-hint">{hint}</p> : null}
      <div className="settings-fields">{children}</div>
    </section>
  );
}

/**
 * One row: label (+ badges) and hint on the left, the control on the right.
 * `wide` stacks the control under the text for tall controls (text areas,
 * previews). The row is a <label>, so clicking the text focuses the control.
 */
export function SettingsField({
  label,
  hint,
  badges,
  wide = false,
  children,
  testId,
}: {
  label: ReactNode;
  hint?: ReactNode;
  badges?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <label
      className={wide ? 'settings-field settings-field-wide' : 'settings-field'}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <span className="settings-field-text">
        <span className="settings-field-label">
          {label}
          {badges}
        </span>
        {hint ? <span className="settings-field-hint">{hint}</span> : null}
      </span>
      {children ? <span className="settings-field-control">{children}</span> : null}
    </label>
  );
}

/** A small pill after a label: "Desktop app", "Optional", "Beta". */
export function SettingsBadge({ children }: { children: ReactNode }) {
  return <span className="settings-badge">{children}</span>;
}

/** An external link inside a hint, opened in a new tab, with the arrow icon. */
export function SettingsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="settings-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <ExternalLinkIcon size={12} />
    </a>
  );
}

/** A quiet status in the control column when there is nothing to set: "No key needed". */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <span className="settings-field-note">
      <CheckIcon size={13} />
      {children}
    </span>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { testId?: string };

/** A single-line text input in the kit's chassis. */
export function SettingsInput({ testId, ...props }: InputProps) {
  return (
    <input className="settings-input" {...(testId ? { 'data-testid': testId } : {})} {...props} />
  );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  testId?: string;
};

/** A multi-line input in the kit's chassis; pair with a `wide` field. */
export function SettingsTextarea({ testId, ...props }: TextareaProps) {
  return (
    <textarea
      className="settings-input settings-textarea"
      {...(testId ? { 'data-testid': testId } : {})}
      {...props}
    />
  );
}

/** A key or token: masked, with a reveal toggle; never autofilled or spell-checked. */
export function SecretInput({
  value,
  onChange,
  placeholder = 'API key',
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  testId?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="settings-secret">
      <input
        className="settings-input"
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        {...(testId ? { 'data-testid': testId } : {})}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="settings-secret-toggle"
        aria-label={shown ? 'Hide' : 'Show'}
        aria-pressed={shown}
        tabIndex={-1}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
      </button>
    </span>
  );
}

/** A right-aligned row of buttons under a group's fields. */
export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className="settings-actions">{children}</div>;
}
