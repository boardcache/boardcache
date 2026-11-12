import { useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import type { TextItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  PinIcon,
  PlusIcon,
  SplitDownIcon,
  SplitRightIcon,
} from '../../components/icons';
import { RadixEntries } from '../../components/menu/RadixEntries';
import type { MenuEntry } from '../../lib/menuBuilders';
import { noteTitle } from '../../lib/text/wikilinks';
import { useDocumentStore } from '../../state/documentStore';
import { NoteEditor } from './NoteEditor';
import { createNote } from './notesModel';
import { paneNoteId, useNotesUi, type NotesLayout, type NotesTab, type SplitSide } from './store';

const TAB_DRAG = 'application/x-boardcache-note-tab';

const SPLIT_ENTRIES: { side: SplitSide; label: string; icon: React.ReactNode }[] = [
  { side: 'right', label: 'Split right', icon: <SplitRightIcon size={14} /> },
  { side: 'left', label: 'Split left', icon: <SplitRightIcon size={14} /> },
  { side: 'below', label: 'Split down', icon: <SplitDownIcon size={14} /> },
  { side: 'above', label: 'Split up', icon: <SplitDownIcon size={14} /> },
];

/**
 * The stage: the panes as the layout divides them, side by side or one
 * above the other, with a bar between two halves to drag.
 */
export function NotesStage({ layout }: { layout: NotesLayout }) {
  if (layout.kind === 'pane') return <NotesPane id={layout.id} />;
  const { id, dir, a, b, ratio } = layout;
  return (
    <div className={`notes-split notes-split-${dir}`} data-testid="notes-split" data-dir={dir}>
      <div className="notes-split-half" style={{ flexGrow: ratio }}>
        <NotesStage layout={a} />
      </div>
      <SplitHandle splitId={id} dir={dir} />
      <div className="notes-split-half" style={{ flexGrow: 1 - ratio }}>
        <NotesStage layout={b} />
      </div>
    </div>
  );
}

/** The bar between two halves: drag to share the room between them. */
function SplitHandle({ splitId, dir }: { splitId: string; dir: 'row' | 'column' }) {
  const start = useRef<{ at: number; size: number; from: number } | null>(null);
  return (
    <div
      className="notes-split-handle"
      role="separator"
      aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'}
      aria-label="Pane size"
      data-testid="notes-split-handle"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const box = e.currentTarget.parentElement!.getBoundingClientRect();
        const size = dir === 'row' ? box.width : box.height;
        const from = dir === 'row' ? box.left : box.top;
        start.current = { at: dir === 'row' ? e.clientX : e.clientY, size, from };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.size <= 0) return;
        const at = dir === 'row' ? e.clientX : e.clientY;
        useNotesUi.getState().setSplitRatio(splitId, (at - s.from) / s.size);
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    />
  );
}

/**
 * One pane of the stage: its tabs (with Back and Forward through what the
 * active tab has shown, pins, a drag to reorder or to another pane, and a
 * menu to split the pane) and the active note, or the empty state.
 */
