import { canvasDocumentSchema, type CanvasDocument } from './document';
import { migrateDocument } from './migrations';

/** Serialize a document for storage/export. Stable, human-diffable output. */
export function serializeDocument(doc: CanvasDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse a serialized document: JSON parse → migration chain → Zod validation.
 * This is the only sanctioned way to turn untrusted bytes into a
 * CanvasDocument (file import, IndexedDB load, server payloads).
 */
export function parseDocument(json: string): CanvasDocument {
  const raw: unknown = JSON.parse(json);
  return validateDocument(migrateDocument(raw));
}

/** Validate an already-parsed (and migrated) value into a CanvasDocument. */
export function validateDocument(value: unknown): CanvasDocument {
  return canvasDocumentSchema.parse(value);
}
