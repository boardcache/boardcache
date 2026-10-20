import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildMcpServer, type McpBackend } from './core';

/**
 * MCP over Streamable HTTP, mounted by the app's main process at /mcp on the
 * same loopback endpoint as /tools and /call. For clients that connect by
 * URL rather than spawning a process (an agent runtime, a hosted assistant
 * with a local connector). One MCP session per client; the main process
 * checks the bearer token before anything reaches here, and a regenerated
 * token ends every session.
 */

export interface McpHttp {
  handle(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void>;
  /** End every session (the token changed, or the app is quitting). */
  closeAll(): Promise<void>;
}

export function createMcpHttp(backend: McpBackend): McpHttp {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  return {
    async handle(req, res, body) {
      const sessionId = req.headers['mcp-session-id'];
      const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.handleRequest(req, res, body);
        return;
      }
      if (req.method === 'POST' && isInitializeRequest(body)) {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id: string) => {
            sessions.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await buildMcpServer(backend).connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'No MCP session: send an initialize request first.' },
          id: null,
        }),
      );
    },
    async closeAll() {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((t) => t.close().catch(() => undefined)));
    },
  };
}
