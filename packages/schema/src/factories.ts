import type { CanvasDocument, Viewport } from './document';
import { SCHEMA_VERSION } from './document';
import type { ItemBase } from './items';

/** Minimal ambient type: this package targets no specific runtime lib. */
declare const crypto: { randomUUID(): string };

/** uuid v4 via the platform; both browsers and Node 20+ provide crypto.randomUUID. */
export function newId(): string {
  return crypto.randomUUID();
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export function createDocument(
  overrides: Partial<Pick<CanvasDocument, 'id' | 'name'>> = {},
): CanvasDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: overrides.id ?? newId(),
    name: overrides.name ?? 'Untitled board',
    createdAt: now,
    updatedAt: now,
    viewport: { ...DEFAULT_VIEWPORT },
    settings: {
      background: 'default',
      backgroundImage: null,
      gridVisible: true,
      gridOpacity: 0.35,
      gridType: 'square',
      galleryOrder: [],
      coverItemId: null,
      isTemplate: false,
    },
    pages: [],
    items: {},
    groups: {},
    connections: {},
    comments: {},
    presentation: { steps: [] },
  };
}

/** Shared defaults for the ItemBase fields; per-type fields supplied by callers. */
export function baseItem(overrides: Partial<ItemBase> & Pick<ItemBase, 'x' | 'y'>): ItemBase {
  return {
    id: newId(),
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    opacity: 1,
    groupId: null,
    ...overrides,
  };
}
