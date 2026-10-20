# Native shell extensions: `.boardcache` thumbnails

Finder and Explorer show a generic document icon for a file type unless an
extension tells them what to draw. Every `.boardcache` file carries its own
preview: `thumbnail.png`, 720×450, written as the **first entry of the zip,
stored (not deflated)** by both the app and the CLI. The pieces here read
that entry and hand it to the OS. None of them needs a zip library, an
inflater, or a network: find the entry, copy the bytes.

| Platform | What                                                          | Where it ships                                                           |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| macOS    | Quick Look Thumbnail Extension (Swift, `QLThumbnailProvider`) | `boardCache.app/Contents/PlugIns/BoardcacheThumbnail.appex`              |
| Windows  | `IThumbnailProvider` COM DLL (C++, WIC for PNG)               | `resources/native/BoardcacheThumb.dll`, registered by the NSIS installer |
| Linux    | GNOME/KDE thumbnailer entry (shell)                           | `/usr/share/thumbnailers/boardcache.thumbnailer` in the .deb             |

## Finding the thumbnail in the zip

Both readers do the same thing, in this order:

1. Read the first local file header at offset 0 (`PK\x03\x04`). If its name is
   `thumbnail.png` and its method is 0 (stored) and its sizes are present
   (general-purpose flag bit 3 clear), the PNG is the bytes right after the
   header. This is the fast path for every file the current writers produce.
2. Otherwise walk the central directory from the end-of-central-directory
   record (`PK\x05\x06` in the last 64 KB), find `thumbnail.png`, follow its
   local-header offset, and read the stored bytes. This covers files written
   by the app's streaming writer (which may use data descriptors) and older
   files where the thumbnail wasn't first.
3. Anything else (deflated entry, no entry, locked board without a preview)
   → no thumbnail; the OS falls back to the document icon.

Both readers refuse files over 2 GB and cap the PNG at 8 MB.

## macOS

`macos/BoardcacheThumbnail/` is a complete extension target: `ThumbnailProvider.swift`,
`BoardcacheZip.swift`, `Info.plist`, `BoardcacheThumbnail.entitlements`.
See `macos/README.md` for the Xcode steps and the electron-builder wiring.
The app's own Info.plist must export the `com.boardcache.board` UTI; that's
already in `electron-builder.json` under `mac.extendInfo`.

## Windows

`windows/` is a CMake project producing `BoardcacheThumb.dll`, plus
`installer.nsh` for electron-builder's NSIS to register/unregister it.
See `windows/README.md`.

## Linux

`linux/boardcache.thumbnailer` plus a two-line script. See `linux/README.md`.

## Trust

These run with the privileges of Finder/Explorer. They never execute
anything from the file, never follow paths inside it, and read at most the
one entry. Keep it that way.
