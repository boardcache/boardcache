import { useSessionStore } from '../../state/sessionStore';

/**
 * Run an export while showing a blocking "Generating" overlay. The overlay is
 * given a frame to paint before the (often heavy, synchronous) work begins, and
 * is always cleared when done — even if the export throws.
 */
export async function withExportStatus<T>(label: string, run: () => Promise<T>): Promise<T> {
  const { setExportBusy } = useSessionStore.getState();
  setExportBusy(label);
  // Let the overlay paint before blocking the main thread.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  try {
    return await run();
  } catch (err) {
    console.error('boardCache: export failed', err);
    window.alert('The export failed. Please try again.');
    throw err;
  } finally {
    setExportBusy(null);
  }
}
