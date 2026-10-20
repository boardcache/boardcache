/**
 * The library's view, a per-device preference shared by the view switcher
 * above the boards and the Settings → General control. Either writes it;
 * the library listens for the change so a choice made in Settings applies
 * behind the dialog at once.
 */
export type LibraryView = 'compact' | 'cards' | 'list';

export const LIBRARY_VIEWS: readonly { value: LibraryView; label: string }[] = [
  { value: 'compact', label: 'Small cards' },
  { value: 'cards', label: 'Cards' },
  { value: 'list', label: 'List' },
];

const KEY = 'boardcache:libraryView';
const EVENT = 'boardcache:library-view';

export function loadLibraryView(): LibraryView {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'cards' || stored === 'list' ? stored : 'compact';
  } catch {
    return 'compact';
  }
}

export function saveLibraryView(view: LibraryView): void {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    /* storage unavailable: the choice lasts for this session */
  }
  window.dispatchEvent(new CustomEvent<LibraryView>(EVENT, { detail: view }));
}

/** Subscribe to changes made elsewhere (Settings); returns the unsubscribe. */
export function onLibraryViewChange(fn: (view: LibraryView) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<LibraryView>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
