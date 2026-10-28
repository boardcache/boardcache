import { UiDialog } from '../ui/Dialog';
import { useSessionStore } from '../../state/sessionStore';

/**
 * The keyboard shortcut map ("?"): every canvas binding in one overlay,
 * grouped and data-driven so new shortcuts get added here, not in markup.
 */

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

interface Row {
  keys: string[];
  what: string;
}
interface Group {
  title: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    title: 'Tools',
    rows: [
      { keys: ['V'], what: 'Select' },
      { keys: ['H'], what: 'Hand (pan)' },
      { keys: ['Space'], what: 'Pan while held' },
      { keys: ['R'], what: 'Rectangle' },
      { keys: ['O'], what: 'Ellipse' },
      { keys: ['D'], what: 'Diamond' },
      { keys: ['S'], what: 'Star' },
      { keys: ['L'], what: 'Line' },
      { keys: ['A'], what: 'Arrow' },
      { keys: ['P'], what: 'Freehand draw' },
      { keys: ['B'], what: 'Pen (bezier path)' },
      { keys: ['T'], what: 'New text box' },
      { keys: ['C'], what: 'Crop image while held' },
    ],
  },
  {
    title: 'Pen tool',
    rows: [
      { keys: ['Click'], what: 'Corner anchor' },
      { keys: ['Drag'], what: 'Smooth anchor (pull handles)' },
      { keys: ['Alt', 'Drag anchor'], what: 'Pull new handles (corner → smooth)' },
      { keys: ['Alt', 'Click anchor'], what: 'Strip handles (smooth → corner)' },
      { keys: ['Alt', 'Drag handle'], what: 'Break the pair — move one hand' },
      { keys: [MOD, 'Drag anchor'], what: 'Move the point' },
      { keys: [MOD, 'Drag handle'], what: 'Adjust a smooth pair together' },
      { keys: ['Alt while pulling'], what: 'Break handle symmetry (cusp)' },
      { keys: [MOD, 'Z'], what: 'Undo last anchor (while drawing)' },
      { keys: [MOD, 'Click empty'], what: 'End the path' },
      { keys: ['Click first anchor'], what: 'Close path (drag to shape the join)' },
      { keys: ['Enter'], what: 'Commit open path' },
      { keys: ['Esc'], what: 'Commit — or cancel a lone anchor' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: [MOD, '+'], what: 'Zoom in' },
      { keys: [MOD, '−'], what: 'Zoom out' },
      { keys: [MOD, '0'], what: 'Zoom to 100%' },
      { keys: [MOD, 'Shift', '0'], what: 'Reset view' },
      { keys: ['F'], what: 'Fit selection (or everything)' },
      { keys: ['G'], what: 'Open gallery' },
      { keys: ['M'], what: 'Toggle minimap' },
      { keys: [MOD, 'P'], what: 'Command palette' },
      { keys: [MOD, 'Shift', 'F'], what: 'Find on board (content search)' },
      { keys: ['?'], what: 'This shortcut map' },
    ],
  },
  {
    title: 'Edit',
    rows: [
      { keys: [MOD, 'Z'], what: 'Undo' },
      { keys: [MOD, 'Shift', 'Z'], what: 'Redo' },
      { keys: [MOD, 'A'], what: 'Select all' },
      { keys: [MOD, 'C'], what: 'Copy' },
      { keys: [MOD, 'V'], what: 'Paste (items, files, smart text)' },
      { keys: [MOD, 'D'], what: 'Duplicate' },
      { keys: ['Del'], what: 'Delete selection' },
      { keys: ['←↑↓→'], what: 'Nudge 1px (Shift: 10px)' },
      { keys: [MOD, 'G'], what: 'Group' },
      { keys: [MOD, 'Shift', 'G'], what: 'Ungroup' },
      { keys: ['Dbl-click group'], what: 'Isolate group (edit members)' },
      { keys: ['Esc'], what: 'Leave group isolation' },
      { keys: [MOD, ']'], what: 'Bring forward (Shift: to front)' },
      { keys: [MOD, '['], what: 'Send backward (Shift: to back)' },
      { keys: ['Esc'], what: 'Back to select / clear selection' },
    ],
  },
];

export function ShortcutMap() {
  const open = useSessionStore((s) => s.shortcutsOpen);
  if (!open) return null;
  return (
    <UiDialog
      title="Keyboard shortcuts"
      onClose={() => useSessionStore.getState().setShortcutsOpen(false)}
      className="shortcut-map-sheet"
      size="full"
      testId="shortcut-map"
    >
      <div className="shortcut-map">
        <div className="sm-columns">
          {GROUPS.map((g) => (
            <section key={g.title} className="sm-group">
              <h3>{g.title}</h3>
              {g.rows.map((r, i) => (
                <div key={i} className="sm-row">
                  <span className="sm-keys">
                    {r.keys.map((k, j) => (
                      // A real key is a cap; a mouse action ("Drag anchor") reads as words.
                      <kbd key={j} className={/[a-z]/.test(k) && k.length > 5 ? 'sm-gesture' : ''}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span className="sm-what">{r.what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </UiDialog>
  );
}
