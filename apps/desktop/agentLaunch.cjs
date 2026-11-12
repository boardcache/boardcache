// "Run Claude Code": the shell opens the user's own terminal with Claude
// Code already connected to this app. No terminal lives inside the app; a
// small run script (written to userData by main.js) does the work in the
// user's shell, so PATH, profile and keychain are the user's own:
//
//   cd <the open board's folder, the board folder, or home>
//   claude --mcp-config <agent-mcp.json>      # this app, by URL and token
//
// The pure parts live here so they can be tested without Electron: the
// script text per platform and the terminal command line per platform.
const fs = require('node:fs');
const path = require('node:path');

const INSTALL_HINT = 'Install it from https://claude.com/claude-code and try again.';

/** A string as one POSIX shell word. */
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The run script for a platform: its file name (the extension matters on
 * macOS, where Terminal opens `.command` files, and on Windows) and text.
 * The POSIX script re-enters the user's shell as an interactive login shell
 * so `claude` installed by a profile line (npm prefix, a version manager,
 * Homebrew on a Mac) is found, and explains itself when it is not.
 */
function launchScript({ platform, cwd, configPath }) {
  if (platform === 'win32') {
    return {
      name: 'run-claude-code.cmd',
      text: [
        '@echo off',
        `cd /d "${cwd}"`,
        'where claude >nul 2>nul',
        'if errorlevel 1 (',
        '  echo Claude Code is not installed, or not on PATH.',
        `  echo ${INSTALL_HINT}`,
        '  pause',
        '  exit /b 1',
        ')',
        `claude --mcp-config "${configPath}"`,
        '',
      ].join('\r\n'),
    };
  }
  const body = [
    'cd "$1" || exit 1',
    'if ! command -v claude >/dev/null 2>&1; then',
    '  echo "Claude Code is not installed, or not on this shell PATH."',
    `  echo ${sq(INSTALL_HINT)}`,
    '  echo',
    '  printf "Press Enter to close. "',
    '  read -r _',
    '  exit 1',
    'fi',
    'exec claude --mcp-config "$2"',
  ].join('\n');
  return {
    name: platform === 'darwin' ? 'run-claude-code.command' : 'run-claude-code.sh',
    text: `#!/bin/sh\nexec "\${SHELL:-/bin/sh}" -lic ${sq(body)} sh ${sq(cwd)} ${sq(configPath)}\n`,
  };
}

/** Terminal programs on Linux and how each takes a command to run. */
const LINUX_TERMINALS = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['ptyxis', ['--']],
  ['konsole', ['-e']],
  ['cosmic-term', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['mate-terminal', ['-x']],
  ['tilix', ['-e']],
  ['terminator', ['-x']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['wezterm', ['start', '--']],
  ['foot', []],
  ['xterm', ['-e']],
];

/** Whether a program name resolves on the given PATH to an executable. */
function findOnPath(name, env = process.env) {
  if (!name) return null;
  if (name.includes('/')) return fs.existsSync(name) ? name : null;
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* not here */
    }
  }
  return null;
}

/**
 * The command line that opens a terminal running the script, or null when
 * no terminal is known. `exists` answers whether a program is on PATH (the
 * real lookup, or a stub in tests). On Linux the TERMINAL variable wins,
 * then the known programs in order.
 */
function terminalCommand({
  platform,
  env = process.env,
  script,
  exists = (n) => findOnPath(n, env),
}) {
  if (platform === 'darwin') return { cmd: 'open', args: [script], name: 'Terminal' };
  if (platform === 'win32') {
    return {
      cmd: 'cmd.exe',
      args: ['/c', 'start', '""', 'cmd.exe', '/k', `"${script}"`],
      name: 'Command Prompt',
      verbatim: true,
    };
  }
  const preferred = env.TERMINAL ? [[env.TERMINAL, null]] : [];
  for (const [name, flags] of [...preferred, ...LINUX_TERMINALS]) {
    const found = exists(name);
    if (!found) continue;
    const base = path.basename(found);
    const known = LINUX_TERMINALS.find(([n]) => n === base);
    const args = flags ?? known?.[1] ?? ['-e'];
    return { cmd: found, args: [...args, script], name: base };
  }
  return null;
}

module.exports = { launchScript, terminalCommand, findOnPath, LINUX_TERMINALS };
