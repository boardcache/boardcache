import { useRef } from 'react';
import { tally } from '../../lib/usageTally';
import type { ReactNode } from 'react';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { useExportBoardDialog } from '../dialogs/ExportBoardDialog';
import { useFeedbackDialog } from '../dialogs/FeedbackDialog';
import { useShareDialog } from '../dialogs/ShareDialog';
import { useCommunityPublish, useCommunityReady } from '../community/CommunityDialogs';
import type { MenuEntry } from '../../lib/menuBuilders';
import { canPasteNow, pasteFromAnywhere } from '../../lib/import/pasteAction';
import { closeBoard, createBoard } from '../../lib/board/boardLibrary';
import {
  exportBoardAsPlainZip,
  exportFullAsPng,
  exportViewAsPng,
  importBoardFromFile,
} from '../../lib/board/transfer';
import { withExportStatus } from '../../lib/export/exportStatus';
import { organizeItems } from '../../lib/canvas/arrange';
import {
  resetView,
  zoomInAt,
  zoomOutAt,
  zoomTo100,
  zoomToFit,
} from '../../lib/canvas/viewportActions';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { exportBibliography, hasResearchContent } from '../../lib/export/bibliography';
import { useDocumentStore } from '../../state/documentStore';
import { useLockScreenStore } from '../../lib/lockScreen';
import { useSessionStore } from '../../state/sessionStore';
import { enabledPluginViews, openPluginView } from '../../plugins/registry';
import { startPresentation } from '../../lib/canvas/presentation';
import { promptText } from '../ui/Prompt';
import * as DM from '@radix-ui/react-dropdown-menu';
import { RadixEntries } from '../menu/RadixEntries';
import { AddMenuButton } from './AddMenu';
import { UiTooltip } from '../ui/Tooltip';
import {
  BookIcon,
  CameraIcon,
  ChatIcon,
  CommandIcon,
  DownloadIcon,
  DuplicateIcon,
  ExitIcon,
  ExpandIcon,
  ExportIcon,
  EyeIcon,
  FileIcon,
  FilePlusIcon,
  FileTextIcon,
  FitIcon,
  GalleryIcon,
  GearIcon,
  GlobeIcon,
  GraphIcon,
  GridIcon,
  ImageIcon,
  KeyboardIcon,
  LinkIcon,
  LockIcon,
  PackageIcon,
  PasteIcon,
  PercentIcon,
  PresentationIcon,
  ResetViewIcon,
  SaveIcon,
  ScaleIcon,
  ScreenShareIcon,
  SearchIcon,
  SparkleIcon,
  ZoomInIcon,
  ZoomOutIcon,
  SparklesIcon,
} from '../icons';

/** Drop/paste target center: the canvas point currently mid-screen. */
function viewCenterCanvas() {
  return clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
}

/** Builds the entry list when the menu CONTENT mounts (i.e. on open), so
 *  dynamic entries — like Paste's clipboard check — are always fresh. */
function LazyEntries({ build }: { build: () => MenuEntry[] }) {
  return <RadixEntries entries={build()} />;
}

