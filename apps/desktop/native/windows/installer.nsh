; electron-builder NSIS hooks: register the thumbnail DLL on install and
; drop it on uninstall. Wire up with "nsis": { "include": "native/windows/installer.nsh" }
; and ship the DLL via extraResources to resources\native\BoardcacheThumb.dll.

!macro customInstall
  ExecWait 'regsvr32.exe /s "$INSTDIR\resources\native\BoardcacheThumb.dll"'
!macroend

!macro customUnInstall
  ExecWait 'regsvr32.exe /s /u "$INSTDIR\resources\native\BoardcacheThumb.dll"'
!macroend
