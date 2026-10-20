import { useCallback, useEffect } from 'react';
import { CanvasViewport } from './components/canvas/CanvasViewport';
import {
  StatusPill,
  ToolCluster,
  TopRightCluster,
  ZoomPill,
} from './components/chrome/ChromeClusters';
import { ContextMenu } from './components/chrome/ContextMenu';
import { CornerControls } from './components/canvas/CornerControls';
import { TeamCluster } from './components/chrome/TeamCluster';
import { GuestGate } from './components/account/GuestGate';
import { ClipsAutoImport, ClipsInboxButton } from './components/chrome/ClipsInbox';
import { GalleryScreen } from './components/library/GalleryScreen';
import { PluginViewOutlet } from './plugins/registry';
import { LayersPanel } from './components/panels/LayersPanel';
import { UpdatePill } from './components/chrome/UpdatePill';
import { PresentationHud } from './components/canvas/PresentationHud';
import { PresentationPanel } from './components/panels/PresentationPanel';
import { PagesPanel } from './components/panels/PagesPanel';
import { Lightbox } from './components/lightbox/Lightbox';
import { LibraryScreen } from './components/library/LibraryScreen';
import { MenuBar } from './components/chrome/MenuBar';
import { Minimap } from './components/canvas/Minimap';
import {
  MobileEditFab,
  MobileHistoryCluster,
  MobileSelectionBar,
} from './components/canvas/MobileEditControls';
import { CommunityPublishDialog } from './components/community/CommunityDialogs';
import { CommunityScreen } from './components/community/CommunityScreen';
import { NotFoundScreen } from './components/library/NotFoundScreen';
import { CommandPalette } from './components/chrome/CommandPalette';
import { BoardSearchDialog } from './components/dialogs/BoardSearchDialog';
import { AppNotices } from './components/chrome/AppNotices';
import { GraphViewOverlay } from './components/canvas/GraphViewOverlay';
import { ConnectionEditor } from './components/canvas/ConnectionEditor';
import { InsightsDialog } from './components/dialogs/InsightsDialog';
import { MoreLikeThisDialog } from './components/dialogs/MoreLikeThisDialog';
import { SuggestConnectionsDialog } from './components/dialogs/SuggestConnectionsDialog';
import { PosterPicker } from './components/panels/PosterPicker';
import { SelectionActionBar } from './components/canvas/SelectionActionBar';
import { ImageAdjustmentsPanel } from './components/panels/ImageAdjustmentsPanel';
import { LinkStylePanel } from './components/panels/LinkStylePanel';
import { QrStylePanel } from './components/panels/QrStylePanel';
import { ShapeStylePanel } from './components/panels/ShapeStylePanel';
import { TitleStylePanel } from './components/panels/TitleStylePanel';
import { SyncDialog } from './components/account/SyncDialog';
import { probeInstalledApp } from './lib/deviceLog';
import { TextStylePanel } from './components/panels/TextStylePanel';
import { ViewerExportDialog } from './components/dialogs/ViewerExportDialog';
import { AssetPdfDialog } from './components/dialogs/AssetPdfDialog';
import { NoteDialog } from './components/dialogs/NoteDialog';
import { TagDialog } from './components/dialogs/TagDialog';
import { SendToBoardDialog } from './components/dialogs/SendToBoardDialog';
import { CanvasBgDialog } from './components/dialogs/CanvasBgDialog';
import { ImportUrlDialog } from './components/dialogs/ImportUrlDialog';
import { ExportBoardDialog } from './components/dialogs/ExportBoardDialog';
import { FeedbackDialog } from './components/dialogs/FeedbackDialog';
import { installAssetRecovery } from './lib/sync/assetRecovery';
import { ShareDialog } from './components/dialogs/ShareDialog';
import { CaptureDialog } from './components/dialogs/CaptureDialog';
import { PluginCornerButtons, PluginOutlet } from './plugins/registry';
import './plugins';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { UiPromptHost } from './components/ui/Prompt';
import { ShortcutMap } from './components/chrome/ShortcutMap';
import { ExportOverlay } from './components/chrome/ExportOverlay';
import { isEditableTarget, useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useTheme } from './hooks/useTheme';
import { clientToCanvas } from './lib/canvas/canvasDom';
import { hasClipboardItems, pasteItems } from './lib/import/clipboard';
import { createTextFromString } from './lib/import/createItems';
import { smartCreateFromText } from './lib/import/smartPaste';
import { middlePasteSuppressed } from './lib/canvas/middleClickGuard';
import { pasteFromSystem, startClipboardWatch } from './lib/import/pasteAction';
import { createAudioEmbed } from './lib/import/importAudio';
import { createVideoEmbed } from './lib/import/importVideos';
import { parseAudioUrl } from './lib/media/audioEmbed';
import { hasMediaFiles, importMediaFiles } from './lib/import/importMedia';
import { parseVideoUrl } from './lib/media/videoEmbed';
import { pruneSharedAudio } from './lib/media/audioRegistry';
import { syncBoardFonts } from './lib/media/fontRegistry';
import { pruneEmbedPlayers } from './lib/media/embedPlayers';
import { EmbedPlayerLayer } from './components/canvas/EmbedPlayerLayer';
import { reconcile, startSyncPoll } from './lib/sync/boardSync';
import { startUserNoticePoll } from './lib/sync/userNotices';
import { initPersistence } from './lib/persistence';
import { initBoardIndex } from './lib/search/boardIndex';
import { initRouter } from './lib/router';
import { initSettingsSync } from './lib/sync/settingsSync';
import { exposeDevTools } from './lib/devTools';
import { useDocumentStore } from './state/documentStore';
import { useHistoryStore } from './state/history';
import { useSessionStore } from './state/sessionStore';
import { useSyncStore } from './state/syncStore';
import { LockScreen } from './components/chrome/LockScreen';
import { setUnverifiedObserver } from './lib/sync/apiBase';
import { showNotice } from './lib/notices';

