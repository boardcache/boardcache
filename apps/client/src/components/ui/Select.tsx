import type { CSSProperties, ReactNode } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon } from '../icons';

export interface UiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Options with the same group render under one heading, in the order first seen. */
  group?: string;
  /** Style on the option row (a font's own face, for instance). */
  style?: CSSProperties;
}

/**
 * Styled select on Radix primitives: a fully themeable trigger + popover panel
 * (native <select> popups can't be styled), with keyboard navigation and
 * typeahead for free. Panel/items reuse the app's menu design language —
 * checkmark on the right of the active option.
 */
export function UiSelect({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
  placeholder,
  trigger,
}: {
  /** Current value; use '' with a placeholder for action-style selects. */
  value: string;
  options: UiSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  testId?: string;
  placeholder?: string;
  /** An icon-only trigger (a square button) instead of the value-and-caret box. */
  trigger?: ReactNode;
}) {
  const item = (o: UiSelectOption) => (
    <RadixSelect.Item
      key={o.value}
      value={o.value}
      {...(o.disabled !== undefined ? { disabled: o.disabled } : {})}
      className="ui-select-item"
      {...(o.style ? { style: o.style } : {})}
    >
      <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="ui-select-check">
        <CheckIcon size={14} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    // Always controlled: an action-style select (value '' + placeholder) goes
    // back to its placeholder after a pick instead of showing the option it
    // just fired, and a pick never remounts anything mid-click.
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        className={trigger ? 'ui-select-trigger ui-select-icon' : 'ui-select-trigger'}
        aria-label={ariaLabel}
        title={trigger ? ariaLabel : undefined}
        {...(testId ? { 'data-testid': testId } : {})}
      >
        {trigger ?? (
          <>
            <RadixSelect.Value placeholder={placeholder} />
            <RadixSelect.Icon className="ui-select-caret">
              <ChevronDownIcon size={16} />
            </RadixSelect.Icon>
          </>
        )}
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="ui-select-content" position="popper" sideOffset={6}>
          <RadixSelect.Viewport className="ui-select-viewport">
            {groups.map((g) =>
              g === undefined ? (
                options.filter((o) => o.group === undefined).map(item)
              ) : (
                <RadixSelect.Group key={g}>
                  <RadixSelect.Label className="ui-select-group">{g}</RadixSelect.Label>
                  {options.filter((o) => o.group === g).map(item)}
                </RadixSelect.Group>
              ),
            )}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
