import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { UiDialog } from '../ui/Dialog';
import { SettingsTextarea } from '../ui/SettingsForm';
import { setTemplateRecipe, templateRecipe } from '../../lib/board/boardLibrary';

/**
 * A template's recipe: the instructions an agent follows on a fresh board
 * made from it (start_recipe hands them over; the MCP server lists each
 * recipe as a prompt). Opened from the template card and from File →
 * Recipe instructions on an open template.
 */

interface RecipeDialogState {
  target: { id: string; name: string } | null;
  open: (id: string, name: string) => void;
  close: () => void;
}

export const useRecipeDialog = create<RecipeDialogState>((set) => ({
  target: null,
  open: (id, name) => set({ target: { id, name } }),
  close: () => set({ target: null }),
}));

export function RecipeDialog() {
  const target = useRecipeDialog((s) => s.target);
  return target ? <Body key={target.id} id={target.id} name={target.name} /> : null;
}

function Body({ id, name }: { id: string; name: string }) {
  const close = useRecipeDialog((s) => s.close);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let on = true;
    void templateRecipe(id).then((t) => {
      if (on) setText(t);
    });
    return () => {
      on = false;
    };
  }, [id]);
  const save = async () => {
    if (text === null) return;
    setBusy(true);
    await setTemplateRecipe(id, text);
    setBusy(false);
    close();
  };
  return (
    <UiDialog title={`Recipe for “${name}”`} onClose={close} testId="recipe-dialog">
      <p className="settings-hint">
        What an agent should do with a fresh board made from this template. Agents see it through{' '}
        <code>start_recipe</code>, and Claude Code lists it as a prompt. Leave it empty and the
        template is just a template.
      </p>
      <SettingsTextarea
        rows={10}
        value={text ?? ''}
        disabled={text === null}
        placeholder="Read the brief the person gives you, then fill each section of this board in turn: the title card, the three pillars, the timeline. Keep the palette. Finish with check_board."
        testId="recipe-text"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ui-prompt-actions">
        <button type="button" data-testid="recipe-cancel" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="sync-primary"
          data-testid="recipe-save"
          disabled={busy || text === null}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </UiDialog>
  );
}
