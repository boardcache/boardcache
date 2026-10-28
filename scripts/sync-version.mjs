#!/usr/bin/env node
/**
 * One version number: the root package.json's. The packages that ship with a
 * version of their own (the desktop app, whose installers carry it in their
 * names, and the command line) are set to it here. Run by the desktop build
 * and by `pnpm version:sync`; bump the root and everything follows. A package
 * this tree does not carry (the public snapshot ships no command line) is
 * skipped.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`sync-version: root package.json has no release version (got "${version}")`);
  process.exit(1);
}

for (const name of ['desktop', 'cli']) {
  const file = join(root, 'apps', name, 'package.json');
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (next === text) {
    console.log(`sync-version: apps/${name} already at ${version}`);
    continue;
  }
  writeFileSync(file, next);
  console.log(`sync-version: apps/${name} → ${version}`);
}
