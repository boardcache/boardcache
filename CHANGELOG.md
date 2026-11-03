# Changelog

What changed in boardCache, for people who use it or build it: the app, the
desktop shell, the clipper, the schema and the open packages. Newest first;
dates are when the change landed. Each release's section becomes the notes of
the matching GitHub release.

## 0.2.0 — 2026-11-02

Boards saved by this version (locked boards, and unlocked boards that keep
their media key) do not open in 0.1.x builds. Update every device before
locking or unlocking a synced board.

### Board locks

- A board keeps one media key for life. The first lock makes it; the
  password only wraps it. Removing a lock and setting it again, with the
  same password or another, opens everything the earlier lock sealed, on
  this device, on other devices and on the sync server. Locks made before
  this version carry over when they are removed. (2026-11-02)
- A lock covers exactly the board's own media. Media arriving from sync or
  a team room is stored as it comes, a board file's media belongs to the
  board being imported, and a picture shared with an unlocked board is
  stored plain the moment it is shared. Unlocking a board repairs records an
  earlier version left under its key, and the server copies follow: locking
  a synced board seals its media there, removing the lock opens it.
  (2026-11-02)
- An image that cannot be shown says why: "not downloaded" when the bytes
  never reached the device (Retry fetches again), "locked with <board>"
  when they are here under another board's password (Unlock asks for it,
  and says when the password is right but the media predates the board's
  key), "can't be read" when the stored record is damaged. A device whose
  record will not open takes the server's copy. A synced board's menu has
  Re-upload media. (2026-11-02)

### Library and sync

- An imported board is always a new board, with its own identity, so
  importing a board's own export or restoring a backup beside the
  original never changes the original, here or on other devices.
  (2026-11-02)
- Board names are unique: a board imported, created, duplicated or renamed
  to a name the library already has gets a counter, "Trip (1)", "Trip (2)".
  (2026-11-02)
- Every dialog opens with its first text field focused, on desktop and on
  the phone sheet, and keeps that focus. (2026-11-01)
- A lapsed sign-in is no longer a silent signed-out index: a row names the
  account and offers to sign in again, and Download on a synced board asks
  for the sign-in instead of failing quietly. (2026-10-31)
- Pull to refresh on the index: on a touch screen, drag down from the top
  of a signed-in index to ask the sync server for news. (2026-10-31)
- The library tour works on a phone: the sidebar drawer opens for the steps
  whose controls live in it and the coach-mark card stays on screen.
  (2026-10-30)

### Canvas

- Link buttons take the theme's accent colour by default and follow a theme
  or mode switch; a chosen colour still sticks. (2026-10-30)
- Zoomed-out low-detail previews are reliable: a preview painted before an
  image's bytes arrived is repainted when they do, and View → Rebuild
  Low-Detail Previews redraws them all. (2026-10-30)

## 0.1.1 — 2026-10-29

### Security

- Media on the sync server is named by a keyed hash under an account key,
  never the plain content hash; existing accounts relabel on their next
  sign-in. Shares, encrypted backups and board, folder and device locks
  derive their keys with Argon2id (older records still open). The content
  security policy no longer allows scripts from cdnjs. (2026-10-24)
- Hardening passes over share links and the viewer, outbound fetches, the
  desktop shell's bridge, protocol, permissions and endpoint, and the
  clipper's token handling. (2026-10-20, 2026-10-21)

### Sharing and publishing

- Share links are snapshots served piece by piece: the viewer paints at once
  and fetches media as it comes into view; passwords are checked by the
  server; each link has its own page with a title and card image. Share
  links come with the Personal and Team plans. (2026-10-24)
- The hosted viewer is a code-split module build, about 135 KB of script and
  48 KB of style, with PDF, KaTeX, EPUB and the rest loaded on first use. The
  offline export keeps the single-file viewer. (2026-10-24)
- A published board opens to anyone with its link, no account needed; its
  page carries a canonical address and a card image. (2026-10-24)
- Publications: Unpublish and Edit are buttons; versions can be viewed,
  restored or replaced in place; covers render per theme. (2026-10-24,
  2026-10-25)

### Canvas and items

- Videos remember a pause as well as a position; the control bar wraps in a
  narrow window instead of clipping. (2026-10-27)
- Cases rate each piece of evidence where they score it; evidence strength
  badges are off by default (View → Show Evidence Strength). The case view
  fits a phone. (2026-10-21, 2026-10-25)
- Link buttons and storyboards scale like project cards; the storyboard
  editor is larger and opens from the lightbox. (2026-10-22)
- Audio players scale like the other cards: a corner drag zooms the whole
  player, an edge drag changes only the width or height. Schema v86.
  (2026-10-28)
- Lightbox: a click on the picture hides the chrome as a tap does, and the
  picture takes the whole window. (2026-10-26)
- Project descriptions render as sanitised Markdown. (2026-10-22)
- Settings → Canvas shows the board's cover item and can remove it.
  (2026-10-19)
- Events: calendar events as cards with an editor, reminders, iCalendar in
  and out, and View → Calendar with Month, Week and Day scopes. Assistant
  tools add, edit, import and export them. Schema v85. (2026-10-27)
- Semantic search, CLIP and transcription load their runtime from the app
  itself instead of a CDN, so they work under the enforced content security
  policy. Nothing in the app evals. (2026-10-28, 2026-10-29)

### Styling

- One central style definition: semantic tokens, a controls sheet that owns
  every button, segmented control and text field, dialog sizes in one place,
  and a lint guard against stray colour literals. (2026-10-27)

### Library and onboarding

- A welcome board is seeded once into a new library; its Presentation Mode
  is a tour of the canvas, and View → Welcome board brings it back. A short
  library tour runs once on desktop and replays from View → Library tour.
  (2026-10-25)
- Open a board in a new window: Shift-click a card, or Open in New Window
  from its menu. Ctrl/Cmd-click adds to the selection. (2026-10-26)
- Folders merge entry by entry across devices. Import shows progress; board
  files can be dropped on the index. (2026-10-20)

### Mobile

- One finger pans from anywhere in view mode. Less memory while panning and
  zooming on iPhones and iPads. (2026-10-25)
- The bottom bar clips the board name before the item count; the library
  drawer keeps clear of the status bar and home indicator; iOS 26's scroll
  edge effect no longer draws under the status bar in dark mode.
  (2026-10-25, 2026-10-27)

### Clipper 1.6.0

- Clips go to the desktop app on the same computer for free; clipping
  through the account needs a sync plan. Instagram posts, carousels, videos
  and stories clip reliably. (2026-10-22, 2026-10-23)

### Desktop

- A desktop variant (`appName` in `build.local.json`) installs and runs
  beside the shipped app on every platform; the Mac app asks for local
  network permission itself when the sync server is on a private address.
  (2026-10-27)
- Electron 44 and electron-builder 26; the Linux app shows its own icon.
  (2026-10-21, 2026-10-22)
- Interface size: Settings → Appearance scales text and controls together
  (80% to 150%); View → Larger/Smaller Interface. (2026-10-26)
- The Linux app keeps its sync session across restarts on desktops without
  a keyring Chromium recognises. (2026-10-28)

### Account

- Delete your own account from the app. (2026-10-21)
- The old product name is gone from the code and docs; `.refboard` files
  still import and `REFBOARD_*` variables still work. (2026-10-26)
- Stock media: Openverse is unticked by default. (2026-10-22)
- The service worker no longer precaches the share page, which kept it from
  updating in production. (2026-10-27)

## 0.1.0 — 2026-10-20

First public snapshot: the client, the desktop shell and the schema, e2ee
and text packages, under Apache-2.0.
