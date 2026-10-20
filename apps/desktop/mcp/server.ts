import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer, type CatalogTool } from './core';

/**
 * boardcache-mcp: the stdio MCP server agents launch (Claude Code, and any
 * client that spawns stdio servers). It holds no board logic: every tool
 * call goes to the running desktop app's loopback endpoint, whose port and
 * token are in agent.json under the app's data folder. The app must be
 * running; without it the tool list is empty and calls say why.
 *
 *   claude mcp add boardcache -- node /path/to/boardcache-mcp.cjs
 *   node boardcache-mcp.cjs --config /custom/path/agent.json
 *
 * Clients that connect by URL instead use the app's HTTP transport at
 * http://127.0.0.1:<port>/mcp with the same bearer token (see Settings →
 * General → Agents).
 */

interface AgentConfig {
  port: number;
  token: string;
}

function defaultConfigPath(): string {
  const home = os.homedir();
  const name = 'boardCache';
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', name, 'agent.json');
  if (process.platform === 'win32')
    return path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      name,
      'agent.json',
    );
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), name, 'agent.json');
}

const configPath = (() => {
  const i = process.argv.indexOf('--config');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]!) : defaultConfigPath();
})();

function readConfig(): AgentConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AgentConfig>;
    if (typeof raw.port === 'number' && typeof raw.token === 'string') {
      return { port: raw.port, token: raw.token };
    }
  } catch {
    /* app not running, or never ran */
  }
  return null;
}

const notRunning = `boardCache is not running (no ${configPath}). Start the desktop app, then try again.`;

async function appFetch(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const cfg = readConfig();
  if (!cfg) throw new Error(notRunning);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${cfg.port}${pathname}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${cfg.token}` },
    });
  } catch {
    throw new Error(notRunning);
  }
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `boardCache answered ${res.status}`);
  if (body.ok === false) throw new Error(body.error ?? 'boardCache refused the request');
  return body.result;
}

const server = buildMcpServer({
  listTools: async () => ((await appFetch('/tools')) as { tools: CatalogTool[] }).tools,
  callTool: (name, args) =>
    appFetch('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
    }),
});

void server.connect(new StdioServerTransport());
