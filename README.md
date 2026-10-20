# boardCache

A local-first canvas for moodboards and research. Drop in images, video, audio,
PDFs, links, notes, colours and fonts; arrange them freely; group, connect and
present them. Your boards live on your device and work offline.

This repository holds the **app** — the web client and the desktop app for
macOS, Windows and Linux. It is the code that runs on your machine, published
so that what it does with your data can be read and verified.

## What is here

| Path                       | What it is                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `apps/client`              | The app: React + TypeScript, built with Vite. Runs in any modern browser.  |
| `apps/desktop`             | The Electron shell that wraps the client as a desktop app.                 |
| `packages/schema`          | The board document format, its validation and its migrations.              |
| `packages/e2ee`            | The end-to-end encryption used for sync: key derivation and envelopes.     |
| `packages/text`            | The simple markdown used for community text, rendered the same everywhere. |
| `scripts/build-desktop.sh` | One command to build desktop installers.                                   |
| `Dockerfile`               | The web app as a container (the built client behind a tiny static server). |

## Run it in Docker

The same app, served from a container instead of Electron:

```sh
docker compose up -d        # → http://localhost:8080
```

Plain HTTP on port 8080; put the reverse proxy you already run on the host in
front of it for TLS. Boards live in the browser that opens it; sync, team
boards, AI and the community use the official boardCache server, as the
desktop app does. There is no server in the image and nothing to configure.

## What works without an account

Everything local: the canvas, every item type, the lightbox and gallery,
presentation mode, import and export (`.boardcache` files, images, PDF), and
the offline viewer. No sign-in, no network.

Sync between devices, team boards, the community and the AI features run on
the boardCache service and need an account. That service is not part of this
repository. Synced boards are end-to-end encrypted on your device before they
leave it — `packages/e2ee` is the code that does it, and the server only ever
stores ciphertext.

## Run it

Requires Node 20 or newer and pnpm 9 (`corepack enable`).

```sh
pnpm install
pnpm dev            # the app at http://localhost:5173
```

```sh
pnpm build          # production build in apps/client/dist
pnpm check          # format, typecheck and lint
```

## Build the desktop app

```sh
./scripts/build-desktop.sh              # for the platform you are on
./scripts/build-desktop.sh mac win linux
```

Installers land in `apps/desktop/release/`. macOS builds are signed with the
Developer ID certificate in your keychain and notarized when `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set; without them the
script builds an unsigned-for-distribution app and says so. See
`apps/desktop/README.md`.

## Which server the app talks to

`apps/client/public/config.json` configures a build:

```json
{
  "syncServer": "https://api.boardcache.com",
  "community": false
}
```

- `syncServer` — where sync and the other account features go. Leave it out
  for a fully local app with the sync controls hidden.
- `community` — set to `false` to turn the Community section off: no link, no
  screens, and no requests to the community server. It is on by default.

The desktop app takes the same two settings from the environment at launch:
`BOARDCACHE_SYNC_SERVER=<url>` and `BOARDCACHE_COMMUNITY=0`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This repository is a published mirror:
changes are reviewed here and land through the next release snapshot.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The
boardCache name and logo are trademarks and are not covered by the license;
a fork needs its own name and logo.
