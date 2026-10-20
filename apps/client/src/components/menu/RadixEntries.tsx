import * as DM from '@radix-ui/react-dropdown-menu';
import type { MenuEntry } from '../../lib/menuBuilders';
import { isPhoneViewport } from '../../lib/mobile';
import { CheckIcon, ChevronRightIcon } from '../icons';

/**
 * Renders a MenuEntry tree with Radix DropdownMenu primitives — same
 * declarative menu data as before, but with keyboard navigation, typeahead,
 * focus management, and collision-aware submenus for free. Styling stays on
 * the app's .menu-* classes.
 */
export function RadixEntries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <DM.Separator key={i} className="menu-separator" />;
        }
        if (entry.kind === 'header') {
          return (
            <DM.Label key={i} className="menu-header">
              {entry.label}
            </DM.Label>
          );
        }
        if (entry.kind === 'submenu') {
          // Phones: fly-out submenus overflow narrow screens — flatten the
          // children inline under a section header instead. (Tablets keep
          // real fly-outs; they have the room.)
          if (isPhoneViewport()) {
            return (
              <div key={i} className="menu-inline-sub">
                <DM.Label className="menu-header">{entry.label}</DM.Label>
                <RadixEntries entries={entry.children} />
              </div>
            );
          }
          return (
            <DM.Sub key={i}>
              <DM.SubTrigger className="menu-item has-submenu" aria-label={entry.label}>
                {entry.icon && <span className="menu-icon">{entry.icon}</span>}
                <span className="menu-label">{entry.label}</span>
                <span className="menu-caret">
                  <ChevronRightIcon size={14} />
                </span>
              </DM.SubTrigger>
              <DM.Portal>
                <DM.SubContent
                  className="menu-panel menu-list"
                  sideOffset={2}
                  alignOffset={-5}
                  collisionPadding={8}
                >
                  <RadixEntries entries={entry.children} />
                </DM.SubContent>
              </DM.Portal>
            </DM.Sub>
          );
        }
        return (
          <DM.Item
            key={i}
            className={['menu-item', entry.danger ? 'danger' : ''].filter(Boolean).join(' ')}
            {...(entry.disabled ? { disabled: true } : {})}
            onSelect={(e) => {
              if (entry.keepOpen) e.preventDefault();
              entry.onSelect();
            }}
          >
            {entry.icon && <span className="menu-icon">{entry.icon}</span>}
            <span className="menu-label">{entry.label}</span>
            {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
            {entry.checked && (
              <span className="menu-check" aria-hidden>
                <CheckIcon size={14} />
              </span>
            )}
          </DM.Item>
        );
      })}
    </>
  );
}
