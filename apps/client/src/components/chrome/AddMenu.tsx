import { useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { clientToCanvas, lastPointerCanvas } from '../../lib/canvas/canvasDom';
import { canCaptureScreen } from '../../lib/mobile';
import {
  createTitleItem,
  createIframeItem,
  createLinkItem,
  createSwatchItem,
  createTextItem,
} from '../../lib/import/createItems';
import { MEDIA_ACCEPT } from '../../lib/import/importMedia';
import { importFiles } from '../../lib/import/importFiles';
import { createVideoEmbed } from '../../lib/import/importVideos';
import type { MenuEntry } from '../../lib/menuBuilders';
import {
  pickColorViaInput,
  pickColorViaScreen,
  supportsEyeDropper,
} from '../../lib/color/pickColor';
import { parseVideoUrl } from '../../lib/media/videoEmbed';
import {
  ADD_CATEGORY_LABELS,
  ADD_CATEGORY_ORDER,
  useEnabledPlugins,
  type AddMenuCategory,
  type PluginAddMenuEntry,
} from '../../plugins/registry';
import { useSessionStore } from '../../state/sessionStore';
import { useImportUrlDialog } from '../dialogs/ImportUrlDialog';
import { UiDialog } from '../ui/Dialog';
import { RadixEntries } from '../menu/RadixEntries';
import {
  HeadingIcon,
  CameraIcon,
  DropletIcon,
  EyedropperIcon,
  FileTextIcon,
  FilmIcon,
  CloseIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  MicIcon,
  PaletteIcon,
  PlusIcon,
  ScreenShareIcon,
  ScreenshotIcon,
  TypeIcon,
  VideoIcon,
  BoardsIcon,
} from '../icons';
import { promptText } from '../ui/Prompt';
import { showNotice } from '../../lib/notices';

/** Add-menu placement: mid-screen in canvas coords. Works from the gallery
 *  too — without a mounted canvas, clientToCanvas maps window coords through
 *  the document viewport, which is the same thing. Creators handle spacing. */
function viewCenterCanvas() {
  return clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
}

interface AddSection {
  heading: string;
  entries: MenuEntry[];
}

const SECTION_RANK = new Map<string, number>(
  ADD_CATEGORY_ORDER.map((c, i) => [ADD_CATEGORY_LABELS[c], i]),
);

/** A section header, in item rows, for balancing. */
const HEADER_ROWS = 0.6;

/**
 * Pack the sections into columns of near-equal height so no column trails a
 * tall blank. Sections keep category order inside a column and columns are
 * ordered by their first section, so Media always leads. Every packing is
 * tried (sections are few); the shortest tallest column wins, the most even
 * split breaks ties.
 */
function packColumns(sections: AddSection[], columns: number): AddSection[][] {
  const rows = sections.map((s) => s.entries.length + HEADER_ROWS);
  let best: number[] | null = null;
  let bestScore: [number, number] = [Infinity, Infinity];
  const assign: number[] = [];
  const walk = (i: number, used: number) => {
    if (i === sections.length) {
      const heights = new Array<number>(used).fill(0);
      assign.forEach((col, j) => (heights[col]! += rows[j]!));
      const score: [number, number] = [
        Math.max(...heights),
        heights.reduce((sum, h) => sum + h * h, 0),
      ];
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        bestScore = score;
        best = [...assign];
      }
      return;
    }
    // A section may join an open column or open the next one: this orders
    // columns by their first section and never repeats a packing.
    for (let col = 0; col <= Math.min(used, columns - 1); col++) {
      assign.push(col);
      walk(i + 1, Math.max(used, col + 1));
      assign.pop();
    }
  };
  walk(0, 0);
  const stacks: AddSection[][] = [];
  (best ?? []).forEach((col, j) => (stacks[col] ??= []).push(sections[j]!));
  return stacks;
}

