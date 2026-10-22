import { SCHEMA_VERSION } from './document';

/**
 * Schema-first I/O (architectural rule 3.7): every persisted document carries
 * `schemaVersion`; loading runs the ordered migration chain before Zod
 * validation, so the file format can evolve without breaking old boards.
 */

/** A migration takes a raw document at version `from` to version `from + 1`. */
export interface Migration {
  from: number;
  description: string;
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Ordered list of migrations. Append-only: when SCHEMA_VERSION bumps to N+1,
 * add a migration with `from: N`.
 */
export const migrations: Migration[] = [
  {
    from: 1,
    description: 'video items gained provider embeds (assetId now nullable, embed added)',
    // Structural no-op: existing file-backed video items keep their assetId;
    // the new `embed` field is filled by the schema default (null) at parse
    // time. Present so the chain from v1 is complete.
    migrate: (raw) => raw,
  },
  {
    from: 2,
    description: 'shape items gained draw/diamond/arrow kinds plus points/flipDiagonal/dashed',
    // Structural no-op: new shape fields are filled by schema defaults.
    migrate: (raw) => raw,
  },
  {
    from: 3,
    description: 'video items gained a volume field',
    // Structural no-op: volume defaults to 1 at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 4,
    description: 'text items gained fontFamily, italic, underline, and verticalAlign',
    // Structural no-op: the new text fields are filled by schema defaults.
    migrate: (raw) => raw,
  },
  {
    from: 5,
    description:
      'text items are now markdown; per-box fontWeight/italic/underline dropped (emphasis is inline markdown)',
    // Structural no-op: old text is valid markdown; the removed fields are
    // stripped on parse and emphasis now lives in the markdown source.
    migrate: (raw) => raw,
  },
  {
    from: 6,
    description: 'link items are now buttons (label + background); preview fields dropped',
    // Structural no-op: the old link preview fields are stripped on parse and
    // label/background are filled by schema defaults.
    migrate: (raw) => raw,
  },
  {
    from: 7,
    description: 'groups gained an optional backgroundOpacity',
    // Structural no-op: the new optional field is simply absent on old groups.
    migrate: (raw) => raw,
  },
  {
    from: 8,
    description: 'text items gained autoHeight (defaults true)',
    // Structural no-op: autoHeight defaults to true at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 9,
    description: 'items gained optional createdAt; settings gained galleryOrder',
    // Structural no-op: createdAt is optional; galleryOrder defaults to [].
    migrate: (raw) => raw,
  },
  {
    from: 10,
    description: 'audio items gained volume/muted/loop/playbackRate',
    // Structural no-op: the new audio fields are filled by schema defaults.
    migrate: (raw) => raw,
  },
  {
    from: 11,
    description: 'items gained an optional linkUrl',
    // Structural no-op: linkUrl is optional and simply absent on old items.
    migrate: (raw) => raw,
  },
  {
    from: 12,
    description: 'items gained optional metadata tags',
    // Structural no-op: tags is optional and simply absent on old items.
    migrate: (raw) => raw,
  },
  {
    from: 13,
    description: 'iframe items gained posterAssetId (server-rendered screenshot)',
    // Structural no-op: posterAssetId defaults to null at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 14,
    description: 'new qr item type (text, color, background)',
    // Structural no-op: a new union variant; existing items are unaffected.
    migrate: (raw) => raw,
  },
  {
    from: 15,
    description: 'audio gained provider embeds (assetId nullable); new playlist item type',
    // Structural no-op: embed defaults to null; playlist is a new variant.
    migrate: (raw) => raw,
  },
  {
    from: 16,
    description: 'video items gained labelled time markers',
    // Structural no-op: markers defaults to [] at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 17,
    description: 'canvas grid gained pattern types (gridType)',
    // Structural no-op: gridType defaults to "square" at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 18,
    description: 'new font item type (typeface specimens on the canvas)',
    // Structural no-op: new item variant only.
    migrate: (raw) => raw,
  },
  {
    from: 19,
    description: 'new rss item type (feed reader boxes)',
    // Structural no-op: new item variant only.
    migrate: (raw) => raw,
  },
  {
    from: 20,
    description: 'rss boxes gained a reader text-size multiplier (fontScale)',
    // Structural no-op: fontScale defaults to 1 at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 21,
    description: 'link buttons gained a label text size (s/m/l)',
    // Structural no-op: size defaults to m at parse time.
    migrate: (raw) => raw,
  },
  {
    from: 22,
    description: 'images gained an optional display rendition (previewAssetId)',
    // Structural no-op: absent previews fall back to the original asset.
    migrate: (raw) => raw,
  },
  {
    from: 23,
    description: 'generic htmlembed item (local self-contained HTML in a sandboxed frame)',
    // Additive item type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 24,
    description: 'code item (live-highlighted source snippet, CodeMirror-edited)',
    // Additive item type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 25,
    description: 'genInfo on items (AI generation provenance: provider/model/prompt)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 26,
    description: 'path shape kind (vector pen tool: bezier anchors + closed flag)',
    // Additive kind + optional fields; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 27,
    description: 'gradient fills on shapes (fillGradient: linear/radial + stops)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 28,
    description: 'epub item (ePub reader: cover, reading position, bookmarks)',
    // Additive item type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 29,
    description: 'title item (display text that scales to its box; no font size)',
    // Additive item type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 30,
    description: 'background images for the canvas (settings) and groups',
    // Additive optional/defaulted fields; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 31,
    description: 'document annotations: pdf bookmarks/highlights, epub highlights',
    // Additive defaulted fields; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 32,
    description: 'connections: connector lines between items/groups',
    // Additive defaulted record; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 33,
    description: 'comments: per-item comment threads',
    // Additive defaulted record; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 34,
    description: 'comments carry an optional author userId (avatar lookups)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 35,
    description: 'time item type (clock / countdown / stopwatch / pomodoro)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 36,
    description: 'image.ocrText (extracted text content)',
    // Additive field with a default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 37,
    description: 'recipe item type (schema.org recipe cards)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 38,
    description: 'poll item type (team voting cards)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 39,
    description: 'settings.coverItemId (Set Cover picks the thumbnail region)',
    // Additive setting with a parse-time default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 40,
    description: 'timeline item type (milestone axis with points)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 41,
    description: 'timeline point attachments (freeArrange flag)',
    // Additive field with a parse-time default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 42,
    description: 'timeline scaleMode (even vs date-proportional spacing)',
    // Additive field with a parse-time default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 43,
    description: 'image.pano (360° panorama viewer override)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 44,
    description: 'map item type (embedded maps + directions)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 45,
    description: 'audio/video transcript field (speech-to-text)',
    // Additive nullable field with a default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 46,
    description: 'image.description (AI-generated search metadata)',
    // Additive nullable field with a default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 47,
    description: 'connection.rel (typed connections: supports/contradicts/…)',
    // Additive enum with a default; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 48,
    description: 'item.status (evidence status: confirmed/unverified/debunked)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 49,
    description: 'item.source (capture provenance: url/title/date/quote)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 50,
    description: 'tierlist item type (S–F ranking shelves)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 51,
    description: 'tree item type (tree / mind-map with internal node edges)',
    // Additive type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 52,
    description: 'settings.themeId (per-board theme family override)',
    // Additive optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 53,
    description: 'tasklist item type (WYSIWYG checklist card)',
    // Additive item type; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 54,
    description: 'connection rels: depends/partof/follows/inspires/duplicates',
    // Additive enum values; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 55,
    description: 'tierlist description (blurb under the title)',
    // Additive defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 56,
    description: 'settings.isTemplate (personal board templates)',
    // Additive defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 57,
    description: 'image caption overlay (caption/captionCorner/captionOpacity)',
    // Additive defaulted fields; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 58,
    description: 'pages (doc.pages + item.pageId; absent = one-page board)',
    // Additive defaulted fields; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 59,
    description: 'timed transcript segments on audio/video (transcriptSegments)',
    // Additive defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 60,
    description: 'audio markers/chapters (audio.markers, video-marker shape)',
    // Additive defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 61,
    description: 'storyboard container (shot-panel grid, aspect-locked frames)',
    // New item type only; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 62,
    description: 'item visibility (optional item.hidden; absent = visible)',
    // Optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 63,
    description: 'legacy default-stamped text colors become theme sentinels (default/auto)',
    // Before sentinels, new text boxes baked the theme-at-creation colors.
    // These exact machine-stamped ink/bg pairs (default + corkboard themes,
    // light and dark) were never user choices — convert them so old boxes
    // follow light/dark mode again. Any other pair is a real override.
    migrate: (raw) => {
      const doc = raw as { items?: Record<string, Record<string, unknown>> };
      const LEGACY_INK_BG: ReadonlyArray<readonly [string, string]> = [
        ['#16181d', '#ffffff'],
        ['#f0f0f1', '#2b2b30'],
        ['#2c2418', '#fbf6ea'],
        ['#33291c', '#f3ead6'],
      ];
      for (const item of Object.values(doc.items ?? {})) {
        if (item['type'] !== 'text') continue;
        const stamped = LEGACY_INK_BG.some(
          ([ink, bg]) => item['color'] === ink && item['background'] === bg,
        );
        if (stamped) {
          item['color'] = 'default';
          item['background'] = 'auto';
        }
      }
      return raw;
    },
  },
  {
    from: 64,
    description: 'projects suite: project + milestone item types (tasks embedded on the project)',
    // Additive union variants; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 65,
    description: 'project tasks gained notifiedAt (due-date reminders)',
    // Defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 66,
    description: 'project tasks gained optional createdAt (Created sort)',
    // Optional field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 67,
    description: 'projects gained Kanban columns; tasks gained columnId',
    // Defaulted fields; empty columns = the built-in lanes.
    migrate: (raw) => raw,
  },
  {
    from: 68,
    description:
      'milestone cards fold into their project (project.milestones); depends/follows connections become dependsOn',
    migrate: (raw) => {
      type Loose = Record<string, unknown>;
      const doc = raw as {
        items?: Record<string, Loose>;
        connections?: Record<string, Loose>;
        comments?: Record<string, Loose>;
      };
      const items = doc.items ?? {};
      const msIds = new Set<string>();
      const byId = new Map<string, Loose>();
      for (const [id, it] of Object.entries(items)) {
        if (it?.type !== 'milestone') continue;
        msIds.add(id);
        const p = items[String(it.projectId)];
        if (p?.type !== 'project') continue;
        const ms: Loose = {
          id,
          title: it.title ?? 'Milestone',
          description: it.description ?? '',
          startDate: it.startDate ?? null,
          endDate: it.endDate ?? null,
          status: it.status ?? 'planned',
          itemIds: Array.isArray(it.itemIds) ? it.itemIds : [],
          dependsOn: [],
        };
        p.milestones = [...((p.milestones as Loose[] | undefined) ?? []), ms];
        byId.set(id, ms);
      }
      if (msIds.size === 0) return raw;
      const conns = doc.connections ?? {};
      for (const [cid, c] of Object.entries(conns)) {
        const from = c?.from as { kind?: string; id?: string } | undefined;
        const to = c?.to as { kind?: string; id?: string } | undefined;
        const fromMs = from?.kind === 'item' && from.id && msIds.has(from.id) ? from.id : null;
        const toMs = to?.kind === 'item' && to.id && msIds.has(to.id) ? to.id : null;
        // "A depends on / follows B": from = dependent, to = predecessor.
        if (fromMs && toMs && (c.rel === 'depends' || c.rel === 'follows')) {
          const dep = byId.get(fromMs);
          const list = dep?.dependsOn as string[] | undefined;
          if (list && !list.includes(toMs)) list.push(toMs);
        }
        if (fromMs || toMs) delete conns[cid];
      }
      for (const id of msIds) delete items[id];
      for (const it of Object.values(items)) {
        if (it?.type !== 'project') continue;
        const scrub = (l: unknown) =>
          Array.isArray(l) ? l.filter((x) => !msIds.has(String(x))) : [];
        it.itemIds = scrub(it.itemIds);
        for (const t of (it.tasks as Loose[] | undefined) ?? []) t.itemIds = scrub(t.itemIds);
        for (const m of (it.milestones as Loose[] | undefined) ?? []) m.itemIds = scrub(m.itemIds);
      }
      for (const [id, c] of Object.entries(doc.comments ?? {}))
        if (msIds.has(String(c?.itemId))) delete doc.comments![id];
      return raw;
    },
  },
  {
    from: 69,
    description: 'task lists and project cards gained optional zoom (uniform scale only)',
    // Optional field; absent keeps the legacy width-derived zoom.
    migrate: (raw) => raw,
  },
  {
    from: 70,
    description: 'tasks and milestones gained comments; tasks gained timers',
    // Defaulted fields; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 71,
    description: 'documents gained presentation steps (Presentation Mode order)',
    // Defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 72,
    description: 'projects gained calendar events',
    // Defaulted field; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 73,
    description: 'presentation steps gained an optional custom view (centre + scale)',
    // Optional field; absent keeps auto-framing.
    migrate: (raw) => raw,
  },
  {
    from: 74,
    description: "project tasks gained the 'missed' status",
    // New enum value only; existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 75,
    description: 'video items gained playbackRate',
    // Defaulted field (1 = normal speed); validation fills it in.
    migrate: (raw) => raw,
  },
  {
    from: 76,
    description: 'image captionPlacement (inside | outside)',
    // Defaulted field (inside = the overlay every board had); untouched.
    migrate: (raw) => raw,
  },
  {
    from: 77,
    description: 'image captionWrap for outside captions',
    // Defaulted field (true = wrap); untouched.
    migrate: (raw) => raw,
  },
  {
    from: 78,
    description: 'evidence weight on every item; the case item type',
    // Optional field and an additive type: existing docs are untouched.
    migrate: (raw) => raw,
  },
  {
    from: 79,
    description: 'cases weigh several conclusions; evidence links to one',
    // The v79 shape (one claim, two shelves) becomes a case with a single
    // conclusion carrying the old claim; each piece of evidence links to it.
    migrate: (raw) => {
      const doc = raw as { items?: Record<string, Record<string, unknown>> };
      for (const item of Object.values(doc.items ?? {})) {
        if (item.type !== 'case') continue;
        const claim = typeof item.claim === 'string' ? item.claim : '';
        const conclusionId = 'c1';
        item.question = '';
        item.conclusions = [{ id: conclusionId, label: claim || 'Claim' }];
        delete item.claim;
        const evidence = Array.isArray(item.evidence) ? item.evidence : [];
        item.evidence = evidence.map((e) => ({ ...(e as object), conclusionId }));
      }
      return raw;
    },
  },
  {
    from: 80,
    description: 'case cards carry a content zoom like task lists and projects',
    // Optional field; absent derives from the width as before.
    migrate: (raw) => raw,
  },
  {
    from: 81,
    description: 'groups nest: an optional parentId on a group record',
    // Optional field; every existing group stays top level.
    migrate: (raw) => raw,
  },
  {
    from: 82,
    description: 'link buttons carry a content zoom like project cards (S/M/L retired)',
    // Optional field; absent derives from the old size, so buttons look unchanged.
    migrate: (raw) => raw,
  },
  {
    from: 83,
    description: 'storyboards carry a content zoom; the height is free once set',
    // Optional field; absent is zoom 1, which is how every storyboard looked.
    migrate: (raw) => raw,
  },
];

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/**
 * Run the migration chain on a raw (already JSON-parsed, not yet validated)
 * document, bringing it from its embedded schemaVersion to `targetVersion`.
 *
 * Exported with an explicit migration list so the framework is testable with
 * synthetic migrations; production callers use `migrateDocument`.
 */
export function applyMigrations(
  raw: unknown,
  allMigrations: readonly Migration[],
  targetVersion: number,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MigrationError('Document is not an object');
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError('Document has no valid schemaVersion');
  }
  if (version > targetVersion) {
    throw new MigrationError(
      `Document schemaVersion ${version} is newer than supported version ${targetVersion}. ` +
        'Update the app to open this board.',
    );
  }
  for (let v = version; v < targetVersion; v++) {
    const migration = allMigrations.find((m) => m.from === v);
    if (!migration) {
      throw new MigrationError(`No migration from schemaVersion ${v} to ${v + 1}`);
    }
    doc = migration.migrate(doc);
    doc = { ...doc, schemaVersion: v + 1 };
  }
  return doc;
}

/** Migrate a raw document to the current SCHEMA_VERSION. */
export function migrateDocument(raw: unknown): Record<string, unknown> {
  return applyMigrations(raw, migrations, SCHEMA_VERSION);
}