export function NotesPane({ id }: { id: string }) {
  const pane = useNotesUi((s) => s.panes.find((p) => p.id === id));
  const focused = useNotesUi((s) => s.focused === id);
  const only = useNotesUi((s) => s.panes.length < 2);
  const tabs = pane?.tabs ?? [];
  const active = pane?.active ?? null;
  const noteId = paneNoteId(pane);
  const note = useDocumentStore((s) => {
    const it = noteId ? s.doc.items[noteId] : undefined;
    return it?.type === 'text' ? (it as TextItem) : null;
  });
  const titles = useDocumentStore(
    useShallow((s) =>
      Object.fromEntries(
        tabs.map((t) => {
          const it = s.doc.items[t.noteId];
          return [t.id, it?.type === 'text' ? noteTitle(it) : 'Untitled'];
        }),
      ),
    ),
  );
  const activeTab = tabs.find((t) => t.id === active);
  const canBack = !!activeTab?.back?.length;
  const canForward = !!activeTab?.forward?.length;
  const ui = () => useNotesUi.getState();
  const newNote = () => {
    const noteId = createNote('');
    ui().openNote(noteId, { newTab: true, pane: id });
    ui().setMode('edit');
    ui().setTitleFocus(noteId);
  };

  // A tab's menu: pin, split, close, close the others, close the pane.
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tab: NotesTab } | null>(null);
  const tabMenuEntries = (tab: NotesTab): MenuEntry[] => [
    {
      kind: 'action',
      label: tab.pinned ? 'Unpin tab' : 'Pin tab',
      onSelect: () => ui().togglePin(tab.id),
    },
    {
      kind: 'submenu',
      label: 'Open in a split',
      children: SPLIT_ENTRIES.map((s) => ({
        kind: 'action' as const,
        label: s.label,
        icon: s.icon,
        onSelect: () => ui().splitPane(s.side, { pane: id, noteId: tab.noteId }),
      })),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Close tab',
      disabled: !!tab.pinned,
      onSelect: () => ui().closeTab(tab.id),
    },
    {
      kind: 'action',
      label: 'Close other tabs',
      disabled: !tabs.some((t) => t.id !== tab.id && !t.pinned),
      onSelect: () => ui().closeOthers(tab.id),
    },
    {
      kind: 'action',
      label: 'Close pane',
      disabled: only,
      onSelect: () => ui().closePane(id),
    },
  ];

  return (
    <main
      className={`notes-main notes-pane${focused ? ' focused' : ''}`}
      data-testid="notes-pane"
      data-focused={focused ? 'true' : undefined}
      onPointerDownCapture={() => ui().focusPane(id)}
    >
      <div
        className="notes-tabs"
        role="tablist"
        data-testid="notes-tabs"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TAB_DRAG)) e.preventDefault();
        }}
        onDrop={(e) => {
          // Dropped past the last tab: it goes to the end (of this pane).
          const tabId = e.dataTransfer.getData(TAB_DRAG);
          if (tabId) {
            e.preventDefault();
            ui().moveTab(tabId, null, id);
          }
        }}
      >
        <span className="notes-nav" role="group" aria-label="History">
          <button
            type="button"
            className="view-icon-btn small"
            aria-label="Back"
            title="Back (Alt+Left)"
            disabled={!canBack}
            data-testid="notes-nav-back"
            onClick={() => {
              ui().focusPane(id);
              ui().goBack();
            }}
          >
            <ChevronLeftIcon size={14} />
          </button>
          <button
            type="button"
            className="view-icon-btn small"
            aria-label="Forward"
            title="Forward (Alt+Right)"
            disabled={!canForward}
            data-testid="notes-nav-forward"
            onClick={() => {
              ui().focusPane(id);
              ui().goForward();
            }}
          >
            <ChevronRightIcon size={14} />
          </button>
        </span>
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={`notes-tab${t.id === active ? ' active' : ''}${t.pinned ? ' pinned' : ''}`}
            data-testid="notes-tab"
            data-pinned={t.pinned ? 'true' : undefined}
            onContextMenu={(e) => {
              e.preventDefault();
              setTabMenu({ x: e.clientX, y: e.clientY, tab: t });
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_DRAG, t.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(TAB_DRAG)) e.preventDefault();
            }}
            onDrop={(e) => {
              const tabId = e.dataTransfer.getData(TAB_DRAG);
              if (tabId) {
                e.preventDefault();
                e.stopPropagation();
                ui().moveTab(tabId, t.id, id);
              }
            }}
            onClick={() => ui().activate(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1) ui().closeTab(t.id);
            }}
          >
            <span className="notes-tab-label">{titles[t.id] ?? 'Untitled'}</span>
            {t.pinned ? (
              <button
                type="button"
                className="notes-tab-close"
                aria-label="Unpin tab"
                title="Pinned (click to unpin)"
                data-testid="notes-tab-pin"
                onClick={(e) => {
                  e.stopPropagation();
                  ui().togglePin(t.id);
                }}
              >
                <PinIcon size={11} />
              </button>
            ) : (
              <button
                type="button"
                className="notes-tab-close"
                aria-label="Close tab"
                title="Close tab"
                data-testid="notes-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  ui().closeTab(t.id);
                }}
              >
                <CloseIcon size={11} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="notes-tab-new"
          aria-label="New note"
          title="New note"
          data-testid="notes-tab-new"
          onClick={newNote}
        >
          <PlusIcon size={14} />
        </button>
        <span className="notes-tabs-end">
          <DM.Root>
            <DM.Trigger asChild>
              <button
                type="button"
                className="view-icon-btn small"
                aria-label="Split the pane"
                title="Split the pane: see two notes at once"
                data-testid="notes-split-menu"
              >
                <SplitRightIcon size={14} />
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content
                className="menu-panel menu-list popper-menu"
                data-testid="notes-split-choices"
                align="end"
                sideOffset={4}
                collisionPadding={8}
              >
                <RadixEntries
                  entries={[
                    ...SPLIT_ENTRIES.map(
                      (s): MenuEntry => ({
                        kind: 'action',
                        label: s.label,
                        icon: s.icon,
                        onSelect: () => ui().splitPane(s.side, { pane: id }),
                      }),
                    ),
                    { kind: 'separator' },
                    {
                      kind: 'action',
                      label: 'Close pane',
                      disabled: only,
                      onSelect: () => ui().closePane(id),
                    },
                  ]}
                />
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        </span>
      </div>
      {note ? (
        <NoteEditor key={note.id} note={note} focused={focused} />
      ) : (
        <div className="notes-empty" data-testid="notes-empty-stage">
          <p>Pick a note on the left, or start one.</p>
          <button type="button" className="btn" onClick={newNote}>
            <PlusIcon size={14} /> New note
          </button>
        </div>
      )}
      {tabMenu && (
        <DM.Root open onOpenChange={(open) => !open && setTabMenu(null)}>
          <DM.Trigger asChild>
            <span
              style={{ position: 'fixed', left: tabMenu.x, top: tabMenu.y, width: 0, height: 0 }}
              aria-hidden
            />
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              className="menu-panel menu-list context-menu"
              data-testid="notes-tab-menu"
              align="start"
              side="bottom"
              sideOffset={2}
              collisionPadding={8}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <RadixEntries entries={tabMenuEntries(tabMenu.tab)} />
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
    </main>
  );
}
