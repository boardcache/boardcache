import './style.css';
import { useState } from 'react';
import { create } from 'zustand';
import type { PollItem } from '@boardcache/schema';
import { z } from 'zod';
import { VoteIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createPollItem } from '../../lib/import/createItems';
import { setPollClosed, updateItems } from '../../state/commands';
import { collabActive } from '../../state/collabStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';

/**
 * Polls plugin: team voting cards. The `poll` item type is core (votes are
 * doc state that mirrors live into team rooms); this plugin is the
 * create/edit UX.
 */

const PLUGIN_ID = 'polls';

interface Draft {
  question: string;
  /** One option per line. */
  options: string;
  multiple: boolean;
}

interface DialogState {
  open: { editItemId: string | null; initial: Draft } | null;
  openNew: () => void;
  openEdit: (item: PollItem) => void;
  close: () => void;
}

const usePollDialog = create<DialogState>((set) => ({
  open: null,
  openNew: () =>
    set({ open: { editItemId: null, initial: { question: '', options: '', multiple: false } } }),
  openEdit: (item) =>
    set({
      open: {
        editItemId: item.id,
        initial: {
          question: item.question,
          options: item.options.map((o) => o.label).join('\n'),
          multiple: item.multiple,
        },
      },
    }),
  close: () => set({ open: null }),
}));

function PollDialog() {
  const open = usePollDialog((s) => s.open);
  return open ? <PollDialogBody key={open.editItemId ?? 'new'} /> : null;
}

function PollDialogBody() {
  const { editItemId, initial } = usePollDialog.getState().open!;
  const close = () => usePollDialog.getState().close();
  const [draft, setDraft] = useState<Draft>(initial);

  const optionLabels = draft.options
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const valid = draft.question.trim().length > 0 && optionLabels.length >= 2;

  const save = () => {
    if (editItemId) {
      updateItems([editItemId], 'Edit poll', (d) => {
        if (d.type !== 'poll') return;
        d.question = draft.question.trim();
        d.multiple = draft.multiple;
        // Preserve option ids (and their votes) for unchanged labels; new
        // labels get fresh ids; removed options drop their votes.
        const oldByLabel = new Map(d.options.map((o) => [o.label, o.id]));
        const options = optionLabels.map((label, i) => ({
          id: oldByLabel.get(label) ?? `opt-${Date.now().toString(36)}-${i}`,
          label,
        }));
        const validIds = new Set(options.map((o) => o.id));
        d.options = options;
        for (const [key, vote] of Object.entries(d.votes)) {
          vote.optionIds = vote.optionIds.filter((id) => validIds.has(id));
          if (vote.optionIds.length === 0) delete d.votes[key];
        }
      });
    } else {
      createPollItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2), {
        question: draft.question.trim(),
        options: optionLabels.map((label, i) => ({ id: `opt-${i + 1}`, label })),
        multiple: draft.multiple,
      });
    }
    close();
  };

  return (
    <UiDialog
      title={editItemId ? 'Edit Poll' : 'Add Poll'}
      onClose={close}
      className="poll-sheet"
      testId="poll-dialog"
    >
      <div className="poll-form">
        <input
          className="poll-form-question"
          value={draft.question}
          placeholder="Ask the team something"
          data-testid="poll-question"
          onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
        />
        <label className="poll-form-block">
          Options — one per line (at least two)
          <textarea
            value={draft.options}
            data-testid="poll-options"
            onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))}
          />
        </label>
        <label className="poll-form-check">
          <input
            type="checkbox"
            checked={draft.multiple}
            data-testid="poll-multiple"
            onChange={(e) => setDraft((d) => ({ ...d, multiple: e.target.checked }))}
          />
          Allow choosing multiple options
        </label>
        {editItemId && (
          <p className="poll-form-hint">
            Renamed or removed options drop their existing votes; unchanged options keep theirs.
          </p>
        )}
        <div className="poll-form-actions">
          <button
            type="button"
            className="sync-primary"
            disabled={!valid}
            data-testid="poll-save"
            onClick={save}
          >
            {editItemId ? 'Save Poll' : 'Add to Board'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

const pollToolSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).describe('Option labels, at least two'),
  multiple: z.boolean().optional().describe('Allow multiple selections (default false)'),
  x: z.number().optional(),
  y: z.number().optional(),
});

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 56,
    name: 'Polls',
    description:
      'Team voting cards: ask a question, teammates vote live on the canvas, results fill in as bars.',
  },
  addMenu: [
    {
      label: 'Add Poll',
      category: 'misc',
      icon: <VoteIcon />,
      // Solo boards have exactly one possible voter — polls only make sense
      // where teammates can vote, so the entry appears on live team boards.
      when: collabActive,
      onSelect: () => {
        const selection = useSessionStore.getState().selection;
        const item =
          selection.length === 1 ? useDocumentStore.getState().doc.items[selection[0]!] : null;
        if (item?.type === 'poll') usePollDialog.getState().openEdit(item);
        else usePollDialog.getState().openNew();
      },
    },
  ],
  Component: PollDialog,
  itemMenu: (item) =>
    item.type === 'poll'
      ? [
          {
            kind: 'action',
            label: 'Edit Poll',
            icon: <VoteIcon />,
            onSelect: () => usePollDialog.getState().openEdit(item),
          },
          {
            kind: 'action',
            label: item.closed ? 'Reopen Poll' : 'Close Poll',
            icon: <VoteIcon />,
            onSelect: () => setPollClosed(item.id, !item.closed),
          },
        ]
      : [],
  tools: [
    {
      name: 'create_poll',
      description:
        'Create a poll card on the board: a question with options that team members vote on live. Results render as bars on the card.',
      parameters: pollToolSchema,
      access: 'write',
      execute: (args, ctx) => {
        if (!collabActive()) {
          return {
            error:
              'Polls need a live team board — votes come from teammates. Convert this board to a team room first (File → Team), then create the poll.',
          };
        }
        const center = ctx.viewCenter();
        const at = { x: args.x ?? center.x, y: args.y ?? center.y };
        const id = createPollItem(at, {
          question: args.question,
          options: (args.options as string[]).map((label: string, i: number) => ({
            id: `opt-${i + 1}`,
            label,
          })),
          multiple: args.multiple ?? false,
        });
        return { id };
      },
    },
  ],
});
