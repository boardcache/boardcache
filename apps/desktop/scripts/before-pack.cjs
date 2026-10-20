const fs = require('node:fs');
const path = require('node:path');

/**
 * electron-builder beforePack hook: refuse to package an app with no client
 * inside. `../client/dist` rides along as extraResources; when it is absent
 * the build used to succeed and the installed app opened to a white window.
 */
module.exports = async function beforePack() {
  const index = path.join(__dirname, '..', '..', 'client', 'dist', 'index.html');
  if (!fs.existsSync(index)) {
    throw new Error(
      `The client bundle is missing (${index}).\n` +
        'Build it first:  pnpm --filter @boardcache/client build\n' +
        'or use:          pnpm run dist   (builds the client, then packages)',
    );
  }
};
