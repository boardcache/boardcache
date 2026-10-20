# boardCache Desktop (Electron shell)

Wraps the built client (`apps/client/dist`) in Electron. The bundle is served
from a custom `app://boardcache` scheme with SPA fallback (`file://` would
break the history-API router). The shell owns `/config.json` and points the
client at the sync server — override with `BOARDCACHE_SYNC_SERVER=` at launch.
`BOARDCACHE_COMMUNITY=0` hides the Community section.

Everything local (canvas, boards, assets, import/export) works fully offline.
The shell adds native implementations for the three things a browser cannot
do across origins: RSS fetching, font CSS for PDF embedding, and webpage
screenshots. AI has no native path; it runs on the boardCache service.

## Run (dev)

```sh
pnpm --filter @boardcache/client build
cd apps/desktop
pnpm start
```

Headless smoke (CI/servers): `xvfb-run -a pnpm run smoke` — boots the window
offscreen, checks the native bridge, the menu and notifications, writes a
screenshot, and exits non-zero on failure. Pass a `.boardcache` path to also
assert that the file opens.

## Package

From the repository root:

```sh
./scripts/build-desktop.sh              # the platform you are on
./scripts/build-desktop.sh mac win linux
./scripts/build-desktop.sh mac --no-notarize
```

Installers land in `apps/desktop/release/` as
`boardCache-<version>-<os>-<arch>.<ext>`: a macOS dmg (arm64 + x64), a Windows
NSIS installer, and a Linux AppImage + deb.

- The client is built first; a `beforePack` hook fails the build if the bundle
  is missing rather than shipping a blank app.
- Icons live in `build/` (`icon.png`; optional `icon.icns` / `icon.ico`).
- `.boardcache` files are associated with the app on all three platforms.
- macOS: signed with the "Developer ID Application" certificate in the login
  keychain and notarized when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
  `APPLE_TEAM_ID` are set. Hardened runtime with `build/entitlements.mac.plist`.
- Windows and Linux builds are unsigned.

## Notes

- `main.js` is CommonJS on purpose: Electron's ESM loader trips over pnpm's
  symlinked `node_modules`.
- If `require('electron')` yields a path string, `ELECTRON_RUN_AS_NODE` is set
  in your environment — run with `env -u ELECTRON_RUN_AS_NODE`.
- A blank window: run the installed binary from a terminal (load failures and
  renderer errors print there) or set `BOARDCACHE_DEVTOOLS=1`.