function MenuBarButton({
  label,
  icon,
  build,
}: {
  label: string;
  icon: ReactNode;
  build: () => MenuEntry[];
}) {
  // Shared open state across the menubar: once ONE menu is open, hovering a
  // sibling trigger opens it without a click (macOS menu behavior). Requires
  // modal={false} so the open menu's dismiss layer doesn't eat the hover.
  const open = useSessionStore((s) => s.menubarOpen === label);
  return (
    <DM.Root
      open={open}
      modal={false}
      onOpenChange={(next) => {
        // Reaching for a menu leaves the canvas: drop the selection so the
        // action clearly targets the board, not a leftover item.
        const session = useSessionStore.getState();
        if (next) {
          session.clearSelection();
          session.setSelectedConnection(null);
        }
        session.setMenubarOpen(next ? label : null);
      }}
    >
      <DM.Trigger asChild>
        <button
          type="button"
          className="menubar-button"
          data-testid={`menu-${label.toLowerCase()}`}
          onPointerEnter={() => {
            const cur = useSessionStore.getState().menubarOpen;
            if (cur !== null && cur !== label) {
              useSessionStore.getState().clearSelection();
              useSessionStore.getState().setMenubarOpen(label);
            }
          }}
        >
          {icon}
          {label}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu-panel menu-list menubar-dropdown"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <LazyEntries build={build} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/**
 * Top-left menu bar (Settings / File / View / + Add), attached to the screen
 * corner per the original design. Menus are MenuEntry trees rendered by the
 * shared RadixEntries renderer.
 */
export function MenuBar() {
  const communityReady = useCommunityReady();
  const rootRef = useRef<HTMLDivElement>(null);
  const boardInputRef = useRef<HTMLInputElement>(null);

  // Subscribed so checkmarks re-render when the underlying state changes.

  const buildFile = (): MenuEntry[] => [
    // Only present when the clipboard (internal or OS) holds something.
    ...(canPasteNow()
      ? ([
          {
            kind: 'action',
            label: 'Paste',
            icon: <PasteIcon />,
            shortcut: 'Ctrl+V',
            onSelect: () => void pasteFromAnywhere(viewCenterCanvas()),
          },
          { kind: 'separator' },
        ] satisfies MenuEntry[])
      : []),
    {
      kind: 'action',
      label: 'New board',
      icon: <FilePlusIcon />,
      onSelect: () => void createBoard(),
    },
    {
      kind: 'action',
      label: 'Save as Template',
      icon: <DuplicateIcon />,
      onSelect: () => {
        void (async () => {
          const doc = useDocumentStore.getState().doc;
          const name = await promptText({
            title: 'Save as template',
            label: 'Name',
            initial: doc.name,
            confirmLabel: 'Save',
            hint: 'Templates live in the New-board-from-template picker; new boards start as copies of this one. Opt it into ☁ Sync there to use it on other devices.',
          });
          if (name === null) return;
          const { saveOpenBoardAsTemplate } = await import('../../lib/board/boardLibrary');
          await saveOpenBoardAsTemplate(name.trim() || `${doc.name} template`);
          const { showNotice } = await import('../../lib/notices');
          showNotice(`Saved as template — find it under New board → templates.`, {
            id: 'template-saved',
          });
        })();
      },
    },
    {
      kind: 'action',
      label: 'Command Palette',
      icon: <CommandIcon />,
      shortcut: 'Ctrl+P',
      onSelect: () => useSessionStore.getState().setPaletteOpen(true),
    },
    {
      kind: 'action',
      label: 'Find on Board',
      icon: <SearchIcon />,
      shortcut: 'Ctrl+Shift+F',
      onSelect: () => useSessionStore.getState().setBoardSearchOpen(true),
    },
    {
      kind: 'action',
      label: 'Import board',
      icon: <DownloadIcon />,
      onSelect: () => boardInputRef.current?.click(),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Share Board',
      icon: <ScreenShareIcon />,
      onSelect: () => useShareDialog.getState().toggle(true),
    },
    {
      kind: 'action',
      label: 'Send Feedback',
      icon: <ChatIcon />,
      onSelect: () => useFeedbackDialog.getState().toggle(true),
    },
    ...(communityReady
      ? [
          {
            kind: 'action' as const,
            label: 'Publish to Community',
            icon: <GlobeIcon />,
            onSelect: () => {
              tally('community.publish');
              return useCommunityPublish.getState().toggle(true);
            },
          },
        ]
      : []),
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: 'Export',
      icon: <ExportIcon />,
      children: [
        {
          kind: 'action',
          label: 'boardCache Backup',
          icon: <SaveIcon />,
          onSelect: () => {
            tally('export.backup');
            return useExportBoardDialog.getState().toggle(true);
          },
        },
        {
          kind: 'action',
          label: 'Plain Files (zip)',
          icon: <PackageIcon />,
          onSelect: () => {
            tally('export.plainzip');
            return void withExportStatus('Zipping files', exportBoardAsPlainZip);
          },
        },
        {
          kind: 'action',
          label: 'Current View Image',
          icon: <CameraIcon />,
          onSelect: () => void withExportStatus('Generating image', exportViewAsPng),
        },
        ...(useDocumentStore.getState().doc.pages.length > 1
          ? ([
              {
                kind: 'action',
                label: 'Full Image — This Page',
                icon: <ImageIcon />,
                onSelect: () => {
                  tally('export.image.page');
                  void withExportStatus('Generating image', () => exportFullAsPng('page'));
                },
              },
              {
                kind: 'action',
                label: 'Full Image — All Pages (zip)',
                icon: <ImageIcon />,
                onSelect: () => {
                  tally('export.image.pages');
                  void withExportStatus('Generating images', () => exportFullAsPng('all'));
                },
              },
            ] as const)
          : ([
              {
                kind: 'action',
                label: 'Full boardCache Image',
                icon: <ImageIcon />,
                onSelect: () => {
                  tally('export.image.full');
                  void withExportStatus('Generating image', () => exportFullAsPng('page'));
                },
              },
            ] as const)),
        {
          kind: 'action',
          label: 'Asset PDF',
          icon: <FileTextIcon />,
          onSelect: () => {
            tally('export.assetpdf');
            return useSessionStore.getState().setAssetPdfOpen(true);
          },
        },
        // The narrative write-up only means something on a research board
        // (sources, evidence statuses, connections); elsewhere it is hidden.
        ...(hasResearchContent(useDocumentStore.getState().doc)
          ? ([
              {
                kind: 'action',
                label: 'Dossier PDF',
                icon: <BookIcon />,
                onSelect: () => {
                  tally('export.dossier');
                  void withExportStatus('Writing dossier', async () => {
                    const { exportDossier } = await import('../../lib/export/exportDossier');
                    await exportDossier();
                  });
                },
              },
            ] as const)
          : []),
        {
          kind: 'action',
          label: 'Bibliography',
          icon: <BookIcon />,
          onSelect: () => {
            tally('export.bibliography');
            return exportBibliography();
          },
        },
        {
          kind: 'action',
          label: 'Interactive Offline boardCache (zip)',
          icon: <PackageIcon />,
          onSelect: () => {
            tally('export.viewer');
            return useSessionStore.getState().setViewerExportOpen(true);
          },
        },
      ],
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Exit Board',
      icon: <ExitIcon />,
      onSelect: () => void closeBoard(),
    },
  ];

  const buildView = (): MenuEntry[] => [
    {
      kind: 'action',
      label: 'Gallery',
      icon: <GalleryIcon />,
      onSelect: () => useSessionStore.getState().setView('gallery'),
    },
    {
      kind: 'action',
      label: 'Graph View',
      icon: <GraphIcon />,
      onSelect: () => useSessionStore.getState().setGraphOpen(true),
    },
    // Plugin full-screen views (Projects, …) sit with the other views.
    ...enabledPluginViews().map(
      (v): MenuEntry => ({
        kind: 'action',
        label: v.label,
        ...(v.icon ? { icon: v.icon } : {}),
        onSelect: () => openPluginView(v.id),
      }),
    ),
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Present',
      icon: <PresentationIcon />,
      // Nothing ordered yet → show the panel, which explains how to add steps.
      onSelect: () => {
        if (!startPresentation(0)) useSessionStore.getState().setPresentPanelOpen(true);
      },
    },
    {
      kind: 'action',
      label: 'Presentation order',
      icon: <PresentationIcon />,
      onSelect: () =>
        useSessionStore
          .getState()
          .setPresentPanelOpen(!useSessionStore.getState().presentPanelOpen),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Zoom in',
      icon: <ZoomInIcon />,
      shortcut: 'Ctrl +',
      onSelect: () => zoomInAt(getCanvasContainer()),
    },
    {
      kind: 'action',
      label: 'Zoom out',
      icon: <ZoomOutIcon />,
      shortcut: 'Ctrl −',
      onSelect: () => zoomOutAt(getCanvasContainer()),
    },
    {
      kind: 'action',
      label: 'Zoom to 100%',
      icon: <PercentIcon />,
      shortcut: 'Ctrl 0',
      onSelect: () => zoomTo100(getCanvasContainer()),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Fit content',
      icon: <FitIcon />,
      onSelect: () => zoomToFit(getCanvasContainer()),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Organize Items',
      icon: <GridIcon />,
      onSelect: () => organizeItems(),
    },
    {
      kind: 'action',
      label: 'Organize by Topic',
      icon: <SparkleIcon />,
      onSelect: () => {
        void import('../../lib/search/topicLayout').then(({ organizeByTopic }) =>
          organizeByTopic(),
        );
      },
    },
    {
      kind: 'action',
      label: 'Show Connections',
      icon: <LinkIcon />,
      checked: useSessionStore.getState().connectionsVisible,
      onSelect: () => {
        const s = useSessionStore.getState();
        s.setConnectionsVisible(!s.connectionsVisible);
      },
    },
    {
      kind: 'action',
      label: 'Suggest Connections',
      icon: <SparkleIcon />,
      onSelect: () => useSessionStore.getState().setSuggestConnectionsOpen(true),
    },
    {
      kind: 'action',
      label: 'Board Insights',
      icon: <SparkleIcon />,
      onSelect: () => useSessionStore.getState().setInsightsOpen(true),
    },
    {
      kind: 'action',
      label: 'Show Comments',
      icon: <ChatIcon />,
      checked: useSessionStore.getState().commentsVisible,
      onSelect: () => {
        const s = useSessionStore.getState();
        s.setCommentsVisible(!s.commentsVisible);
      },
    },
    {
      kind: 'action',
      label: 'Show Evidence Strength',
      icon: <ScaleIcon />,
      checked: useSessionStore.getState().weightsVisible,
      onSelect: () => {
        const s = useSessionStore.getState();
        s.setWeightsVisible(!s.weightsVisible);
      },
    },
    {
      kind: 'action',
      label: 'Reset view',
      icon: <ResetViewIcon />,
      shortcut: 'Ctrl Shift 0',
      onSelect: resetView,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Keyboard Shortcuts',
      icon: <KeyboardIcon />,
      shortcut: '?',
      onSelect: () => useSessionStore.getState().setShortcutsOpen(true),
    },
    {
      kind: 'action',
      label: 'Lock screen',
      icon: <LockIcon />,
      onSelect: () => void useLockScreenStore.getState().requestLock(),
    },
    {
      kind: 'action',
      label: document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen',
      icon: <ExpandIcon />,
      onSelect: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Welcome board',
      icon: <SparklesIcon />,
      onSelect: () => void import('../../lib/board/welcomeBoard').then((m) => m.openWelcomeBoard()),
    },
    {
      kind: 'action',
      label: 'Library tour',
      icon: <SparklesIcon />,
      onSelect: () => {
        useSessionStore.getState().setView('library');
        void import('../library/LibraryTour').then((m) => setTimeout(m.startLibraryTour, 300));
      },
    },
  ];

  return (
    <div className="menubar" ref={rootRef} role="menubar" aria-label="Main menu">
      <UiTooltip label="Settings">
        <button
          type="button"
          className="menubar-button"
          data-testid="menu-settings"
          aria-label="Settings"
          onClick={() => useSessionStore.getState().setSettingsOpen(true)}
        >
          <GearIcon />
        </button>
      </UiTooltip>
      <MenuBarButton label="File" icon={<FileIcon />} build={buildFile} />
      <MenuBarButton label="View" icon={<EyeIcon />} build={buildView} />
      <AddMenuButton />
      <UiTooltip label="Open the gallery index">
        <button
          type="button"
          className="menubar-button menubar-gallery"
          data-testid="menu-gallery"
          aria-label="Gallery"
          onClick={() => useSessionStore.getState().setView('gallery')}
        >
          <GridIcon />
        </button>
      </UiTooltip>
      <UiTooltip label="Fit content">
        <button
          type="button"
          className="menubar-button menubar-fit"
          data-testid="menu-fit"
          aria-label="Fit content"
          onClick={() => zoomToFit(getCanvasContainer())}
        >
          <FitIcon />
        </button>
      </UiTooltip>

      <input
        ref={boardInputRef}
        type="file"
        accept=".boardcache,.refboard,.zip,.json,.enc"
        hidden
        data-testid="board-file-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await importBoardFromFile(file);
        }}
      />
    </div>
  );
}
