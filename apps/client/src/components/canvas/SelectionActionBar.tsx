import { ImageIcon, CloseIcon } from '../icons';
import { putAsset } from '../../lib/board/assetStore';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { groupSelection, ungroupSelection } from '../../lib/canvas/groupActions';
import { selectionGroupState } from '../../lib/canvas/grouping';
import { renameGroup, updateGroupBackground, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Neutral starting color when a group first gains a background. */
const DEFAULT_GROUP_BG = '#2a2f37';

/** The group's name in the bar — click it to rename in place. */
export function GroupNameLabel({
  groupId,
  name,
}: {
  groupId: string;
  name: string | null | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className="sab-label sab-name"
        data-testid="group-name"
        title="Rename group"
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
      >
        {name || 'Group'}
      </button>
    );
  }
  return (
    <input
      className="sab-name-input"
      data-testid="group-name-input"
      defaultValue={name ?? ''}
      placeholder="Group name"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        if (!cancelled.current) renameGroup(groupId, e.currentTarget.value);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Contextual bar at the top of the canvas. Shows an opacity slider for any
 * selection; Group / Create palette for a multi-selection; and Ungroup plus an
 * optional container background (color + opacity) for a group. Slider drags use
 * a session preview so the whole gesture lands as ONE undo step.
 */
export function SelectionActionBar() {
  const selection = useSessionStore((s) => s.selection);
  const isolated = useSessionStore((s) => s.isolatedGroupId);
  const state = useDocumentStore(
    useShallow((s) => selectionGroupState(s.doc, selection, isolated)),
  );
  const firstOpacity = useDocumentStore((s) => {
    const id = selection[0];
    return id ? (s.doc.items[id]?.opacity ?? 1) : 1;
  });
  // A lone embed (PDF / iframe) owns the top-of-item control strip the bar would
  // sit on top of; skip the bar so its own controls stay reachable.
  const soleEmbed = useDocumentStore((s) => {
    if (selection.length !== 1) return false;
    const type = s.doc.items[selection[0]!]?.type;
    return type === 'pdf' || type === 'iframe';
  });
  const group = useDocumentStore((s) => (state.groupId ? s.doc.groups[state.groupId] : undefined));
  const opacityPreview = useSessionStore((s) => s.opacityPreview);
  const setOpacityPreview = useSessionStore((s) => s.setOpacityPreview);
  const groupBgPreview = useSessionStore((s) => s.groupBgPreview);
  const setGroupBgPreview = useSessionStore((s) => s.setGroupBgPreview);

  const groupImgInputRef = useRef<HTMLInputElement>(null);

  if ((state.count < 1 && !state.groupId) || soleEmbed) return null;

  const displayOpacity = opacityPreview?.value ?? firstOpacity;
  const commitOpacity = () => {
    const pending = useSessionStore.getState().opacityPreview;
    setOpacityPreview(null);
    if (pending) updateItems(pending.ids, 'Opacity', (it) => (it.opacity = pending.value));
  };

  const groupId = state.groupId;
  const bg = group?.background;
  const groupImage = group?.backgroundImage ?? null;
  const bgOpacity =
    groupBgPreview?.id === groupId
      ? (groupBgPreview.backgroundOpacity ?? 1)
      : (group?.backgroundOpacity ?? 1);
  const commitBgOpacity = () => {
    const pending = useSessionStore.getState().groupBgPreview;
    setGroupBgPreview(null);
    if (pending?.backgroundOpacity !== undefined) {
      updateGroupBackground(pending.id, { backgroundOpacity: pending.backgroundOpacity });
    }
  };

  return (
    <div className="selection-action-bar" data-testid="selection-action-bar">
      <label className="sab-field" title="Opacity">
        <span className="sab-field-label">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          data-testid="opacity-slider"
          value={displayOpacity}
          onChange={(e) => setOpacityPreview({ ids: selection, value: Number(e.target.value) })}
          onPointerUp={commitOpacity}
          onKeyUp={commitOpacity}
        />
        <span className="sab-percent">{Math.round(displayOpacity * 100)}%</span>
      </label>

      {groupId ? (
        <>
          <span className="sab-sep" />
          <GroupNameLabel groupId={groupId} name={state.groupName} />
          <label className="sab-field" title="Group background">
            <span className="sab-field-label">Fill</span>
            <input
              type="color"
              className="sab-swatch"
              data-testid="group-bg-color"
              value={bg ?? DEFAULT_GROUP_BG}
              onChange={(e) => updateGroupBackground(groupId, { background: e.target.value })}
            />
          </label>
          {bg ? (
            <>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                data-testid="group-bg-opacity"
                title="Background opacity"
                value={bgOpacity}
                onChange={(e) =>
                  setGroupBgPreview({ id: groupId, backgroundOpacity: Number(e.target.value) })
                }
                onPointerUp={commitBgOpacity}
                onKeyUp={commitBgOpacity}
              />
              <button
                type="button"
                className="sab-ghost"
                data-testid="group-bg-clear"
                onClick={() => updateGroupBackground(groupId, { background: null })}
                title="Remove background"
              >
                Clear
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="sab-ghost"
            data-testid="group-bg-image-pick"
            title={groupImage ? 'Replace group background image' : 'Group background image'}
            onClick={() => groupImgInputRef.current?.click()}
          >
            <ImageIcon size={14} />
          </button>
          <input
            ref={groupImgInputRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="group-bg-image-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file || !groupId) return;
              void putAsset(file).then((assetId) =>
                updateGroupBackground(groupId, {
                  backgroundImage: { assetId, mode: 'cover', opacity: 1 },
                }),
              );
            }}
          />
          {groupImage && (
            <>
              <select
                className="sab-select"
                value={groupImage.mode}
                data-testid="group-bg-image-mode"
                title="Image fit"
                onChange={(e) =>
                  updateGroupBackground(groupId, {
                    backgroundImage: {
                      ...groupImage,
                      mode: e.target.value as typeof groupImage.mode,
                    },
                  })
                }
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="tile">Tile</option>
                <option value="center">Center</option>
              </select>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                data-testid="group-bg-image-opacity"
                title="Image opacity"
                value={groupImage.opacity}
                onChange={(e) =>
                  updateGroupBackground(groupId, {
                    backgroundImage: { ...groupImage, opacity: Number(e.target.value) },
                  })
                }
              />
              <button
                type="button"
                className="sab-ghost"
                data-testid="group-bg-image-clear"
                title="Remove group image"
                onClick={() => updateGroupBackground(groupId, { backgroundImage: null })}
              >
                <CloseIcon size={12} />
              </button>
            </>
          )}
          <button
            type="button"
            className="sab-ghost"
            data-testid="group-isolate"
            title="Isolate this group — edit members individually (double-click also works)"
            onClick={() => {
              const session = useSessionStore.getState();
              session.setIsolatedGroup(groupId);
              session.clearSelection();
            }}
          >
            Isolate
          </button>
          <button
            type="button"
            className="btn-primary"
            data-testid="ungroup-button"
            onClick={ungroupSelection}
            title="Ungroup (Ctrl/Cmd+Shift+G)"
          >
            Ungroup
          </button>
        </>
      ) : state.count >= 2 ? (
        <>
          <span className="sab-sep" />
          <span className="sab-count">{state.count} selected</span>
          <button
            type="button"
            className="btn-primary"
            data-testid="group-button"
            onClick={groupSelection}
            title={
              state.allSwatches ? 'Combine swatches into a palette' : 'Group selection (Ctrl/Cmd+G)'
            }
          >
            {state.allSwatches ? 'Create palette' : 'Group'}
          </button>
        </>
      ) : null}
    </div>
  );
}
