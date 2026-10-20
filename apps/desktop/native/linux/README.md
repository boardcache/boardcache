# Linux thumbnailer

GNOME Files, KDE Dolphin and friends read `/usr/share/thumbnailers/*.thumbnailer`
and run the named command for matching MIME types. Ours shells out to
`unzip -p`, which reads the stored entry directly.

Ship in the .deb by adding to `apps/desktop/electron-builder.json`:

```json
"deb": {
  "fpm": [
    "--deb-no-default-config-files",
    "native/linux/boardcache.thumbnailer=/usr/share/thumbnailers/boardcache.thumbnailer",
    "native/linux/boardcache-thumbnailer=/usr/bin/boardcache-thumbnailer"
  ],
  "depends": ["unzip"]
}
```

The MIME type `application/vnd.boardcache+zip` is registered by the
`.desktop` file electron-builder generates from `fileAssociations`. Users on
AppImage can copy the two files by hand; AppImages can't install thumbnailers.
