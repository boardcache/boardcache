#!/usr/bin/env node
// The deployment the packaged apps (desktop, iOS, Android) talk to. build.json
// at the repo root is the shipped default; build.local.json beside it
// (git-ignored) overrides any key for builds against a test server. Prints the
// client's config.json shape, and exports the same for main.js in dev.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function buildConfig() {
  const merged = {
    ...readJson(path.join(root, 'build.json')),
    ...readJson(path.join(root, 'build.local.json')),
  };
  if (typeof merged.syncServer !== 'string' || !/^https?:\/\//.test(merged.syncServer)) {
    throw new Error('build.json: syncServer must be an http(s) URL');
  }
  const out = { syncServer: merged.syncServer.replace(/\/+$/, '') };
  if (merged.community === false) out.community = false;
  // The community lives on the sync server unless build.json names another
  // host; without this a packaged app would fall back to the client's
  // built-in official origin and treat its own account as a stranger's.
  const community = merged.communityServer ?? out.syncServer;
  if (typeof community !== 'string' || !/^https?:\/\//.test(community)) {
    throw new Error('build.json: communityServer must be an http(s) URL');
  }
  out.communityServer = community.replace(/\/+$/, '');
  return out;
}

module.exports = buildConfig;

if (require.main === module) process.stdout.write(JSON.stringify(buildConfig(), null, 2) + '\n');
