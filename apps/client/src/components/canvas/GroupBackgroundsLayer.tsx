import type { PointerEvent as ReactPointerEvent } from 'react';
import { canvasReadOnly } from '../../lib/canvas/readOnly';
import { beginMove, effectiveBounds } from '../../lib/canvas/gestures';
import { rotatedRectAABB, unionRects } from '../../lib/canvas/geometry';
import { groupMembers, groupChain, isInsideGroup } from '../../lib/canvas/grouping';
import type { Group } from '@boardcache/schema';
import { bgImageCss } from '../../lib/canvas/bgImage';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { darkVariant } from '../../lib/color/color';
import { useDocumentStore } from '../../state/documentStore';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';

/** Breathing room between the grouped items and the container edge. */
const GROUP_BG_PADDING = 16;

/**
 * Renders the optional container background behind each group that has one.
 * Sits first in the canvas world (below every item) and follows the group's
 * union bounds live during move/resize gestures. Purely decorative — it never
 * captures pointer events, so the items underneath still drive selection.
 */
/** The image sub-layer needs a hook (asset blob URL), hence a component. */
function GroupBgImage({ image }: { image: NonNullable<Group['backgroundImage']> }) {
  const url = useAssetUrl(image.assetId);
  if (!url) return null;
  return (
    <div
      className="group-bg-img"
      data-testid="group-bg-img"
      style={{
        backgroundImage: `url(${url})`,
        opacity: image.opacity,
        ...bgImageCss(image.mode),
      }}
    />
  );
}

export function GroupBackgroundsLayer() {
  const groups = useDocumentStore((s) => s.doc.groups);
  const items = useDocumentStore((s) => s.doc.items);
  const overrides = useSessionStore((s) => s.gesture?.overrides);
  const preview = useSessionStore((s) => s.groupBgPreview);
  const armedId = useSessionStore((s) => s.groupDropArmed);
  const hoverId = useSessionStore((s) => s.groupDropHover);
  const isolatedId = useSessionStore((s) => s.isolatedGroupId);
  // Backdrop colours are picked against the light page; in dark mode a pale
  // tint washes out, so it shows as its deep counterpart (lib/color).
  const dark = useSessionStore((s) => resolveTheme(s.theme) === 'dark');

  const rects = Object.values(groups)
    .map((group) => {
      const pv = preview?.id === group.id ? preview : null;
      const picked = pv?.background ?? group.background;
      const background = picked && dark ? darkVariant(picked) : picked;
      const image = group.backgroundImage ?? null;
      // Backdrop-less groups still render (transparent) while a drag hovers
      // or arms them, so the drop hint has something to attach to.
      const dropTarget = armedId === group.id || hoverId === group.id;
      if (!background && !image && !dropTarget) return null;
      const opacity = pv?.backgroundOpacity ?? group.backgroundOpacity ?? 1;
      const memberRects = Object.values(items)
        .filter((it) => isInsideGroup({ items, groups }, it, group.id))
        .map((it) => rotatedRectAABB(effectiveBounds(it, overrides?.[it.id])));
      const union = unionRects(memberRects);
      if (!union) return null;
      return {
        id: group.id,
        union,
        background: background ?? null,
        opacity,
        image,
        name: group.name,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rects.length === 0) return null;

  /** The group a backdrop press or double-click acts on at the current
   *  isolation level: the group itself when it sits directly under the
   *  isolated group (or at the top with none), else its ancestor at that
   *  level; null when the group IS the isolated one. */
  const unitGroup = (groupId: string): string | null => {
    const doc = useDocumentStore.getState().doc;
    const chain = groupChain(doc, groupId); // the group, then its ancestors
    const iso = useSessionStore.getState().isolatedGroupId;
    const level = iso ? chain.indexOf(iso) : -1;
    if (level === 0) return null;
    return level > 0 ? chain[level - 1]! : chain[chain.length - 1]!;
  };

  // Drag the backdrop (its padding ring / gaps between items) to move the group.
  const onPointerDown = (e: ReactPointerEvent, groupId: string) => {
    if (e.button !== 0) return;
    // A locked canvas (pan tool) or a held Space pans through the backdrop.
    if (canvasReadOnly() || useSessionStore.getState().spaceHeld) return;
    const doc = useDocumentStore.getState().doc;
    // Inside an isolated group its own backdrop is just floor: the press
    // falls through (members select individually). Locked members are
    // view-only: a group with nothing unlocked is inert the same way.
    const unit = unitGroup(groupId);
    if (!unit) return;
    const movable = groupMembers(doc, unit).filter((id) => !doc.items[id]?.locked);
    if (movable.length === 0) return;
    e.stopPropagation();
    useSessionStore.getState().setSelection(movable);
    beginMove(e);
  };

  return (
    <div className="group-bg-layer" aria-hidden>
      {rects.map(({ id, union, background, opacity, image, name }) => (
        <div
          key={id}
          className={`group-bg${armedId === id ? ' group-bg-armed' : ''}${
            hoverId === id && armedId !== id ? ' group-bg-hover' : ''
          }${
            isolatedId !== null &&
            isolatedId !== id &&
            !groupChain({ items, groups }, id).includes(isolatedId)
              ? ' iso-dim'
              : ''
          }`}
          data-testid="group-bg"
          data-group-id={id}
          onPointerDown={(e) => onPointerDown(e, id)}
          onDoubleClick={(e) => {
            const doc = useDocumentStore.getState().doc;
            // Nothing to edit inside a fully locked group, or on a locked
            // canvas: no isolation.
            if (canvasReadOnly()) return;
            if (groupMembers(doc, id).every((m) => doc.items[m]?.locked)) return;
            e.stopPropagation();
            const session = useSessionStore.getState();
            // One level at a time, like a member double-click.
            const unit = unitGroup(id);
            if (unit && session.isolatedGroupId !== unit) session.setIsolatedGroup(unit);
          }}
          style={{
            transform: `translate(${union.x - GROUP_BG_PADDING}px, ${union.y - GROUP_BG_PADDING}px)`,
            width: union.width + GROUP_BG_PADDING * 2,
            height: union.height + GROUP_BG_PADDING * 2,
            ...(background ? { background } : {}),
            opacity: background ? opacity : 1,
          }}
        >
          {image && <GroupBgImage image={image} />}
          {(hoverId === id || armedId === id) && (
            <span className="group-drop-hint" data-testid="group-drop-hint">
              {armedId === id
                ? `Release to add to ${name ?? 'group'}`
                : `Hold to add to ${name ?? 'group'}`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
