import type { ReactNode } from 'react';
import { CodeIcon, ColumnsIcon, EyeIcon, PencilIcon } from '../../components/icons';
import { UiTooltip } from '../../components/ui/Tooltip';
import { useNarrowPortrait } from '../../hooks/useMobileViewport';
import { flushNote } from './notesModel';
import { activeNoteId, useNotesUi, type NotesMode } from './store';

const MODES: NotesMode[] = ['edit', 'source', 'preview', 'split'];
const MODE_LABEL: Record<NotesMode, string> = {
  edit: 'Edit',
  source: 'Source',
  preview: 'Preview',
  split: 'Split',
};
const MODE_HINT: Record<NotesMode, string> = {
  edit: 'Edit: the page as you write it (Ctrl/Cmd+E switches)',
  source: 'Source: the plain Markdown',
  preview: 'Preview (Ctrl/Cmd+E switches)',
  split: 'Split: source and preview',
};
const MODE_ICON: Record<NotesMode, ReactNode> = {
  edit: <PencilIcon size={16} />,
  source: <CodeIcon size={16} />,
  preview: <EyeIcon size={16} />,
  split: <ColumnsIcon size={16} />,
};

/** The mode a remembered choice shows as: a phone held upright has no room
 *  for Split, so it reads as Edit until the phone turns. */
export function shownNotesMode(mode: NotesMode, narrow: boolean): NotesMode {
  return narrow && mode === 'split' ? 'edit' : mode;
}

/**
 * Edit / Source / Preview / Split, in the middle of the view bar, as flat
 * icons like the bar's other buttons (the one that is on carries the bar's
 * quiet highlight): one choice for every pane. Switching saves the open note's draft first, so
 * nothing typed is lost between the editor and the page.
 */
export function NoteModeSwitch() {
  const mode = useNotesUi((s) => s.mode);
  const narrow = useNarrowPortrait();
  const shown = shownNotesMode(mode, narrow);
  const modes = narrow ? MODES.filter((m) => m !== 'split') : MODES;
  const change = (m: NotesMode) => {
    const ui = useNotesUi.getState();
    const id = activeNoteId(ui);
    if (id) flushNote(id);
    ui.setMode(m);
  };
  return (
    <div className="notes-mode-switch" role="radiogroup" aria-label="Editor mode">
      {modes.map((m) => (
        <UiTooltip label={MODE_HINT[m]} key={m}>
          <button
            type="button"
            role="radio"
            aria-checked={shown === m}
            className={`view-icon-btn${shown === m ? ' active' : ''}`}
            data-testid={`notes-mode-${m}`}
            aria-label={MODE_LABEL[m]}
            onClick={() => change(m)}
          >
            {MODE_ICON[m]}
          </button>
        </UiTooltip>
      ))}
    </div>
  );
}
