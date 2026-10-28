#!/usr/bin/env node
// The electron-builder configuration for a desktop variant (an `appName` in
// build.local.json): the shipped apps/desktop/electron-builder.json with
// every name that must differ from the shipped app's, so the variant
// installs and runs beside it on every platform. scripts/build-desktop.sh
// writes the result to apps/desktop/electron-builder.variant.json
// (git-ignored) and builds from that; prints nothing without a variant.
const fs = require('node:fs');
const path = require('node:path');
const buildConfig = require('./build-config.cjs');

const root = path.join(__dirname, '..');

function variantConfig() {
  const cfg = buildConfig();
  if (!cfg.appName) return null;
  const base = JSON.parse(
    fs.readFileSync(path.join(root, 'apps/desktop/electron-builder.json'), 'utf8'),
  );
  const name = cfg.appName;
  const slug = buildConfig.slugOf(name);
  const { UTExportedTypeDeclarations: _types, ...extendInfo } = base.mac.extendInfo;
  return {
    ...base,
    productName: name,
    appId: cfg.appId,
    // Linux and Windows: the binary, the install directory (/opt/<slug>,
    // Programs\<slug>) and the update-alternatives link, none of which may
    // hold a space. macOS names the bundle after it, so there it is the
    // readable name: "boardCache Local.app" beside the shipped boardcache.app.
    executableName: slug,
    mac: { ...base.mac, executableName: name, extendInfo },
    // Electron takes the window's app id (WM_CLASS) from desktopName in the
    // packaged package.json, and the deb installs the .desktop file under
    // that name; both must leave the shipped boardcache.desktop alone.
    extraMetadata: { productName: name, desktopName: `${slug}.desktop` },
    linux: { ...base.linux, desktop: { entry: { StartupWMClass: slug } } },
    // The shipped app keeps .boardcache files; a variant opens them from
    // inside (File → Open, or a drop on the board).
    fileAssociations: [],
    artifactName: `${name.replace(/\s+/g, '-')}-\${version}-\${os}-\${arch}.\${ext}`,
  };
}

module.exports = variantConfig;

if (require.main === module) {
  const out = variantConfig();
  if (out) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
