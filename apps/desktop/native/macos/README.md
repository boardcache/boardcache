# macOS Quick Look thumbnail extension

A `.appex` inside the app bundle. Finder, Spotlight, the Open dialog and
Quick Look (spacebar) all draw the board's own preview instead of the
generic document icon.

## Build (on a Mac with Xcode)

1. Xcode → File → New → Project → macOS → **App** (name it `BoardcacheHost`,
   Swift; it's only a container, never shipped). Set the team to the same
   Developer ID as the Electron app.
2. File → New → Target → macOS → **Quick Look Thumbnail Extension**, product
   name `BoardcacheThumbnail`, bundle id `com.boardcache.app.thumbnail`.
3. Replace the generated files with the ones in `BoardcacheThumbnail/`:
   `ThumbnailProvider.swift`, `BoardcacheZip.swift`, `Info.plist`,
   `BoardcacheThumbnail.entitlements` (set it under Signing & Capabilities →
   the target's entitlements file). Deployment target 12.0 or later.
4. Product → Archive is not needed: build the extension target in Release
   (`xcodebuild -scheme BoardcacheThumbnail -configuration Release
-derivedDataPath build`). The result is
   `build/Build/Products/Release/BoardcacheThumbnail.appex`.
5. Copy it to `apps/desktop/native/macos/build/BoardcacheThumbnail.appex`
   (git-ignored).

## Wire it into the Electron app

In `apps/desktop/electron-builder.json` add:

```json
"extraFiles": [
  { "from": "native/macos/build/BoardcacheThumbnail.appex", "to": "PlugIns/BoardcacheThumbnail.appex" }
]
```

(`to` is relative to `Contents/` for mac targets.) electron-builder signs
everything under `Contents/` with the app's identity; the extension keeps
its own entitlements from the file above because the appex is already
signed by Xcode and electron-builder re-signs it preserving entitlements.
If notarization complains about the appex, add to `mac`:

```json
"entitlementsInherit": "build/entitlements.mac.plist"
```

is already there; the appex needs `com.apple.security.app-sandbox`, which
the file in this folder sets.

The UTI the extension declares support for, `com.boardcache.board`, is
exported by the app's Info.plist (see `mac.extendInfo.UTExportedTypeDeclarations`
in electron-builder.json). Without that export the extension never gets asked.

## Verify

Install the built app in /Applications and launch it once (LaunchServices
registers extensions on launch). Then:

```sh
pluginkit -m -p com.apple.quicklook.thumbnail | grep boardcache   # listed?
qlmanage -t -s 512 -o /tmp ~/Downloads/SpaceX.boardcache            # renders?
```

Finder caches icons aggressively; `killall Finder` after the first install.
System Settings → General → Login Items & Extensions → Quick Look must show
the extension enabled (it is by default for signed apps).
