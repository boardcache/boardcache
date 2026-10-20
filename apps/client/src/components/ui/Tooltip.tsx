import * as T from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

/**
 * Styled tooltip replacing `title=` on chrome buttons: theme-aware, instant
 * on keyboard focus, and consistent across browsers. Each instance carries
 * its own Provider so it works anywhere (app or viewer) without root setup.
 *
 * Note: disabled elements emit no pointer events, so no tooltip shows there —
 * same as a native title.
 */
export function UiTooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <T.Provider delayDuration={450} skipDelayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content className="ui-tooltip" sideOffset={6} collisionPadding={8}>
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
