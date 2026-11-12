const test = require('node:test');
const assert = require('node:assert/strict');
const { launchScript, terminalCommand } = require('./agentLaunch.cjs');

test('the POSIX script runs claude in the folder through a login shell, and quotes paths', () => {
  const { name, text } = launchScript({
    platform: 'linux',
    cwd: "/home/someone/Boards/Nick's trip",
    configPath: '/home/someone/.config/boardCache/agent-mcp.json',
  });
  assert.equal(name, 'run-claude-code.sh');
  assert.ok(text.startsWith('#!/bin/sh\n'));
  assert.match(text, /"\$\{SHELL:-\/bin\/sh\}" -lic /);
  assert.ok(text.includes(`'/home/someone/Boards/Nick'\\''s trip'`));
  assert.ok(text.includes('exec claude --mcp-config "$2"'));
  assert.ok(text.includes('command -v claude'));
  assert.equal(
    launchScript({ platform: 'darwin', cwd: '/', configPath: '/c' }).name,
    'run-claude-code.command',
  );
});

test('the Windows script is a .cmd that pauses when claude is missing', () => {
  const { name, text } = launchScript({
    platform: 'win32',
    cwd: 'C:\\Boards',
    configPath: 'C:\\cfg.json',
  });
  assert.equal(name, 'run-claude-code.cmd');
  assert.ok(text.includes('cd /d "C:\\Boards"'));
  assert.ok(text.includes('claude --mcp-config "C:\\cfg.json"'));
  assert.ok(text.includes('pause'));
});

test('macOS opens the .command file; Windows starts a kept-open prompt', () => {
  assert.deepEqual(terminalCommand({ platform: 'darwin', script: '/u/run.command' }), {
    cmd: 'open',
    args: ['/u/run.command'],
    name: 'Terminal',
  });
  const win = terminalCommand({ platform: 'win32', script: 'C:\\u\\run.cmd' });
  assert.equal(win.cmd, 'cmd.exe');
  assert.deepEqual(win.args.slice(0, 2), ['/c', 'start']);
  assert.ok(win.args.includes('/k'));
});

test('Linux takes TERMINAL first, then the known programs with their own flags', () => {
  const exists = (n) => (n === 'gnome-terminal' || n === 'kitty' ? `/usr/bin/${n}` : null);
  assert.deepEqual(terminalCommand({ platform: 'linux', env: {}, script: '/s', exists }), {
    cmd: '/usr/bin/gnome-terminal',
    args: ['--', '/s'],
    name: 'gnome-terminal',
  });
  const viaEnv = terminalCommand({
    platform: 'linux',
    env: { TERMINAL: 'kitty' },
    script: '/s',
    exists,
  });
  assert.deepEqual(viaEnv, { cmd: '/usr/bin/kitty', args: ['/s'], name: 'kitty' });
  // An unknown TERMINAL gets -e, the common convention.
  const unknown = terminalCommand({
    platform: 'linux',
    env: { TERMINAL: '/opt/myterm' },
    script: '/s',
    exists: (n) => (n === '/opt/myterm' ? n : null),
  });
  assert.deepEqual(unknown, { cmd: '/opt/myterm', args: ['-e', '/s'], name: 'myterm' });
  assert.equal(
    terminalCommand({ platform: 'linux', env: {}, script: '/s', exists: () => null }),
    null,
  );
});