function MegaColumns({ build }: { build: () => AddSection[] }) {
  const stacks = packColumns(build(), 3);
  return (
    <div className="menu-mega-grid">
      {stacks.map((stack) => (
        <div className="menu-mega-stack" key={stack[0]!.heading}>
          {stack.map((section) => (
            <div className="menu-mega-col" key={section.heading}>
              <DM.Label className="menu-header">{section.heading}</DM.Label>
              <RadixEntries entries={section.entries} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The + Add mega-menu, shared by the canvas menu bar and the gallery header.
 * Owns its hidden file inputs so any host surface can offer every add flow.
 */
/** The Add menu's sections, outside React too (the command palette lists
 *  them): system entries, with each enabled plugin's filed under its category. */
export function buildAddSectionsFor(opts: {
  pluginEntries: PluginAddMenuEntry[];
  pickImage: () => void;
  pickTextFile: () => void;
  pickAse: () => void;
}): AddSection[] {
  // Plugin entries file into the same fixed categories as system entries.
  const pluginsFor = (cat: AddMenuCategory): MenuEntry[] =>
    opts.pluginEntries
      .filter((e) => (e.category ?? 'misc') === cat)
      .filter((e) => e.when?.() ?? true)
      .map(
        (entry): MenuEntry => ({
          kind: 'action',
          label: entry.label,
          icon: entry.icon,
          onSelect: entry.onSelect,
        }),
      );

  return [
    {
      heading: ADD_CATEGORY_LABELS.media,
      entries: [
        {
          kind: 'action' as const,
          label: 'Add Media from File',
          icon: <ImageIcon />,
          onSelect: () => opts.pickImage(),
        },
        {
          kind: 'action' as const,
          label: 'Import from URL',
          icon: <LinkIcon />,
          onSelect: () => useImportUrlDialog.getState().toggle(true),
        },
        {
          kind: 'action' as const,
          label: 'Embed Video',
          icon: <VideoIcon />,
          onSelect: () =>
            void promptText({
              title: 'Embed video',
              label: 'YouTube or Vimeo URL',
              type: 'url',
            }).then((input) => {
              if (!input) return;
              const embed = parseVideoUrl(input);
              if (embed) createVideoEmbed(embed, viewCenterCanvas());
              else
                showNotice('That does not look like a YouTube or Vimeo URL.', {
                  id: 'embed-video',
                  kind: 'warn',
                });
            }),
        },
        {
          kind: 'action' as const,
          label: 'Take Photo',
          icon: <CameraIcon />,
          onSelect: () => useSessionStore.getState().setCaptureMode('photo'),
        },
        {
          kind: 'action' as const,
          label: 'Record Video',
          icon: <FilmIcon />,
          onSelect: () => useSessionStore.getState().setCaptureMode('video'),
        },
        // Screen capture is platform-gated (no getDisplayMedia on iOS) —
        // impossible features hide rather than disable.
        ...(canCaptureScreen()
          ? [
              {
                kind: 'action' as const,
                label: 'Record Screen',
                icon: <ScreenShareIcon />,
                onSelect: () => useSessionStore.getState().setCaptureMode('screen'),
              },
              {
                kind: 'action' as const,
                label: 'Take a Screenshot',
                icon: <ScreenshotIcon />,
                onSelect: () => useSessionStore.getState().setCaptureMode('screenshot'),
              },
            ]
          : []),
        {
          kind: 'action' as const,
          label: 'Record Audio',
          icon: <MicIcon />,
          onSelect: () => useSessionStore.getState().setCaptureMode('audio'),
        },
        ...pluginsFor('media'),
      ],
    },
    {
      heading: ADD_CATEGORY_LABELS.colors,
      entries: [
        {
          kind: 'action' as const,
          label: 'Add a Color',
          icon: <DropletIcon />,
          onSelect: async () => {
            const color = await pickColorViaInput();
            if (color) createSwatchItem(lastPointerCanvas(), color);
          },
        },
        ...(supportsEyeDropper()
          ? [
              {
                kind: 'action' as const,
                label: 'Color Picker',
                icon: <EyedropperIcon />,
                onSelect: async () => {
                  const color = await pickColorViaScreen();
                  if (color) createSwatchItem(lastPointerCanvas(), color);
                },
              },
            ]
          : []),
        {
          kind: 'action' as const,
          label: 'Add Palette from .ase',
          icon: <PaletteIcon />,
          onSelect: () => opts.pickAse(),
        },
        ...pluginsFor('colors'),
      ],
    },
    {
      heading: ADD_CATEGORY_LABELS.links,
      entries: [
        {
          kind: 'action' as const,
          label: 'Add Link Button',
          icon: <LinkIcon />,
          onSelect: () => createLinkItem(viewCenterCanvas()),
        },
        {
          kind: 'action' as const,
          label: 'Add Board Link',
          icon: <BoardsIcon />,
          onSelect: () => useSessionStore.getState().setBoardLinkPicker({ at: viewCenterCanvas() }),
        },
        {
          kind: 'action' as const,
          label: 'Embed Webpage',
          icon: <GlobeIcon />,
          onSelect: () =>
            void promptText({ title: 'Embed webpage', label: 'URL', type: 'url' }).then((input) => {
              if (input === null) return;
              const url = input.trim();
              createIframeItem(
                viewCenterCanvas(),
                url ? (/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`) : '',
              );
            }),
        },
        ...pluginsFor('links'),
      ],
    },
    {
      heading: ADD_CATEGORY_LABELS.documents,
      entries: [
        {
          kind: 'action' as const,
          label: 'Add Markdown Text',
          icon: <TypeIcon />,
          onSelect: () => createTextItem(viewCenterCanvas()),
        },
        {
          kind: 'action' as const,
          label: 'Add Title',
          icon: <HeadingIcon />,
          onSelect: () => createTitleItem(viewCenterCanvas()),
        },
        {
          kind: 'action' as const,
          label: 'Import Text from File',
          icon: <FileTextIcon />,
          onSelect: () => opts.pickTextFile(),
        },
        ...pluginsFor('documents'),
      ],
    },
    { heading: ADD_CATEGORY_LABELS.structure, entries: pluginsFor('structure') },
    { heading: ADD_CATEGORY_LABELS.misc, entries: pluginsFor('misc') },
  ]
    .filter((section) => section.entries.length > 0)
    .sort((a, b) => (SECTION_RANK.get(a.heading) ?? 99) - (SECTION_RANK.get(b.heading) ?? 99));
}

/**
 * The Add sheet: the same sections as the mega-menu, as big icon tiles in
 * a wide grid, with a search field and category pills along the top (a
 * launcher's layout). The views whose bar has no room for a wide dropdown
 * (the gallery) open this.
 */
function AddTiles({ build, onPick }: { build: () => AddSection[]; onPick: () => void }) {
  const sections = build();
  type Action = Extract<MenuEntry, { kind: 'action' }>;
  const actions = (entries: MenuEntry[]): Action[] =>
    entries.filter((e): e is Action => e.kind === 'action');
  const groups: { heading: string; entries: Action[] }[] = [];
  for (const section of sections) {
    const subs = section.entries.filter((e) => e.kind === 'submenu');
    const all = [...actions(section.entries), ...subs.flatMap((e) => actions(e.children))];
    if (all.length) groups.push({ heading: section.heading, entries: all });
  }
  const [cat, setCat] = useState<string>('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = groups
    .filter((g) => cat === 'all' || g.heading === cat)
    .map((g) => ({
      ...g,
      entries: g.entries.filter((e) => !q || e.label.toLowerCase().includes(q)),
    }))
    .filter((g) => g.entries.length);
  const tile = (e: Action) => (
    <button
      key={e.label}
      type="button"
      className="add-tile"
      disabled={e.disabled}
      data-testid="add-tile"
      onClick={() => {
        onPick();
        e.onSelect();
      }}
    >
      <span className="add-tile-icon" aria-hidden>
        {e.icon}
      </span>
      <span className="add-tile-label">{e.label}</span>
    </button>
  );
  return (
    <div className="add-sheet-body">
      <div className="add-head">
        <input
          className="input add-search"
          placeholder="Search"
          aria-label="Search what to add"
          autoFocus
          value={query}
          data-testid="add-search"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg add-cats" role="radiogroup" aria-label="Category">
          {[{ heading: 'All' }, ...groups].map((g) => {
            const id = g.heading === 'All' ? 'all' : g.heading;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={cat === id}
                className={cat === id ? 'active' : ''}
                data-testid="add-cat"
                onClick={() => setCat(id)}
              >
                {g.heading}
              </button>
            );
          })}
        </div>
      </div>
      <div className="add-groups">
        {shown.length === 0 && <p className="add-empty">Nothing matches.</p>}
        {cat === 'all' && !q ? (
          shown.map((g) => (
            <section className="add-group" key={g.heading}>
              <h3>{g.heading}</h3>
              <div className="add-tiles">{g.entries.map(tile)}</div>
            </section>
          ))
        ) : (
          <div className="add-tiles">{shown.flatMap((g) => g.entries.map(tile))}</div>
        )}
      </div>
    </div>
  );
}

export function AddMenuButton({
  className,
  presentation = 'menu',
}: {
  className?: string;
  /** The mega-menu under the button (the menu bar), or a sheet of tiles. */
  presentation?: 'menu' | 'dialog';
}) {
  const pluginEntries = useEnabledPlugins().flatMap((p) => p.addMenu ?? []);
  const [sheetOpen, setSheetOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const aseInputRef = useRef<HTMLInputElement>(null);

  const buildAddSections = () =>
    buildAddSectionsFor({
      pluginEntries,
      pickImage: () => imageInputRef.current?.click(),
      pickTextFile: () => textFileInputRef.current?.click(),
      pickAse: () => aseInputRef.current?.click(),
    });

  // Part of the shared menubar open-state (hover-through between menus).
  const open = useSessionStore((s) => s.menubarOpen === 'Add');
  const setOpen = (next: boolean) => useSessionStore.getState().setMenubarOpen(next ? 'Add' : null);

  const renderInputs = () => (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        data-testid="image-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importFiles(files, viewCenterCanvas());
        }}
      />
      <input
        ref={textFileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,.docx,.html,.htm,.rtf,.doc"
        multiple
        hidden
        data-testid="text-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          // Picked as text on purpose: a .docx becomes a text box here.
          if (files.length) void importFiles(files, viewCenterCanvas(), { asText: true });
        }}
      />
      <input
        ref={aseInputRef}
        type="file"
        accept=".ase"
        hidden
        data-testid="ase-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFiles([file], viewCenterCanvas());
        }}
      />
    </>
  );

  if (presentation === 'dialog') {
    return (
      <>
        <button
          type="button"
          className={className ?? 'menubar-button'}
          data-testid="menu-add"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <PlusIcon />
          Add
        </button>
        {sheetOpen && (
          <UiDialog
            title="Add to board"
            size="full"
            className="add-sheet"
            testId="add-dialog"
            onClose={() => setSheetOpen(false)}
          >
            <AddTiles build={buildAddSections} onPick={() => setSheetOpen(false)} />
          </UiDialog>
        )}
        {renderInputs()}
      </>
    );
  }

  return (
    <>
      <DM.Root
        open={open}
        modal={false}
        onOpenChange={(next) => {
          // Opening the Add menu leaves the canvas — drop the selection, but
          // keep the chrome snapshot so selection-aware entries (Insert Chart
          // editing the selected chart) still know what was selected.
          if (next) {
            const session = useSessionStore.getState();
            session.chromeClearSelection();
            session.setSelectedConnection(null);
          }
          setOpen(next);
        }}
      >
        <DM.Trigger asChild>
          <button
            type="button"
            className={className ?? 'menubar-button'}
            data-testid="menu-add"
            onPointerEnter={() => {
              const cur = useSessionStore.getState().menubarOpen;
              if (cur !== null && cur !== 'Add') {
                useSessionStore.getState().chromeClearSelection();
                useSessionStore.getState().setMenubarOpen('Add');
              }
            }}
          >
            <PlusIcon />
            Add
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content
            className="menu-panel menu-mega menubar-dropdown"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="menu-mega-head">
              <span>Add to board</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="addmenu-close"
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <MegaColumns build={buildAddSections} />
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      {renderInputs()}
    </>
  );
}