// An unverified account hits a wall on every account feature: send it to
// the sync dialog, where the code goes in, and say why (once per minute).
let unverifiedToldAt = 0;
setUnverifiedObserver(() => {
  useSessionStore.getState().setSyncDialogOpen(true);
  if (Date.now() - unverifiedToldAt < 60_000) return;
  unverifiedToldAt = Date.now();
  showNotice('Verify your email to use sync, teams and the community.', {
    id: 'unverified',
    kind: 'info',
  });
});

/**
 * Files on the clipboard. `clipboardData.files` covers most browsers; the
 * DataTransferItem scan is a fallback for those that only expose pasted
 * images (e.g. a screenshot) as 'file'-kind items.
 */
/** Clipboard bitmaps arrive browser-named ("image.png") — give each a
 *  unique name instead; real files (copied from a file manager) keep theirs. */
function uniquelyNamed(file: File): File {
  if (!/^image\.\w+$/i.test(file.name)) return file;
  const ext = file.name.split('.').pop() ?? 'png';
  return new File([file], `${crypto.randomUUID().slice(0, 8)}.${ext}`, { type: file.type });
}

function clipboardFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const direct = Array.from(dt.files);
  if (direct.length > 0) return direct.map(uniquelyNamed);
  const fromItems: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) fromItems.push(uniquelyNamed(file));
    }
  }
  return fromItems;
}

