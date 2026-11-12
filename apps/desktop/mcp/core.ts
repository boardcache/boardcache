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
import moodboardSkill from './skills/moodboard-brief.md';
import storyboardSkill from './skills/storyboard-script.md';
import timelineSkill from './skills/timeline-article.md';
import caseSkill from './skills/evidence-case.md';
import projectSkill from './skills/project-plan.md';

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

/** A template with instructions, offered as a prompt of its own. */
export interface Recipe {
  id: string;
  name: string;
  instructions: string;
}

export interface McpBackend {
  listTools(): Promise<CatalogTool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  /** The person's recipes (templates with instructions); absent = none. */
  listRecipes?(): Promise<Recipe[]>;
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

/**
 * The skills, shipped with the server as resources and prompts so any
 * client can read a method before building a board. Each file is also a
 * Claude Code skill in the repository (.claude/skills/<name>): one file,
 * two readers.
 */
interface Skill {
  name: string;
  title: string;
  description: string;
  body: string;
  /** What the prompt's one argument asks for. */
  ask: string;
  /** The closing line of the prompt, after the request. */
  go: string;
}

const strip = (md: string) => md.replace(/^---[\s\S]*?---\n/, '');
const SKILLS: Skill[] = [
  {
    name: 'board-research',
    title: 'Research a subject and build a board',
    description:
      'The method: sourcing hierarchy, where to look, verification and rights rules, which board structures to use, how to make a board its own, and the review checklist.',
    body: strip(researchSkill),
    ask: 'What the board should be about, and for whom',
    go: 'Follow the four passes. Use the boardCache tools for the build and say what you could not verify.',
  },
  {
    name: 'moodboard-brief',
    title: 'Build a moodboard from a brief',
    description:
      'Read a creative brief for its mood, materials and audience, then assemble real pictures, a palette, type and mood words on one board.',
    body: strip(moodboardSkill),
    ask: 'The brief, or where to find it, and who the board is for',
    go: 'Read, gather, compose. Real pictures only, credited. Finish with check_board and render_board.',
  },
  {
    name: 'storyboard-script',
    title: 'Storyboard a script',
    description:
      'Break a script or scene into shots, give each a frame and the notes a crew needs, and lay them on a storyboard in order.',
    body: strip(storyboardSkill),
    ask: 'The script or scene text, or where to find it',
    go: 'Break it down, build the storyboard, set the presentation order. Say how many shots and which is hardest to shoot.',
  },
  {
    name: 'timeline-article',
    title: 'A timeline from an article',
    description:
      'Read a page, report or chapter, pull every dated event, and build a timeline with sourced cards on its points.',
    body: strip(timelineSkill),
    ask: 'The URL or text, and the span of time that matters',
    go: 'Read the source first, work from its text, source every card. Say which dates the sources disagree on.',
  },
  {
    name: 'evidence-case',
    title: 'Build a case from sources',
    description:
      'A question, its competing conclusions, every piece of evidence as a sourced, weighted card linked to the conclusions it bears on.',
    body: strip(caseSkill),
    ask: 'The question, and the sources or where to look',
    go: 'Frame, gather, build the case, review. Rate every card. Say which conclusion leads and what would change it.',
  },
  {
    name: 'project-plan',
    title: 'Plan a project from a document',
    description:
      'Read a brief, proposal or notes and lay out the project: milestones, dated tasks, owners, and the reference material linked to the work.',
    body: strip(projectSkill),
    ask: 'The document, or where to find it, and the deadline if it is not in there',
    go: 'Read, build the project, arrange and check. List the open questions the document left.',
  },
];
const skillUri = (name: string) => `boardcache://skills/${name}`;
const RECIPE_PREFIX = 'recipe-';

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
        skillUri('board-research') +
        " (or use the research-board prompt): it sets the sourcing, verification, rights and layout rules a good board follows. Other skills (moodboard-brief, storyboard-script, timeline-article, evidence-case, project-plan) are resources and prompts too, and the person's own recipes (templates with instructions) are prompts named recipe-<id>; list_recipes and start_recipe reach them as tools. Call get_board_context before editing an existing board: it returns the canvas rules the in-app assistant works from plus the live board summary and selection. For many steps at once use apply_plan (checked first, one undo step, taken back whole on failure). After building or arranging, check_board lists what to fix and render_board shows the result as a picture; search_library finds material on the other boards the person has opened to agents.",
    },
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: SKILLS.map((sk) => ({
      uri: skillUri(sk.name),
      name: sk.title,
      description: sk.description,
      mimeType: 'text/markdown',
    })),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const sk = SKILLS.find((x) => skillUri(x.name) === req.params.uri);
    if (!sk) throw new Error(`Unknown resource ${req.params.uri}`);
    return { contents: [{ uri: skillUri(sk.name), mimeType: 'text/markdown', text: sk.body }] };
  });
  const recipes = async (): Promise<Recipe[]> => {
    try {
      return (await backend.listRecipes?.()) ?? [];
    } catch {
      return [];
    }
  };
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'research-board',
        description:
          'Research a subject thoroughly and build a boardCache board from it, following the board-research skill.',
        arguments: [{ name: 'request', description: SKILLS[0]!.ask, required: true }],
      },
      ...SKILLS.slice(1).map((sk) => ({
        name: sk.name,
        description: `${sk.title}: ${sk.description}`,
        arguments: [{ name: 'request', description: sk.ask, required: true }],
      })),
      ...(await recipes()).map((r) => ({
        name: RECIPE_PREFIX + r.id,
        description: `Recipe "${r.name}": start a board from that template and follow its instructions.`,
        arguments: [
          { name: 'request', description: 'What this run is about (the input)', required: false },
        ],
      })),
    ],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const request = String(req.params.arguments?.request ?? '').trim();
    const name = req.params.name;
    if (name.startsWith(RECIPE_PREFIX)) {
      const id = name.slice(RECIPE_PREFIX.length);
      const r = (await recipes()).find((x) => x.id === id);
      if (!r) throw new Error(`Unknown prompt ${name}`);
      return {
        description: `Recipe: ${r.name}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Run the boardCache recipe "${r.name}". Call start_recipe with id "${r.id}"` +
                (request ? ` and input ${JSON.stringify(request)}` : '') +
                ': it makes a fresh board from the template, opens it, and returns the instructions below, which came with the template. Follow them on the new board, for the person.\n\n---\n\n' +
                r.instructions +
                '\n\n---\n\nThe input: ' +
                (request || '(ask the person what this run is about)'),
            },
          },
        ],
      };
    }
    const sk = name === 'research-board' ? SKILLS[0]! : SKILLS.find((x) => x.name === name);
    if (!sk) throw new Error(`Unknown prompt ${name}`);
    return {
      description: sk.title,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              sk.body +
              '\n\n---\n\nThe request: ' +
              (request || '(ask the person what the board should be about)') +
              '\n\n' +
              sk.go,
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
      // A tool that hands back a picture (render_board) carries it as
      // `image`; it goes to the client as an image block, the rest as text.
      const { image, ...rest } = (
        result && typeof result === 'object' ? result : { value: result }
      ) as { image?: { mimeType?: string; base64?: string } } & Record<string, unknown>;
      if (image && typeof image.base64 === 'string') {
        return {
          content: [
            { type: 'image', data: image.base64, mimeType: image.mimeType ?? 'image/png' },
            { type: 'text', text: JSON.stringify(rest, null, 2) },
          ],
        };
      }
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
