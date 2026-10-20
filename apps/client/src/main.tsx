import { StrictMode } from 'react';
import { flushUsageTally } from './lib/usageTally';
import { initAppUpdate } from './lib/appUpdate';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadDeployConfig } from './lib/sync/apiBase';
import { consumeInviteLink } from './lib/inviteLink';
import { initIosShell } from './lib/iosShell';
import { useSessionStore } from './state/sessionStore';
import { initConnectivity, initDesktopFileOpen, initDesktopMenu } from './lib/platform';
import { initAgentBridge } from './lib/agentBridge';
import { initLod } from './lib/canvas/lod';
import { installDeviceErrorLog } from './lib/deviceLog';
import './styles/index.css';

// --- staleness self-heal -------------------------------------------------
// iOS Safari repeatedly stranded devices on old cached builds (service
// worker precache + heuristically-cached HTML) — old bugs "came back" on
// devices only. On boot, compare this bundle's build id with the server's;
// on mismatch, drop every SW registration and cache and reload once.
if (!import.meta.env.DEV) installDeviceErrorLog();
void flushUsageTally();

if (!import.meta.env.DEV && import.meta.env.VITE_BUILD_ID) {
  void (async () => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = (await res.json()) as { build?: string };
      const mine = String(import.meta.env.VITE_BUILD_ID);
      if (!build || build === mine) return;
      if (sessionStorage.getItem('boardcache:healedTo') === build) return; // no loops
      sessionStorage.setItem('boardcache:healedTo', build);
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      if (window.caches) {
        for (const key of await caches.keys()) await caches.delete(key);
      }
      location.reload();
    } catch {
      /* offline is fine — the SW keeps serving the current build */
    }
  })();
}

initAppUpdate();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

// The deployment config (sync server location) must be known before anything
// fires an API call, so it gates the first render.
void loadDeployConfig().then(() => {
  initConnectivity();
  initDesktopFileOpen();
  initDesktopMenu();
  initAgentBridge();
  initLod();
  initIosShell();
  // An invite link lands on the sign-up form with its code already filled.
  if (consumeInviteLink()) useSessionStore.getState().setSyncDialogOpen(true, 'register');
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
