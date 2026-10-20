/** Resolves once the router has applied the initial route. Work that opens a
 *  board at boot (a file handed over by the desktop shell) waits for this, or
 *  the initial route lands on top of it. Import-free on purpose: platform.ts
 *  is in the offline-viewer bundle, where reaching the router would split it. */
let markReady: () => void = () => undefined;

export const routerReady: Promise<void> = new Promise((resolve) => {
  markReady = resolve;
});

export function markRouterReady(): void {
  markReady();
}
