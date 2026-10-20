/**
 * The middle mouse button is pan-only. On Linux/X11 a middle click also fires
 * the OS "primary selection" paste, which the window paste handler would
 * otherwise turn into a canvas item. We can't tell from a `paste` event that it
 * came from the middle button, so we timestamp middle-button activity (press +
 * release — the paste fires on release) and have the paste handler ignore
 * anything that lands within a short window of it.
 */
let lastMiddleAt = 0;

export function noteMiddleButton(): void {
  lastMiddleAt = Date.now();
}

/** True if the middle button was pressed/released very recently. */
export function middlePasteSuppressed(withinMs = 800): boolean {
  return Date.now() - lastMiddleAt < withinMs;
}
