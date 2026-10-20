import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import researchSkill from './skills/board-research.md';

/**
 * The MCP server itself, shared by the stdio launcher (which reaches the app
 * over its loopback endpoint) and the app's own HTTP transport (which calls
 * the renderer directly). It knows nothing about boards: a backend lists the
 * catalog and runs a call, and the schema lives where the board does.
 */

export interface CatalogTool {
  name: string;
  description: string;
  access: 'read' | 'write' | 'external';
  inputSchema: Record<string, unknown>;
}

export interface McpBackend {
  listTools(): Promise<CatalogTool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

/** Tools whose effect a client should confirm before calling. */
const DESTRUCTIVE = new Set([
  'delete_items',
  'delete_page',
  'delete_board',
  'remove_connection',
  'remove_comment',
  'undo',
]);

/** The research skill, shipped with the server as a resource and a prompt so
 *  any client can read the method before building a board. The same file is
 *  the repo's Claude Code skill (.claude/skills/board-research). */
const SKILL_URI = 'boardcache://skills/board-research';
const SKILL_BODY = researchSkill.replace(/^---[\s\S]*?---\n/, '');

export function buildMcpServer(backend: McpBackend): Server {
  const server = new Server(
    { name: 'boardcache', version: '0.1.0' },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      instructions:
        'boardCache board tools. Before researching or building a board, read the resource ' +
        SKILL_URI +
        ' (or use the research-board prompt): it sets the sourcing, verification, rights and layout rules a good board follows. Call get_board_context before editing an existing board: it returns the canvas rules the in-app assistant works from plus the live board summary and selection.',
    },
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: SKILL_URI,
        name: 'Research a subject and build a board',
        description:
          'The method: sourcing hierarchy, where to look, verification and rights rules, which board structures to use, how to make a board its own, and the review checklist.',
        mimeType: 'text/markdown',
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== SKILL_URI) throw new Error(`Unknown resource ${req.params.uri}`);
    return { contents: [{ uri: SKILL_URI, mimeType: 'text/markdown', text: SKILL_BODY }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'research-board',
        description:
          'Research a subject thoroughly and build a boardCache board from it, following the board-research skill.',
        arguments: [
          {
            name: 'request',
            description: 'What the board should be about, and for whom',
            required: true,
          },
        ],
      },
    ],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== 'research-board') throw new Error(`Unknown prompt ${req.params.name}`);
    const request = String(req.params.arguments?.request ?? '').trim();
    return {
      description: 'Research and build a board',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              SKILL_BODY +
              '\n\n---\n\nThe request: ' +
              (request || '(ask the person what the board should be about)') +
              '\n\nFollow the four passes. Use the boardCache tools for the build and say what you could not verify.',
          },
        },
      ],
    };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let tools: CatalogTool[] = [];
    try {
      tools = await backend.listTools();
    } catch {
      /* the app is not running: an empty list, and calls say why */
    }
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object', ...t.inputSchema } as {
          type: 'object';
          [k: string]: unknown;
        },
        annotations: {
          readOnlyHint: t.access === 'read',
          destructiveHint: DESTRUCTIVE.has(t.name),
          openWorldHint: t.access === 'external',
        },
      })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await backend.callTool(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      };
    }
  });
  return server;
}
