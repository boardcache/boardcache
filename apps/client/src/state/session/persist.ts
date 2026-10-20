/** localStorage-backed per-device preferences: every read is guarded (storage may be missing). */
import type { GallerySortMode, SortDir, ThemePreference } from './types';

export const THEME_KEY = 'boardcache:theme';
export const MINIMAP_KEY = 'boardcache:minimap';
export const LAYERS_KEY = 'boardcache:layers';
export const GALLERY_CAPTIONS_KEY = 'boardcache:galleryCaptions';
export const GALLERY_SCALE_KEY = 'boardcache:galleryScale';
export const GALLERY_SORT_KEY = 'boardcache:gallerySort';
export const GALLERY_SORTDIR_KEY = 'boardcache:gallerySortDir';
export const GALLERY_HIDDEN_KEY = 'boardcache:galleryHidden';

export function loadGallerySort(): GallerySortMode {
  try {
    const v = localStorage.getItem(GALLERY_SORT_KEY);
    if (v === 'manual' || v === 'name' || v === 'date' || v === 'type' || v === 'weight') return v;
  } catch {
    /* storage unavailable */
  }
  return 'manual';
}
export function loadGalleryDir(): SortDir {
  try {
    if (localStorage.getItem(GALLERY_SORTDIR_KEY) === 'desc') return 'desc';
  } catch {
    /* storage unavailable */
  }
  return 'asc';
}
export function loadHiddenTypes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(GALLERY_HIDDEN_KEY) ?? '[]') as unknown;
    if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string');
  } catch {
    /* storage unavailable / corrupt */
  }
  return [];
}

/** Default + bounds for the gallery thumbnail cell size (px). */
export const GALLERY_SCALE = { default: 220, min: 120, max: 460 };

export function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

export function loadNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n) && n >= min && n <= max) return n;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

export function saveItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function loadThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}
