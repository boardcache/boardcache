import { useMemo } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { buildCanvasMenu, buildItemMenu } from '../../lib/menuBuilders';
import type { MenuEntry } from '../../lib/menuBuilders';
import { useSessionStore } from '../../state/sessionStore';
import { RadixEntries } from '../menu/RadixEntries';

/**
 * The canvas context menu: Radix DropdownMenu anchored to an invisible
 * trigger at the right-click point. Radix supplies dismissal, keyboard
 * navigation, and viewport collision handling (no manual clamping).
 */
export function ContextMenu() {
  const menu = useSessionStore((s) => s.contextMenu);
  const close = () => useSessionStore.getState().setContextMenu(null);

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return [];
    return menu.itemId
      ? buildItemMenu(menu.itemId)
      : buildCanvasMenu(clientToCanvas(menu.x, menu.y));
    // Rebuild whenever the menu (re)opens so disabled states are fresh.
  }, [menu]);

  if (!menu) return null;

  return (
    <DM.Root open onOpenChange={(open) => !open && close()}>
      <DM.Trigger asChild>
        <span
          style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }}
          aria-hidden
        />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu-panel menu-list context-menu"
          data-testid="context-menu"
          align="start"
          side="bottom"
          sideOffset={2}
          collisionPadding={8}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <RadixEntries entries={entries} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
