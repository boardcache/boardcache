import type { Item } from '@boardcache/schema';
import type { ReactNode } from 'react';
import {
  AlignBottomIcon,
  AlignCenterXIcon,
  AlignLeftIcon,
  AlignMiddleYIcon,
  AlignRightIcon,
  AlignTopIcon,
  BoardsIcon,
  BringFrontIcon,
  BringFwdIcon,
  CameraIcon,
  ChatIcon,
  CloseIcon,
  CopyIcon,
  CropIcon,
  DistributeHIcon,
  DistributeVIcon,
  DownloadIcon,
  DropletIcon,
  DuplicateIcon,
  EvidenceIcon,
  ExpandIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  EyedropperIcon,
  FileTextIcon,
  FilmIcon,
  FlipHIcon,
  FlipVIcon,
  GridIcon,
  GroupIcon,
  ImageIcon,
  LayersIcon,
  LightboxIcon,
  LinkIcon,
  LockIcon,
  LoopIcon,
  MatchHeightIcon,
  MatchWidthIcon,
  MilestoneIcon,
  PagesIcon,
  PaletteIcon,
  PasteIcon,
  PenToolIcon,
  PencilIcon,
  PlayIcon,
  PlaylistIcon,
  PresentationIcon,
  QrIcon,
  RenameIcon,
  ResetViewIcon,
  ScissorsIcon,
  SelectAllIcon,
  SendBackIcon,
  SendBackwardIcon,
  SparkleIcon,
  StepBackIcon,
  StepFwdIcon,
  StickyNoteIcon,
  TagIcon,
  TrashIcon,
  TypeIcon,
  UngroupIcon,
  UnlockIcon,
  VolumeIcon,
} from '../components/icons';
import { HARMONY_KINDS, harmony } from './color/color';
import {
  attachedPointOf,
  createTimelineFromSelection,
  detachItems,
} from './structure/timelineAttach';
import { isPanoImage, panoCandidate } from './media/pano';
import type { Point } from './canvas/coords';
import { copySelection, cutSelection } from './import/clipboard';
import { canPasteNow, pasteFromAnywhere } from './import/pasteAction';
import { pluginItemMenuEntries } from '../plugins/registry';
import { activePageId as pagesActiveId } from './board/pages';
import { runBoardTool } from './tools/registry';
import { createPaletteItem, createSwatchItem, createTextItem } from './import/createItems';
import { groupSelection, ungroupSelection } from './canvas/groupActions';
import { selectionGroupState } from './canvas/grouping';
import {
  exportGroupAsArchive,
  exportGroupAsPlainZip,
  exportGroupAsPng,
  exportItemsAsPlainZip,
  exportItemsAsPng,
} from './board/transfer';
import { flipImageH, flipImageV, rasterizeRotation, restoreImageCrop } from './media/imageActions';
import { itemDownloads } from './export/downloadItem';
import { copyPaletteColors } from './color/paletteActions';
import { extractPaletteFromAsset } from './color/paletteExtract';
import { ocrAvailable, runDescribe, runOcr, textBoxFromOcr } from './media/ocr';
import { transcribeAvailable, transcribeItem } from './media/transcribe';
import { pickColorViaInput, pickColorViaScreen, supportsEyeDropper } from './color/pickColor';
import {
  captureFrameToImage,
  fullscreenVideo,
  stepFrame,
  toggleLoop,
  toggleMute,
  togglePlay,
} from './media/videoActions';
import { getVideo } from './media/videoRegistry';
import { resetView } from './canvas/viewportActions';
import { alignItems, distributeItems, matchItemSize, organizeSelection } from './canvas/arrange';
import { canAttachUrl, openUrl } from './text/itemUrl';
import {
  updateBoardSettings,
  combineIntoPlaylist,
  duplicateItems,
  removeItems,
  reorderItems,
  setItemsHidden,
  setItemsLocked,
  updateItems,
} from '../state/commands';
import { EVIDENCE_STATUSES } from './text/evidenceStatus';
import { WEIGHT_LEVELS } from './text/evidenceWeight';
import { editItem } from './itemEditors';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';
import { canvasReadOnly } from './canvas/readOnly';
import { addToPresentation, isPresented, removeFromPresentation } from './canvas/presentation';