export function App() {
  // Missing-asset recovery for synced boards (on-demand pulls + reconcile on
  // open) — installed after every module has initialised.
  useEffect(() => {
    probeInstalledApp();
  }, []);

  useEffect(() => {
    installAssetRecovery();
  }, []);

  useTheme();
  useGlobalShortcuts(
    useCallback(() => document.querySelector<HTMLElement>('.canvas-viewport'), []),
  );

  // Restore the last board, then autosave every document change.
  useEffect(() => {
    void initPersistence();
    initBoardIndex();
    initRouter();
    // Detect an existing sync session (no-op/offline → signed out), then
    // reconcile boards whenever we become signed in.
    void useSyncStore.getState().refresh();
    const unsub = useSyncStore.subscribe((s, prev) => {
      if (s.status === 'signedIn' && prev.status !== 'signedIn') void reconcile();
    });
    startSyncPoll();
    startUserNoticePoll();
    const stopSettingsSync = initSettingsSync();
    const stopClipboardWatch = startClipboardWatch();
    if (import.meta.env.DEV) exposeDevTools();
    return () => {
      unsub();
      stopSettingsSync();
      stopClipboardWatch();
    };
  }, []);

  // OS paste: media files become items, a video URL becomes an embed,
  // otherwise paste the internal clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // The middle mouse button is pan-only — never paste its OS primary
      // selection onto the canvas.
      if (middlePasteSuppressed()) {
        e.preventDefault();
        return;
      }
      const center = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      const files = clipboardFiles(e.clipboardData);
      if (hasMediaFiles(files)) {
        e.preventDefault();
        void importMediaFiles(files, center);
        return;
      }
      const text = e.clipboardData?.getData('text/plain')?.trim();
      const embed = text ? parseVideoUrl(text) : null;
      const audioEmbed = text ? parseAudioUrl(text) : null;
      if (embed) {
        e.preventDefault();
        createVideoEmbed(embed, center);
      } else if (audioEmbed) {
        e.preventDefault();
        createAudioEmbed(audioEmbed, center);
      } else if (hasClipboardItems()) {
        e.preventDefault();
        pasteItems(center);
      } else if (text) {
        // Plain text from any app → its natural item: a bare URL becomes a
        // link button (feeds an RSS box), a color literal a swatch,
        // anything else a text item.
        e.preventDefault();
        if (!smartCreateFromText(text, center)) createTextFromString(center, text);
      } else {
        // Some sources (e.g. a copied image) only expose data via the async
        // Clipboard API, not the synchronous paste event — read it directly.
        e.preventDefault();
        void pasteFromSystem(center);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Fonts for the initially-loaded board (the subscription below only fires
  // on changes).
  useEffect(() => {
    syncBoardFonts(useDocumentStore.getState().doc);
  }, []);

  // Shared audio follows the document: deleting an item stops its clip, and
  // switching boards silences everything.
  useEffect(
    () =>
      useDocumentStore.subscribe(
        (s) => s.doc,
        (doc, prev) => {
          if (doc.id !== prev.id) {
            pruneSharedAudio(null);
            pruneEmbedPlayers(null);
            syncBoardFonts(doc); // custom text fonts load with the board
          } else {
            const live = new Set(Object.keys(doc.items));
            pruneSharedAudio(live);
            pruneEmbedPlayers(live);
          }
        },
      ),
    [],
  );

  // Selection may only reference live items (undo/redo/delete can orphan ids).
  useEffect(
    () =>
      useDocumentStore.subscribe(
        (s) => s.doc.items,
        (items) => {
          const { selection, setSelection } = useSessionStore.getState();
          const pruned = selection.filter((id) => id in items);
          if (pruned.length !== selection.length) setSelection(pruned);
        },
      ),
    [],
  );

  // Close confirmation while an edit hasn't hit IndexedDB yet (rule 3.5:
  // dirty derives from history position vs saved position).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const { index, savedIndex } = useHistoryStore.getState();
      if (index !== savedIndex) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const view = useSessionStore((s) => s.view);
  const presenting = useSessionStore((s) => s.presenting);
  const chromeHidden = useSessionStore((s) => s.chromeHidden) || presenting;

  return (
    <div className="app-shell">
      <CommunityPublishDialog />
      <CommandPalette />
      <BoardSearchDialog />
      <GraphViewOverlay />
      <ConnectionEditor />
      <SuggestConnectionsDialog />
      <MoreLikeThisDialog />
      <InsightsDialog />
      <AppNotices />
      <LockScreen />
      {view === 'notfound' ? (
        <NotFoundScreen />
      ) : view === 'community' ? (
        <CommunityScreen />
      ) : view === 'library' ? (
        <LibraryScreen />
      ) : view === 'gallery' ? (
        <>
          <GalleryScreen />
          <Lightbox />
          <ClipsAutoImport />
        </>
      ) : view === 'plugin' ? (
        <>
          <PluginViewOutlet />
          <Lightbox />
        </>
      ) : (
        <>
          <div
            className={presenting ? 'present-active' : undefined}
            style={{ display: 'contents' }}
          >
            <CanvasViewport />
          </div>
          <PresentationHud />
          {/* Auto-hide (Appearance): a blank-canvas click fades this chrome
              out; another blank click or selecting an item brings it back. */}
          <div className={`canvas-chrome${chromeHidden ? ' chrome-hidden' : ''}`}>
            <MenuBar />
            <ToolCluster />
            <TopRightCluster />
            <TeamCluster />
            <div className="bottom-chrome">
              <StatusPill />
              <ZoomPill />
            </div>
            <UpdatePill />
            <Minimap />
            <MobileEditFab />
            <LayersPanel />
            <PresentationPanel />
            <PagesPanel />
            <CornerControls>
              <ClipsInboxButton />
              <ClipsAutoImport />
              <PluginCornerButtons />
            </CornerControls>
          </div>
          <SelectionActionBar />
          <MobileHistoryCluster />
          <MobileSelectionBar />
          <TextStylePanel />
          <LinkStylePanel />
          <QrStylePanel />
          <ShapeStylePanel />
          <TitleStylePanel />
          <ImageAdjustmentsPanel />
          <ContextMenu />
          <Lightbox />
          <PosterPicker />
        </>
      )}
      <GuestGate />
      {/* Always available — sign-in must work from the library landing too. */}
      <SyncDialog />
      <CaptureDialog />
      <SettingsDialog />
      <UiPromptHost />
      <ShortcutMap />
      <PluginOutlet />
      <ViewerExportDialog />
      <AssetPdfDialog />
      <TagDialog />
      <SendToBoardDialog />
      <NoteDialog />
      <CanvasBgDialog />
      <ImportUrlDialog />
      <ExportBoardDialog />
      <ShareDialog />
      <FeedbackDialog />
      <EmbedPlayerLayer />
      <ExportOverlay />
    </div>
  );
}
