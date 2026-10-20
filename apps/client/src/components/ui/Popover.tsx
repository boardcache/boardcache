import * as P from '@radix-ui/react-popover';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Thin Radix Popover wrapper: anchored floating panel with outside-click and
 * Escape dismissal, portaled to the body (callers style the panel class).
 * Non-modal — no focus trap; opening doesn't steal focus from the trigger.
 */
export const UiPopover = P.Root;
export const UiPopoverTrigger = P.Trigger;

export function UiPopoverContent({
  className,
  children,
  ...props
}: {
  className: string;
  children: ReactNode;
} & Pick<ComponentProps<typeof P.Content>, 'side' | 'align' | 'style'>) {
  return (
    <P.Portal>
      <P.Content
        className={className}
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        {...props}
      >
        {children}
      </P.Content>
    </P.Portal>
  );
}