/**
 * One declarative menu system (brief, Sprint 3): menus are plain data built
 * fresh on open; the ContextMenu component just renders MenuEntry trees.
 */
export type MenuEntry =
  | {
      kind: 'action';
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Shows a leading checkmark (toggles / current choice). */
      checked?: boolean;
      /** The menu stays open after this entry (tick several in one go). */
      keepOpen?: boolean;
      /** Leading icon (takes the place of the check column). */
      icon?: ReactNode;
      onSelect: () => void;
    }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }
  | { kind: 'submenu'; label: string; icon?: ReactNode; children: MenuEntry[] };

const action = (
  label: string,
  onSelect: () => void,
  extra: Partial<Extract<MenuEntry, { kind: 'action' }>> = {},
): MenuEntry => ({ kind: 'action', label, onSelect, ...extra });

const separator: MenuEntry = { kind: 'separator' };

export function buildCanvasMenu(canvasPoint: Point): MenuEntry[] {
  const session = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();
  // A read-only canvas (the viewer, or the pan tool locking the board):
  // nothing that adds to or changes the board.
  if (canvasReadOnly()) {
    return [
      action('Select all', () => session.setSelection(Object.keys(doc.items)), {
        shortcut: 'Ctrl+A',
        disabled: Object.keys(doc.items).length === 0,
        icon: <SelectAllIcon />,
      }),
      action('Reset view', resetView, { shortcut: 'Ctrl+Shift+0', icon: <ResetViewIcon /> }),
    ];
  }
  // A right-click near (but not exactly on) selected items still lands here —
  // keep the selection verbs reachable instead of only offering Add/Paste.
  const sel = session.selection.filter((id) => doc.items[id] !== undefined);
  const selectionEntries: MenuEntry[] =
    sel.length > 0
      ? [
          action('Copy', copySelection, { shortcut: 'Ctrl+C', icon: <CopyIcon /> }),
          action('Cut', cutSelection, { shortcut: 'Ctrl+X', icon: <ScissorsIcon /> }),
          action(
            'Duplicate',
            () => {
              const ids = duplicateItems(sel);
              if (ids.length) session.setSelection(ids);
            },
            { shortcut: 'Ctrl+D', icon: <DuplicateIcon /> },
          ),
          action(
            'Delete',
            () => {
              removeItems(sel);
              session.clearSelection();
            },
            { shortcut: 'Del', danger: true, icon: <TrashIcon /> },
          ),
          separator,
        ]
      : [];
  return [
    ...selectionEntries,
    action('Add text', () => createTextItem(canvasPoint), {
      shortcut: 'dbl-click',
      icon: <TypeIcon />,
    }),
    action(
      'Add swatch',
      async () => {
        const color = await pickColorViaInput();
        if (color) createSwatchItem(canvasPoint, color);
      },
      { icon: <DropletIcon /> },
    ),
    ...(supportsEyeDropper()
      ? [
          action(
            'Pick color from screen',
            async () => {
              const color = await pickColorViaScreen();
              if (color) createSwatchItem(canvasPoint, color);
            },
            { icon: <EyedropperIcon /> },
          ),
        ]
      : []),
    separator,
    action('Paste', () => void pasteFromAnywhere(canvasPoint), {
      shortcut: 'Ctrl+V',
      disabled: !canPasteNow(),
      icon: <PasteIcon />,
    }),
    action('Select all', () => session.setSelection(Object.keys(doc.items)), {
      shortcut: 'Ctrl+A',
      disabled: Object.keys(doc.items).length === 0,
      icon: <SelectAllIcon />,
    }),
    separator,
    action('Reset view', resetView, { shortcut: 'Ctrl+Shift+0', icon: <ResetViewIcon /> }),
  ];
}

