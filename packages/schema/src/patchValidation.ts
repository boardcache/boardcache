import { z } from 'zod';
import type { CanvasDocument } from './document';
import {
  boardPageSchema,
  boardSettingsSchema,
  canvasDocumentSchema,
  commentSchema,
  connectionSchema,
  groupSchema,
  presentationSchema,
  viewportSchema,
} from './document';
import { itemSchema } from './items';

/**
 * Patch-scoped validation for collaborative rooms: instead of re-parsing the
 * ENTIRE document on every patch batch (O(board) per edit — the first real
 * CPU ceiling on busy team boards), re-validate only the subtrees the
 * patches touched (O(edit)).
 *
 * Guarantees match a full parse for everything a batch can influence:
 * touched entries are normalized by their schema (defaults applied, unknown
 * keys stripped) exactly as `validateDocument` would; anything invalid
 * throws. Untouched subtrees were validated when the room loaded and cannot
 * have changed. Cross-entry references (groupId, connection endpoints) are
 * not checked — the full document schema never checked those either.
 */

/** The subset of an immer Patch this cares about. */
export interface PatchLike {
  path: (string | number)[];
}

export class PatchValidationError extends Error {
  override name = 'PatchValidationError';
}

const RECORD_SCHEMAS = {
  items: itemSchema,
  groups: groupSchema,
  connections: connectionSchema,
  comments: commentSchema,
} as const;
type RecordKey = keyof typeof RECORD_SCHEMAS;

const isRecordKey = (k: string): k is RecordKey => k in RECORD_SCHEMAS;

/** Fields a collaborative patch may never rewrite. */
const FROZEN_KEYS = new Set(['id', 'schemaVersion', 'createdAt']);

export function validatePatchedDocument(
  doc: CanvasDocument,
  patches: readonly PatchLike[],
): CanvasDocument {
  const touched: Record<RecordKey, Set<string>> = {
    items: new Set(),
    groups: new Set(),
    connections: new Set(),
    comments: new Set(),
  };
  const wholeRecords = new Set<RecordKey>();
  let touchedSettings = false;
  let touchedViewport = false;
  let touchedPages = false;
  let touchedPresentation = false;
  const scalars = new Set<'name' | 'updatedAt'>();

  for (const patch of patches) {
    if (patch.path.length === 0) {
      // Root replacement: nothing is "untouched" — fall back to a full parse.
      return canvasDocumentSchema.parse(doc);
    }
    const [head, second] = patch.path;
    if (typeof head !== 'string') {
      throw new PatchValidationError('Invalid patch path.');
    }
    if (FROZEN_KEYS.has(head)) {
      throw new PatchValidationError(`Patches may not modify "${head}".`);
    }
    if (isRecordKey(head)) {
      if (second === undefined) wholeRecords.add(head);
      else if (typeof second === 'string') touched[head].add(second);
      else throw new PatchValidationError('Invalid patch path.');
    } else if (head === 'settings') {
      touchedSettings = true;
    } else if (head === 'viewport') {
      touchedViewport = true;
    } else if (head === 'pages') {
      touchedPages = true;
    } else if (head === 'presentation') {
      touchedPresentation = true;
    } else if (head === 'name' || head === 'updatedAt') {
      scalars.add(head);
    } else {
      throw new PatchValidationError(`Unknown document field "${head}".`);
    }
  }

  let out = doc;
  const replaceTop = <K extends keyof CanvasDocument>(key: K, value: CanvasDocument[K]) => {
    out = { ...out, [key]: value };
  };

  for (const key of Object.keys(RECORD_SCHEMAS) as RecordKey[]) {
    const schema = RECORD_SCHEMAS[key];
    if (wholeRecords.has(key)) {
      // The whole record was replaced — validate every entry in it.
      replaceTop(key, z.record(z.string(), schema).parse(out[key]) as never);
      continue;
    }
    let next: Record<string, unknown> | null = null;
    for (const id of touched[key]) {
      const value = (out[key] as Record<string, unknown>)[id];
      if (value === undefined) continue; // entry removed — nothing to check
      const parsed = schema.parse(value);
      next ??= { ...(out[key] as Record<string, unknown>) };
      next[id] = parsed;
    }
    if (next) replaceTop(key, next as never);
  }

  if (touchedSettings) replaceTop('settings', boardSettingsSchema.parse(out.settings));
  if (touchedViewport) replaceTop('viewport', viewportSchema.parse(out.viewport));
  if (touchedPages) replaceTop('pages', z.array(boardPageSchema).parse(out.pages));
  if (touchedPresentation) {
    replaceTop('presentation', presentationSchema.parse(out.presentation));
  }
  for (const key of scalars) {
    const value = out[key];
    if (typeof value !== 'string' || value.length > 1000) {
      throw new PatchValidationError(`"${key}" must be a short string.`);
    }
  }
  return out;
}
