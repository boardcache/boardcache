/** Lightbox target and the gallery view preferences. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';
import type { GallerySortMode, SortDir } from './types';
import {
  loadFlag,
  loadNumber,
  saveItem,
  loadGallerySort,
  loadGalleryDir,
  loadHiddenTypes,
  GALLERY_CAPTIONS_KEY,
  GALLERY_SCALE_KEY,
  GALLERY_SORT_KEY,
  GALLERY_SORTDIR_KEY,
  GALLERY_HIDDEN_KEY,
  GALLERY_SCALE,
} from './persist';

export interface GallerySlice {
  /** Item shown fullscreen in the lightbox; null when closed. */
  lightboxId: string | null;
  setLightbox: (id: string | null) => void;
  /** Item to return to when the lightbox target was opened from a timeline
   *  stage (Back-to-timeline chip; Escape returns before closing). */
  lightboxReturn: string | null;
  setLightboxReturn: (id: string | null) => void;
  /** One-shot: next lightbox open lands on the Comments tab. */
  lightboxCommentsHint: boolean;
  setLightboxCommentsHint: (on: boolean) => void;
  /** While the gallery shows one group, ←/→ cycle only its members. */
  lightboxGroupScope: string | null;
  setLightboxGroupScope: (id: string | null) => void;
  /** Gallery: show item captions (persisted; off by default). */
  galleryCaptions: boolean;
  setGalleryCaptions: (show: boolean) => void;
  /** Gallery: thumbnail cell size in px (persisted). */
  galleryScale: number;
  setGalleryScale: (px: number) => void;
  /** Gallery: sort order — shared by grid and masonry (persisted). */
  gallerySortMode: GallerySortMode;
  setGallerySortMode: (mode: GallerySortMode) => void;
  gallerySortDir: SortDir;
  setGallerySortDir: (dir: SortDir) => void;
  /** Gallery: media types hidden by the filter sidebar (persisted). */
  galleryHiddenTypes: string[];
  toggleGalleryType: (type: string) => void;
  setGalleryHiddenTypes: (types: string[]) => void;
  /** Gallery: tags to include (any-match). Empty = no tag filter. Session-only
   *  since tags are board-specific. */
  galleryTags: string[];
  toggleGalleryTag: (tag: string) => void;
  setGalleryTags: (tags: string[]) => void;
}

export const createGallerySlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  GallerySlice
> = (set) => ({
  lightboxId: null,
  setLightbox: (lightboxId) =>
    set(lightboxId === null ? { lightboxId, lightboxReturn: null } : { lightboxId }),
  lightboxReturn: null,
  setLightboxReturn: (lightboxReturn) => set({ lightboxReturn }),
  lightboxCommentsHint: false,
  setLightboxCommentsHint: (lightboxCommentsHint) => set({ lightboxCommentsHint }),
  lightboxGroupScope: null,
  setLightboxGroupScope: (lightboxGroupScope) => set({ lightboxGroupScope }),
  galleryCaptions: loadFlag(GALLERY_CAPTIONS_KEY, false),
  setGalleryCaptions: (galleryCaptions) => {
    saveItem(GALLERY_CAPTIONS_KEY, galleryCaptions ? '1' : '0');
    set({ galleryCaptions });
  },
  galleryScale: loadNumber(
    GALLERY_SCALE_KEY,
    GALLERY_SCALE.default,
    GALLERY_SCALE.min,
    GALLERY_SCALE.max,
  ),
  setGalleryScale: (galleryScale) => {
    saveItem(GALLERY_SCALE_KEY, String(galleryScale));
    set({ galleryScale });
  },
  gallerySortMode: loadGallerySort(),
  setGallerySortMode: (gallerySortMode) => {
    saveItem(GALLERY_SORT_KEY, gallerySortMode);
    set({ gallerySortMode });
  },
  gallerySortDir: loadGalleryDir(),
  setGallerySortDir: (gallerySortDir) => {
    saveItem(GALLERY_SORTDIR_KEY, gallerySortDir);
    set({ gallerySortDir });
  },
  galleryHiddenTypes: loadHiddenTypes(),
  toggleGalleryType: (type) =>
    set((state) => {
      const hidden = state.galleryHiddenTypes.includes(type)
        ? state.galleryHiddenTypes.filter((t) => t !== type)
        : [...state.galleryHiddenTypes, type];
      saveItem(GALLERY_HIDDEN_KEY, JSON.stringify(hidden));
      return { galleryHiddenTypes: hidden };
    }),
  setGalleryHiddenTypes: (galleryHiddenTypes) => {
    saveItem(GALLERY_HIDDEN_KEY, JSON.stringify(galleryHiddenTypes));
    set({ galleryHiddenTypes });
  },
  galleryTags: [],
  toggleGalleryTag: (tag) =>
    set((state) => ({
      galleryTags: state.galleryTags.includes(tag)
        ? state.galleryTags.filter((t) => t !== tag)
        : [...state.galleryTags, tag],
    })),
  setGalleryTags: (galleryTags) => set({ galleryTags }),
});