export function buildItemMenu(itemId: string): MenuEntry[] {
  const session = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();
  const selection = session.selection.includes(itemId) ? session.selection : [itemId];
  const items = selection.map((id) => doc.items[id]).filter((i) => i !== undefined);
  const single = items.length === 1 ? items[0] : undefined;
  const allLocked = items.every((i) => i.locked);
  const allHidden = items.every((i) => i.hidden);

  // Read-only canvas: look at it, or copy it to a board of your own.
  if (canvasReadOnly()) {
    return [
      ...(single
        ? [
            action(
              'Open',
              () => {
                void import('../components/lightbox/Lightbox').then((m) => m.openLightbox(single));
              },
              { icon: <EyeIcon /> },
            ),
          ]
        : []),
      action('Copy', copySelection, { shortcut: 'Ctrl+C', icon: <CopyIcon /> }),
    ];
  }

  // Locked = view-only content: no selecting, no editing. The menu offers
  // exactly two things — look at it (one item), or unlock to edit again.
  if (allLocked) {
    return [
      ...(single
        ? [
            action(
              'Open',
              () => {
                void import('../components/lightbox/Lightbox').then((m) => m.openLightbox(single));
              },
              { icon: <EyeIcon /> },
            ),
          ]
        : []),
      action(
        'Unlock',
        () =>
          setItemsLocked(
            items.map((i) => i.id),
            false,
          ),
        { icon: <UnlockIcon /> },
      ),
    ];
  }

  const entries: MenuEntry[] = [
    // Generic Edit for types whose editor is otherwise a hover/desktop-only
    // affordance (style panels, hover-gated ⚙). Long-press reaches this on
    // touch. Types with their own dedicated entry (text/code, QR content,
    // plugin Edit entries) are excluded to avoid doubles.
    ...(single &&
    !single.locked &&
    ['link', 'iframe', 'tierlist', 'tree', 'tasklist', 'storyboard', 'project', 'case'].includes(
      single.type,
    )
      ? [action('Edit', () => editItem(single), { icon: <PencilIcon /> })]
      : []),
    ...(single?.type === 'shape' && single.shape === 'path' && !single.locked
      ? [
          action(
            'Edit Points',
            () => {
              session.setSelection([]);
              session.setPathEditId(single.id);
            },
            { icon: <PenToolIcon /> },
          ),
        ]
      : []),
    action('Copy', copySelection, { shortcut: 'Ctrl+C', icon: <CopyIcon /> }),
    action('Cut', cutSelection, { shortcut: 'Ctrl+X', icon: <ScissorsIcon /> }),
    action(
      'Duplicate',
      () => {
        const ids = duplicateItems(selection);
        if (ids.length) session.setSelection(ids);
      },
      { shortcut: 'Ctrl+D', icon: <DuplicateIcon /> },
    ),
    action(
      'Delete',
      () => {
        removeItems(selection);
        session.clearSelection();
      },
      { shortcut: 'Del', danger: true, icon: <TrashIcon /> },
    ),
    separator,
    {
      kind: 'submenu',
      label: 'Arrange',
      icon: <LayersIcon />,
      children: [
        action('Bring to front', () => reorderItems(selection, 'front'), {
          shortcut: 'Ctrl+Shift+]',
          icon: <BringFrontIcon />,
        }),
        action('Bring forward', () => reorderItems(selection, 'forward'), {
          shortcut: 'Ctrl+]',
          icon: <BringFwdIcon />,
        }),
        action('Send backward', () => reorderItems(selection, 'backward'), {
          shortcut: 'Ctrl+[',
          icon: <SendBackwardIcon />,
        }),
        action('Send to back', () => reorderItems(selection, 'back'), {
          shortcut: 'Ctrl+Shift+[',
          icon: <SendBackIcon />,
        }),
      ],
    },
    action(allLocked ? 'Unlock' : 'Lock', () => setItemsLocked(selection, !allLocked), {
      icon: allLocked ? <UnlockIcon /> : <LockIcon />,
    }),
    action(allHidden ? 'Show' : 'Hide', () => setItemsHidden(selection, !allHidden), {
      icon: allHidden ? <EyeIcon /> : <EyeOffIcon />,
    }),
    // Pages: relocate the selection to another sheet (multi-page boards).
    ...(doc.pages.length > 1
      ? [
          {
            kind: 'submenu' as const,
            label: 'Move to page',
            icon: <PagesIcon />,
            children: doc.pages
              .filter((p) => p.id !== pagesActiveId(doc))
              .map((p) =>
                action(p.name, () => {
                  void runBoardTool('move_to_page', { ids: selection, page: p.id });
                }),
              ),
          },
        ]
      : []),
    action(
      single?.tags?.length ? `Tags (${single.tags.length})…` : 'Tags',
      () => session.setTagEditor(selection),
      { icon: <TagIcon /> },
    ),
    action(single?.notes ? 'Note' : 'Add note', () => session.setNoteEditor(selection), {
      icon: <StickyNoteIcon />,
    }),
    // Evidence status (research boards): confirmed / unverified / debunked
    // badge + debunked dimming; the status word is searchable.
    {
      kind: 'submenu',
      label: 'Evidence',
      icon: <EvidenceIcon />,
      children: [
        ...EVIDENCE_STATUSES.map((s) =>
          action(
            s.name,
            () =>
              updateItems(selection, 'Set evidence status', (it) => {
                it.status = s.id;
              }),
            { checked: items.every((i) => i.status === s.id) },
          ),
        ),
        separator,
        action(
          'Clear status',
          () =>
            updateItems(selection, 'Clear evidence status', (it) => {
              delete it.status;
            }),
          { disabled: items.every((i) => !i.status) },
        ),
        separator,
        // Strength 1–5: how far a case may lean on the item (lib/evidenceWeight).
        ...WEIGHT_LEVELS.map((w) =>
          action(
            `Strength ${w.value}: ${w.name}`,
            () =>
              updateItems(selection, 'Set evidence strength', (it) => {
                it.weight = w.value;
              }),
            { checked: items.every((i) => i.weight === w.value) },
          ),
        ),
        action(
          'Unrated',
          () =>
            updateItems(selection, 'Clear evidence strength', (it) => {
              delete it.weight;
            }),
          { disabled: items.every((i) => !i.weight) },
        ),
        separator,
        // Link the selection to a conclusion of a case (plugins/cases dialog).
        action(
          'Add to case',
          () =>
            window.dispatchEvent(
              new CustomEvent('boardcache:add-to-case', { detail: { ids: selection } }),
            ),
          {
            disabled:
              !Object.values(doc.items).some((i) => i.type === 'case') ||
              items.every((i) => i.type === 'case'),
          },
        ),
      ],
    },
    ...(single
      ? [
          action('More Like This', () => session.setMoreLikeThis(single.id), {
            icon: <SparkleIcon />,
          }),
        ]
      : []),
    // Attached to a timeline point → offer an explicit detach.
    ...(single && attachedPointOf(doc, single.id)
      ? [
          action('Detach from Timeline', () => detachItems([single.id]), {
            icon: <MilestoneIcon />,
          }),
        ]
      : []),
    // 2+ plain items → build a timeline out of them (one point each).
    ...(items.length >= 2 && items.every((i) => i.type !== 'timeline')
      ? [
          action('Create Timeline from Selection', () => createTimelineFromSelection(selection), {
            icon: <MilestoneIcon />,
          }),
        ]
      : []),
    // 360° toggle: force the pano player on/off (auto-detection can miss
    // unmarked panoramas and misfire on plain 2:1 images). Only offered when
    // the aspect ratio suggests an equirect (or an override is already set).
    ...(single?.type === 'image' && (single.pano !== undefined || panoCandidate(single))
      ? [
          action(
            isPanoImage(single) ? 'View as Flat Image' : 'View as 360° Panorama',
            () => {
              const next = !isPanoImage(single);
              updateItems([single.id], next ? 'View as panorama' : 'View as flat image', (it) => {
                if (it.type === 'image') it.pano = next;
              });
            },
            { icon: <ImageIcon /> },
          ),
        ]
      : []),
    // Set Cover: this item's region becomes the board thumbnail everywhere
    // (library tiles, community cards) instead of the whole-board overview.
    ...(single
      ? [
          action(
            doc.settings.coverItemId === single.id ? 'Remove Cover' : 'Set as Cover',
            () =>
              updateBoardSettings({
                coverItemId: doc.settings.coverItemId === single.id ? null : single.id,
              }),
            { icon: <ImageIcon /> },
          ),
        ]
      : []),
    action('Copy to Board', () => session.setSendToBoard({ ids: selection, mode: 'copy' }), {
      icon: <BoardsIcon />,
    }),
    action('Move to Board', () => session.setSendToBoard({ ids: selection, mode: 'move' }), {
      icon: <BoardsIcon />,
    }),
    ...(single
      ? (() => {
          const n = Object.values(doc.comments).filter((c) => c.itemId === single.id).length;
          return [
            action(
              n > 0 ? `Comments (${n})` : 'Comments',
              () => {
                session.setLightboxCommentsHint(true);
                session.setLightbox(single.id);
              },
              { icon: <ChatIcon /> },
            ),
          ];
        })()
      : []),
  ];

  // Grouping (only meaningful for 2+ items or an existing group).
  const groupState = selectionGroupState(doc, selection, session.isolatedGroupId);
  if (groupState.groupId) {
    const gid = groupState.groupId;
    entries.splice(
      3,
      0,
      action('Ungroup', ungroupSelection, { shortcut: 'Ctrl+Shift+G', icon: <UngroupIcon /> }),
      {
        kind: 'submenu',
        label: 'Download',
        icon: <DownloadIcon />,
        children: [
          action('Files (.zip)', () => void exportGroupAsPlainZip(gid)),
          action('Image (.png)', () => void exportGroupAsPng(gid)),
          action('Board archive (.boardcache)', () => void exportGroupAsArchive(gid)),
        ],
      },
      separator,
    );
  } else if (groupState.count >= 2) {
    const picked = () => selection.map((id) => doc.items[id]).filter((i): i is Item => !!i);
    entries.splice(
      3,
      0,
      action(groupState.allSwatches ? 'Create palette' : 'Group', groupSelection, {
        shortcut: 'Ctrl+G',
        icon: groupState.allSwatches ? <PaletteIcon /> : <GroupIcon />,
      }),
      {
        kind: 'submenu',
        label: 'Download',
        icon: <DownloadIcon />,
        children: [
          action(
            'Files (.zip)',
            () => void exportItemsAsPlainZip(picked(), `${doc.name} selection`),
          ),
          action('Image (.png)', () => void exportItemsAsPng(picked(), `${doc.name} selection`)),
        ],
      },
      separator,
    );
  }

  // Any item without an intrinsic URL can carry a user-attached link.
  if (single && canAttachUrl(single)) {
    const current = single.linkUrl ?? '';
    entries.push(
      separator,
      action(
        current ? 'Edit URL' : 'Add URL',
        () => {
          const next = window.prompt('Link URL for this item:', current || 'https://');
          if (next === null) return;
          const url = next.trim();
          updateItems([single.id], url ? 'Set URL' : 'Remove URL', (it) => {
            it.linkUrl = url || undefined;
          });
        },
        { icon: <LinkIcon /> },
      ),
    );
    if (current) {
      entries.push(
        action('Open URL', () => openUrl(current), { icon: <ExternalLinkIcon /> }),
        action(
          'Remove URL',
          () =>
            updateItems([single.id], 'Remove URL', (it) => {
              it.linkUrl = undefined;
            }),
          { icon: <CloseIcon /> },
        ),
      );
    }
  }

  if (single?.type === 'text' || single?.type === 'code') {
    entries.unshift(
      action(
        single.type === 'code' ? 'Edit code' : 'Edit text',
        () => session.setEditingItemId(single.id),
        {
          shortcut: 'dbl-click',
          icon: <PencilIcon />,
        },
      ),
      action('Open in lightbox', () => session.setLightbox(single.id), {
        icon: <LightboxIcon />,
      }),
      separator,
    );
  }
  if (single) {
    // Every type downloads: its own file, Markdown for the cards, the
    // type's extras, and always a PNG (lib/export/downloadItem).
    entries.push({
      kind: 'submenu',
      label: 'Download',
      icon: <DownloadIcon />,
      children: itemDownloads(single, doc).map((d) =>
        action(d.label, () => {
          void d.run().catch((err: unknown) => {
            window.alert(err instanceof Error ? err.message : 'Download failed.');
          });
        }),
      ),
    });
  }

  if (single?.type === 'image') {
    entries.push(separator);
    entries.push(
      // Rotated images get a bake-down: crop math only works axis-aligned.
      ...(single.rotation !== 0
        ? [
            action('Reset Bounding Box', () => void rasterizeRotation(single.id), {
              icon: <CropIcon />,
            }),
          ]
        : []),
      action('Flip horizontal', () => flipImageH(single.id), {
        checked: single.flipH,
        icon: <FlipHIcon />,
      }),
      action('Flip vertical', () => flipImageV(single.id), {
        checked: single.flipV,
        icon: <FlipVIcon />,
      }),
    );
    if (single.crop) {
      entries.push(
        action('Restore original (uncrop)', () => restoreImageCrop(single.id), {
          icon: <CropIcon />,
        }),
      );
    }
    if (ocrAvailable()) {
      entries.push(
        action(
          'Extract Text (OCR)',
          () => {
            void runOcr(single.id).catch((err: unknown) => {
              window.alert(err instanceof Error ? err.message : 'OCR failed.');
            });
          },
          { icon: <FileTextIcon /> },
        ),
        action(
          single.description ? 'Regenerate Description' : 'Generate Description',
          () => {
            void runDescribe(single.id).catch((err: unknown) => {
              window.alert(err instanceof Error ? err.message : 'Description failed.');
            });
          },
          { icon: <FileTextIcon /> },
        ),
      );
    }
    if (single.ocrText) {
      entries.push(
        action('Text Box from OCR', () => void textBoxFromOcr(single.id), {
          icon: <FileTextIcon />,
        }),
      );
    }
    entries.push(
      action(
        'Extract palette',
        async () => {
          const colors = await extractPaletteFromAsset(single.assetId, 6);
          if (colors.length === 0) return;
          createPaletteItem(
            { x: single.x, y: single.y + single.height + 24 },
            colors.map((color) => ({ color })),
            {
              name: single.name ? `${single.name} palette` : 'Extracted palette',
              sourceAssetId: single.assetId,
            },
          );
        },
        { icon: <PaletteIcon /> },
      ),
    );
  }

  // Plugin-contributed entries for the right-clicked item.
  if (single) {
    const pluginEntries = pluginItemMenuEntries(single);
    if (pluginEntries.length) entries.push(separator, ...pluginEntries);
  }

  // Alignment / distribution / size matching for multi-selections.
  const arrangeable = items.filter((i) => !i.locked && i.type !== 'arrow');
  if (arrangeable.length >= 2) {
    const ids = arrangeable.map((i) => i.id);
    entries.push(
      separator,
      {
        kind: 'submenu',
        label: 'Align',
        icon: <AlignLeftIcon />,
        children: [
          action('Align left', () => alignItems(ids, 'left'), { icon: <AlignLeftIcon /> }),
          action('Align horizontal centers', () => alignItems(ids, 'centerX'), {
            icon: <AlignCenterXIcon />,
          }),
          action('Align right', () => alignItems(ids, 'right'), { icon: <AlignRightIcon /> }),
          separator,
          action('Align top', () => alignItems(ids, 'top'), { icon: <AlignTopIcon /> }),
          action('Align vertical centers', () => alignItems(ids, 'middleY'), {
            icon: <AlignMiddleYIcon />,
          }),
          action('Align bottom', () => alignItems(ids, 'bottom'), { icon: <AlignBottomIcon /> }),
          separator,
          action('Distribute horizontally', () => distributeItems(ids, 'x'), {
            disabled: arrangeable.length < 3,
            icon: <DistributeHIcon />,
          }),
          action('Distribute vertically', () => distributeItems(ids, 'y'), {
            disabled: arrangeable.length < 3,
            icon: <DistributeVIcon />,
          }),
        ],
      },
      action('Match width', () => matchItemSize(ids, 'width'), { icon: <MatchWidthIcon /> }),
      action('Match height', () => matchItemSize(ids, 'height'), { icon: <MatchHeightIcon /> }),
      action('Organize', () => organizeSelection(ids), { icon: <GridIcon /> }),
    );
  }

  const fileAudios = items.filter((i) => i.type === 'audio' && i.assetId !== null);
  if (fileAudios.length >= 2) {
    entries.push(
      separator,
      action(
        `Combine ${fileAudios.length} into playlist`,
        () => combineIntoPlaylist(fileAudios.map((a) => a.id)),
        { icon: <PlaylistIcon /> },
      ),
    );
  }

  // Speech-to-text: manual per item (never automatic), local files only.
  if (
    single &&
    (single.type === 'audio' || single.type === 'video') &&
    single.assetId &&
    transcribeAvailable()
  ) {
    const media = single;
    entries.push(
      separator,
      action(
        single.transcript ? 'Re-transcribe (AI)' : 'Transcribe (AI)',
        () => {
          void transcribeItem(media.id).catch((err: unknown) => {
            window.alert(err instanceof Error ? err.message : 'Transcription failed.');
          });
        },
        { icon: <FileTextIcon /> },
      ),
    );
  }

  // Markers → storyboard: one panel per marker, framed with captured stills.
  if (single?.type === 'video' && single.assetId && single.markers.length > 0) {
    const video = single;
    entries.push(
      separator,
      action(
        'Storyboard from markers',
        () => {
          void import('./structure/storyboardFromMarkers')
            .then((m) => m.storyboardFromMarkers(video.id))
            .catch((err: unknown) => {
              window.alert(err instanceof Error ? err.message : 'Could not build the storyboard.');
            });
        },
        { icon: <FilmIcon /> },
      ),
    );
  }

  if (single?.type === 'qr') {
    const qr = single;
    entries.push(
      separator,
      action(
        'Edit QR Content',
        () => {
          const next = window.prompt('Text or URL for the QR code:', qr.text);
          if (next === null || !next.trim()) return;
          updateItems([qr.id], 'QR content', (it) => {
            if (it.type === 'qr') it.text = next.trim();
          });
        },
        { icon: <QrIcon /> },
      ),
    );
  }

  if (single?.type === 'video') {
    const video = single;
    entries.push(
      separator,
      action(
        'Rename',
        () => {
          const next = window.prompt('Name this video:', video.name ?? '');
          if (next === null) return;
          updateItems([video.id], 'Rename video', (it) => {
            it.name = next.trim() || undefined;
          });
        },
        { icon: <RenameIcon /> },
      ),
    );
    if (video.embed) {
      entries.push(
        separator,
        action('Open in lightbox', () => session.setLightbox(video.id), {
          shortcut: 'dbl-click',
          icon: <LightboxIcon />,
        }),
      );
    } else {
      entries.push(
        separator,
        action('Play / Pause', () => togglePlay(getVideo(video.id)), { icon: <PlayIcon /> }),
        action('Next frame', () => stepFrame(getVideo(video.id), 1), { icon: <StepFwdIcon /> }),
        action('Previous frame', () => stepFrame(getVideo(video.id), -1), {
          icon: <StepBackIcon />,
        }),
        action(video.loop ? 'Loop: on' : 'Loop: off', () => toggleLoop(video, getVideo(video.id)), {
          checked: video.loop,
          icon: <LoopIcon />,
        }),
        action(video.muted ? 'Unmute' : 'Mute', () => toggleMute(video, getVideo(video.id)), {
          checked: video.muted,
          icon: <VolumeIcon level={video.muted ? 0 : 1} />,
        }),
        separator,
        action('Choose poster frame', () => session.setVideoPosterPickerId(video.id), {
          icon: <CameraIcon />,
        }),
        action(
          'New image from current frame',
          () => void captureFrameToImage(video, getVideo(video.id)),
          { icon: <CameraIcon /> },
        ),
        action('Fullscreen', () => fullscreenVideo(getVideo(video.id)), { icon: <ExpandIcon /> }),
        action('Open in lightbox', () => session.setLightbox(video.id), {
          shortcut: 'dbl-click',
          icon: <LightboxIcon />,
        }),
      );
    }
  }

  if (single?.type === 'swatch') {
    const swatch = single;
    entries.push(
      separator,
      action(
        'Rename',
        () => {
          const next = window.prompt('Name this color:', swatch.name ?? '');
          if (next === null) return;
          updateItems([swatch.id], 'Rename color', (it) => {
            it.name = next.trim() || undefined;
          });
        },
        { icon: <RenameIcon /> },
      ),
      action('Copy hex', () => void navigator.clipboard.writeText(single.color), {
        icon: <CopyIcon />,
      }),
      {
        kind: 'submenu',
        label: 'Harmony palette',
        icon: <PaletteIcon />,
        children: HARMONY_KINDS.map((kind) =>
          action(kind[0]!.toUpperCase() + kind.slice(1), () =>
            createPaletteItem(
              { x: single.x, y: single.y + single.height + 24 },
              harmony(single.color, kind).map((color) => ({ color })),
              { name: `${kind} of ${single.name ?? single.color}` },
            ),
          ),
        ),
      },
    );
  }

  if (single?.type === 'pdf') {
    entries.push(
      separator,
      action('Open in lightbox', () => session.setLightbox(single.id), {
        icon: <LightboxIcon />,
      }),
    );
  }

  if (single?.type === 'palette') {
    const palette = single;
    entries.push(
      separator,
      action(
        'Rename',
        () => {
          const next = window.prompt('Name this palette:', palette.name ?? '');
          if (next === null) return;
          updateItems([palette.id], 'Rename palette', (it) => {
            it.name = next.trim() || undefined;
          });
        },
        { icon: <RenameIcon /> },
      ),
      action('Copy colors', () => copyPaletteColors(single.colors), { icon: <CopyIcon /> }),
    );
  }

  // Presentation Mode: the selection (a whole group as one step) joins or leaves the order.
  {
    const targets = groupState.groupId ? [groupState.groupId] : selection;
    const listed = targets.every((id) => isPresented(doc, id));
    entries.push(
      separator,
      listed
        ? action('Remove from presentation', () => removeFromPresentation(targets), {
            icon: <PresentationIcon />,
          })
        : action('Add to presentation', () => addToPresentation(targets), {
            icon: <PresentationIcon />,
          }),
    );
  }
  return entries;
}
