# Windows Explorer thumbnail provider

`BoardcacheThumb.dll` implements `IThumbnailProvider` + `IInitializeWithStream`.
Explorer asks it for a bitmap whenever a `.boardcache` file is shown in a
view with thumbnails (every default view) and in file dialogs.

## Build

Visual Studio Build Tools (MSVC, x64) and CMake:

```powershell
cd apps\desktop\native\windows
cmake -S . -B build -A x64
cmake --build build --config Release
# → build\Release\BoardcacheThumb.dll
```

Copy it to `apps\desktop\native\windows\build\BoardcacheThumb.dll` (the
exact path electron-builder picks up below). The DLL has no dependencies
beyond Windows itself.

## Wire it into the installer

In `apps/desktop/electron-builder.json`:

```json
"extraResources": [
  { "from": "../client/dist", "to": "client-dist" },
  { "from": "native/windows/build/BoardcacheThumb.dll", "to": "native/BoardcacheThumb.dll" }
],
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "include": "native/windows/installer.nsh"
}
```

The NSIS hooks run `regsvr32` on install and uninstall. `DllRegisterServer`
writes to HKLM when the installer is elevated and falls back to HKCU for a
per-user install, so both work.

## Signing

Explorer loads an unsigned in-process DLL, but SmartScreen flags the
installer that carries it, as it does today. When you set up Azure Artifact
Signing for the installer, sign this DLL in the same step
(`signtool sign /fd SHA256 /tr … BoardcacheThumb.dll`).

## Verify

After installing, open a folder of `.boardcache` files in Large icons view.
If you see document icons: Explorer caches thumbnails per file, so clear the
cache (`Disk Cleanup → Thumbnails`) or rename the file; and check
`HKCR\.boardcache\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}` holds
`{B0A7D1C2-5F3E-4C8A-9D21-6E4F2A7B3C01}`. Explorer may need `taskkill /im
explorer.exe /f && start explorer` once after the first registration.

## Debugging

Build Debug, register that DLL (`regsvr32 build\Debug\BoardcacheThumb.dll`),
attach to `explorer.exe` (or to `dllhost.exe` if Explorer runs handlers out
of process), and break in `GetThumbnail`.
