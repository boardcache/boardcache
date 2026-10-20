import type { Item } from '@boardcache/schema';
import type { MenuEntry } from './menuBuilders';
import { pluginItemMenuEntries } from '../plugins/registry';
import { useSessionStore } from '../state/sessionStore';
import { itemType } from '../itemTypes';

/**
 * One resolver for "edit this item's content": the routing that desktop
 * spreads across double-click, hover-gated ⚙ buttons, floating style panels,
 * and plugin context entries. Mobile surfaces (the selection bar's Edit
 * button, long-press → Edit) call this so every type gets a touch path.
 * Which entry a type uses is its `edit` slot in src/itemTypes.
 */

/** Types whose plugin itemMenu carries the edit dialog (Edit Map, Edit Poll). */
function pluginEditAction(item: Item): Extract<MenuEntry, { kind: 'action' }> | null {
  const actions = pluginItemMenuEntries(item).filter(
    (e): e is Extract<MenuEntry, { kind: 'action' }> => e.kind === 'action',
  );
  return (
    actions.find((e) => /^edit\b/i.test(e.label)) ??
    actions.find((e) => /\bstyle\b/i.test(e.label)) ?? // Timeline Style
    null
  );
}

export function canEditItem(item: Item): boolean {
  if (item.locked) return false;
  const edit = itemType(item).edit;
  if (!edit) return false;
  return edit.kind === 'plugin' ? pluginEditAction(item) !== null : true;
}

export function editItem(item: Item): void {
  const edit = itemType(item).edit;
  if (!edit) return;
  const session = useSessionStore.getState();
  // The style panels/sheets derive from a single selection. Only touch the
  // selection when it differs — the selection bar resets sheet flags on any
  // selection change, so a redundant set would close what we just opened.
  const soleSelected = session.selection.length === 1 && session.selection[0] === item.id;
  switch (edit.kind) {
    case 'inline':
      session.setEditingItemId(item.id);
      return;
    case 'sheet':
      // Titles: the text itself edits inline on double-tap; the Edit button
      // opens the style sheet (font, alignment, colors) like other sheet types.
      if (!soleSelected) session.setSelection([item.id]);
      session.setMobileStyleSheetOpen(true);
      return;
    case 'adjust':
      if (!soleSelected) session.setSelection([item.id]);
      session.setMobileAdjustOpen(true);
      return;
    case 'lightbox':
      // iframe: the lightbox side panel has the URL field (the in-item bar is
      // tiny). swatch/palette: the color sidebar there has the picker + hex.
      void import('../components/lightbox/Lightbox').then((m) => m.openLightbox(item));
      return;
    case 'event':
      window.dispatchEvent(new CustomEvent(edit.event, { detail: { itemId: item.id } }));
      return;
    case 'plugin':
      pluginEditAction(item)?.onSelect();
      return;
  }
}
