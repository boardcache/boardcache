import { z } from 'zod';
import type { ZodType } from 'zod';
import { desktopAgent, desktopFiles, type AgentRequest } from './platform';
import {
  activeBoardTools,
  runBoardTool,
  runToolTurn,
  setLibraryToolSource,
  type BoardTool,
} from './tools/registry';
import { boardBriefing } from './tools/briefing';
import {
  createBoard,
  deleteBoard,
  duplicateBoard,
  listBoards,
  openBoard,
  renameBoardRecord,
  revokeSummaries,
  saveOpenBoardAsTemplate,
} from './board/boardLibrary';
import {
  createFolder,
  folderPath,
  loadLibraryMeta,
  moveBoards,
  saveLibraryMeta,
  setBoardTags,
} from './board/libraryMeta';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';

/**
 * The desktop app's agent bridge: answers the main process's loopback
 * endpoint (which the stdio MCP launcher talks to) from inside the renderer,
 * where boards are decrypted and the tool registry enforces the schema.
 * Outside agents see one catalog: the board tools, plus a few library tools
 * for finding, opening and creating boards. Writes run as one undo step
 * each, labelled for the history panel.
 */

interface LibraryTool {
  name: string;
  description: string;
  access: 'read' | 'write';
  parameters: ZodType;
  /** Reaches the disk through the shell: only offered where that bridge exists. */
  desktopOnly?: boolean;
  execute: (args: never) => Promise<unknown>;
}

const noBoard = () =>
  'No board is open. Call list_boards, then open_board (or create_board) first.';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

function toUint8(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** Agent calls being served right now; the shell's file bridge opens only for one of them. */
const inFlight = new Set<string>();
function grant(): string {
  const id = inFlight.values().next().value;
  if (!id) throw new Error('Local files are reachable only while serving an agent call.');
  return id;
}

/** Read a local file through the shell as a File the import pipeline takes. */
async function readLocalFile(path: string): Promise<File> {
  const files = desktopFiles();
  if (!files) throw new Error('Local files are only reachable in the desktop app.');
  const res = await files.read(path, grant());
  if ('error' in res) throw new Error(`Could not read ${path}: ${res.error}`);
  const ext = res.name.split('.').pop()?.toLowerCase() ?? '';
  const type = MIME_BY_EXT[ext] ?? '';
  return new File([toUint8(res.bytes) as BlobPart], res.name, { type });
}

async function writeLocalFile(path: string, blob: Blob): Promise<{ path: string; bytes: number }> {
  const files = desktopFiles();
  if (!files) throw new Error('Local files are only reachable in the desktop app.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const res = await files.write(path, bytes, grant());
  if ('error' in res) throw new Error(`Could not write ${path}: ${res.error}`);
  return { path: res.path, bytes: bytes.byteLength };
}

const requireOpen = () => {
  const current = currentBoard();
  if (!current) throw new Error(noBoard());
  return current;
};

const LIBRARY_TOOLS: LibraryTool[] = [
  {
    name: 'get_board_context',
    description:
      'The briefing the in-app assistant works from: the canvas facts and working rules, plus the live board summary (what get_board_summary returns) and the current selection in full detail. Call it before acting on an existing board; call again after your own edits to see the live state.',
    access: 'read',
    parameters: z.object({}),
    execute: async () => {
      requireOpen();
      return boardBriefing();
    },
  },
  {
    name: 'list_boards',
    description:
      'List the boards in this library: id, name, when last edited, whether synced and whether password-locked (locked boards cannot be opened by an agent).',
    access: 'read',
    parameters: z.object({}),
    execute: async () => {
      const boards = await listBoards();
      return {
        boards: boards.map((b) => ({
          id: b.id,
          name: b.name,
          updatedAt: b.updatedAt,
          synced: b.synced,
          locked: b.locked,
          ...(b.size != null ? { sizeBytes: b.size } : {}),
        })),
      };
    },
  },
  {
    name: 'open_board',
    description:
      'Open a board by id so the board tools act on it (the app switches to it). Fails for password-locked boards.',
    access: 'write',
    parameters: z.object({ id: z.string() }),
    execute: async (args: { id: string }) => {
      const boards = await listBoards();
      const board = boards.find((b) => b.id === args.id);
      if (!board) throw new Error(`No board with id ${args.id}.`);
      if (board.locked)
        throw new Error(`"${board.name}" is password-locked; unlock it in the app first.`);
      const ok = await openBoard(args.id);
      if (!ok) throw new Error(`Could not open "${board.name}".`);
      return { id: args.id, name: board.name };
    },
  },
  {
    name: 'create_board',
    description: 'Create a new empty board with this name and open it. Returns its id.',
    access: 'write',
    parameters: z.object({ name: z.string().min(1).max(200) }),
    execute: async (args: { name: string }) => {
      const id = await createBoard(args.name);
      return { id, name: args.name };
    },
  },
  {
    name: 'current_board',
    description: 'The board the app has open right now (id, name, item count), or none.',
    access: 'read',
    parameters: z.object({}),
    execute: async () => {
      const current = currentBoard();
      return current ? { open: true, ...current } : { open: false };
    },
  },
  {
    name: 'rename_library_board',
    description: 'Rename a board that is NOT open (for the open board use rename_board).',
    access: 'write',
    parameters: z.object({ id: z.string(), name: z.string().min(1).max(200) }),
    execute: async (args: { id: string; name: string }) => {
      if (currentBoard()?.id === args.id) throw new Error('That board is open: use rename_board.');
      await renameBoardRecord(args.id, args.name);
      return { id: args.id, name: args.name };
    },
  },
  {
    name: 'duplicate_board',
    description: 'Duplicate a board in the library (not opened). Returns the new id.',
    access: 'write',
    parameters: z.object({ id: z.string() }),
    execute: async (args: { id: string }) => {
      const id = await duplicateBoard(args.id);
      if (!id) throw new Error(`Could not duplicate board ${args.id} (missing or locked).`);
      return { id };
    },
  },
  {
    name: 'delete_board',
    description:
      'Delete a board from this library (and, when it is synced, from the account on the next sync). Destructive: requires confirm=true. Password-locked boards are refused.',
    access: 'write',
    parameters: z.object({ id: z.string(), confirm: z.literal(true) }),
    execute: async (args: { id: string }) => {
      const board = (await listBoards()).find((b) => b.id === args.id);
      if (!board) throw new Error(`No board with id ${args.id}.`);
      if (board.locked)
        throw new Error(`"${board.name}" is password-locked; unlock it in the app first.`);
      await deleteBoard(args.id);
      return { deleted: args.id, name: board.name };
    },
  },
  {
    name: 'save_as_template',
    description:
      'Save a copy of the open board as a personal template (offered when creating boards). Returns the template id.',
    access: 'write',
    parameters: z.object({ name: z.string().min(1).max(200) }),
    execute: async (args: { name: string }) => {
      requireOpen();
      const id = await saveOpenBoardAsTemplate(args.name);
      return { id, name: args.name };
    },
  },
  {
    name: 'list_folders',
    description:
      'The library folders (id, name, parent, path) and which folder each board sits in. Boards not listed sit in Home.',
    access: 'read',
    parameters: z.object({}),
    execute: async () => {
      const meta = await loadLibraryMeta();
      return {
        folders: meta.folders.map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
          path: folderPath(meta, f.id)
            .map((p) => p.name)
            .join(' / '),
          locked: !!f.lock,
        })),
        boardFolders: meta.boardFolders,
      };
    },
  },
  {
    name: 'create_folder',
    description: 'Create a library folder (optionally inside another). Returns its id.',
    access: 'write',
    parameters: z.object({ name: z.string().min(1).max(120), parentId: z.string().optional() }),
    execute: async (args: { name: string; parentId?: string }) => {
      const meta = await loadLibraryMeta();
      const { meta: next, id } = createFolder(meta, args.name, args.parentId ?? null);
      await saveLibraryMeta(next);
      return { id, name: args.name };
    },
  },
  {
    name: 'move_boards_to_folder',
    description: 'Move boards into a folder (folderId null = back to Home).',
    access: 'write',
    parameters: z.object({ ids: z.array(z.string()).min(1), folderId: z.string().nullable() }),
    execute: async (args: { ids: string[]; folderId: string | null }) => {
      const meta = await loadLibraryMeta();
      if (args.folderId && !meta.folders.some((f) => f.id === args.folderId)) {
        throw new Error(`No folder ${args.folderId} — list_folders shows the ids.`);
      }
      if (args.folderId && meta.folders.find((f) => f.id === args.folderId)?.lock) {
        throw new Error('That folder is password-locked; move boards into it in the app.');
      }
      await saveLibraryMeta(moveBoards(meta, args.ids, args.folderId));
      return { moved: args.ids.length, folderId: args.folderId };
    },
  },
  {
    name: 'set_board_tags',
    description: 'Replace the library tags of a board (tags filter the library, not the canvas).',
    access: 'write',
    parameters: z.object({ id: z.string(), tags: z.array(z.string().min(1).max(40)).max(30) }),
    execute: async (args: { id: string; tags: string[] }) => {
      const meta = await loadLibraryMeta();
      const tags = [...new Set(args.tags.map((t) => t.trim().replace(/^#+/, '')).filter(Boolean))];
      await saveLibraryMeta(setBoardTags(meta, args.id, tags));
      return { id: args.id, tags };
    },
  },
  {
    name: 'import_file',
    desktopOnly: true,
    description:
      'Import a local file by absolute path (desktop app only). Images, video, audio, PDF, EPUB, fonts and text/Markdown land on the open board at x/y (or the view centre); a .boardcache file is imported into the library and opened. Returns the new item ids (or the board id).',
    access: 'write',
    parameters: z.object({
      path: z.string().min(1),
      x: z.number().optional(),
      y: z.number().optional(),
      description: z.string().max(500).optional().describe('Image description / caption'),
      source: z
        .object({
          url: z.string(),
          title: z.string().optional(),
          author: z.string().optional(),
          siteName: z.string().optional(),
          capturedAt: z.string().optional(),
        })
        .optional()
        .describe('Provenance to stamp on the imported items'),
    }),
    execute: async (args: {
      path: string;
      x?: number;
      y?: number;
      description?: string;
      source?: {
        url: string;
        title?: string;
        author?: string;
        siteName?: string;
        capturedAt?: string;
      };
    }) => {
      const file = await readLocalFile(args.path);
      const lower = file.name.toLowerCase();
      if (/\.(boardcache|refboard)$/.test(lower)) {
        const { importBoardFile } = await import('./board/boardcacheFile');
        const { id, locked } = await importBoardFile(file);
        if (!locked) await openBoard(id);
        return { kind: 'board', id, opened: !locked };
      }
      requireOpen();
      const { clientToCanvas } = await import('./canvas/canvasDom');
      const at =
        args.x !== undefined && args.y !== undefined
          ? { x: args.x, y: args.y }
          : clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      let ids: string[];
      if (file.type.startsWith('text/') || file.type === 'application/json') {
        const { importTextFile } = await import('./import/importText');
        ids = [await importTextFile(file, at)];
      } else {
        const { importMediaFiles } = await import('./import/importMedia');
        ids = await importMediaFiles([file], at);
      }
      if (!ids.length)
        throw new Error(`Nothing importable in ${file.name} (${file.type || 'unknown type'}).`);
      if (args.description || args.source) {
        const { updateItems } = await import('../state/commands');
        updateItems(ids, 'Import metadata', (d) => {
          if (args.description && d.type === 'image' && !d.description)
            d.description = args.description;
          if (args.source && !d.source) d.source = args.source;
        });
      }
      return { kind: 'items', ids };
    },
  },
  {
    name: 'export_board',
    desktopOnly: true,
    description:
      'Export the open board to an absolute path (desktop app only): format "boardcache" (the portable archive with every asset) or "png" (one high-resolution image of the active page, or a zip of pages for multi-page boards). Returns the written path and size.',
    access: 'write',
    parameters: z.object({
      path: z.string().min(1),
      format: z.enum(['boardcache', 'png']).default('boardcache'),
    }),
    execute: async (args: { path: string; format: 'boardcache' | 'png' }) => {
      requireOpen();
      const { doc } = useDocumentStore.getState();
      if (args.format === 'boardcache') {
        const { exportBoardFile } = await import('./board/boardcacheFile');
        return writeLocalFile(args.path, await exportBoardFile(doc));
      }
      const { renderPagePng } = await import('./board/transfer');
      const { activePageId } = await import('./board/pages');
      const blob = await renderPagePng(doc, doc.pages.length > 1 ? activePageId(doc) : 'all');
      if (!blob) throw new Error('The board is empty — nothing to export.');
      return writeLocalFile(args.path, blob);
    },
  },
];

/** The library tools this build can run: the file ones need the shell's file bridge. */
function availableLibraryTools(): LibraryTool[] {
  const files = !!desktopFiles();
  return LIBRARY_TOOLS.filter((t) => files || !t.desktopOnly);
}

function currentBoard(): { id: string; name: string; items: number } | null {
  if (useSessionStore.getState().view !== 'canvas') return null;
  const { doc } = useDocumentStore.getState();
  return { id: doc.id, name: doc.name, items: Object.keys(doc.items).length };
}

function catalog() {
  const toJson = (schema: ZodType) =>
    z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  return {
    tools: [
      ...availableLibraryTools().map((t) => ({
        name: t.name,
        description: t.description,
        access: t.access,
        inputSchema: toJson(t.parameters),
      })),
      ...activeBoardTools().map((t) => ({
        name: t.name,
        description: t.description,
        access: t.access,
        inputSchema: toJson(t.parameters as ZodType),
      })),
    ],
  };
}

async function call(name: string, args: unknown): Promise<unknown> {
  const library = availableLibraryTools().find((t) => t.name === name);
  if (library) {
    const parsed = library.parameters.safeParse(args ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid arguments — ${issues}`);
    }
    return library.execute(parsed.data as never);
  }
  if (!currentBoard()) throw new Error(noBoard());
  const tool = activeBoardTools().find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  const run = () => runBoardTool(name, args);
  const outcome =
    tool.access === 'read' || tool.batch === false
      ? await run()
      : await runToolTurn(`Agent: ${name}`, run);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
}

/** Board names for the browser clipper's picker: real boards on this
 *  device only (no templates, nothing locked, nothing not yet downloaded). */
async function clipperBoards(): Promise<{ id: string; name: string }[]> {
  const summaries = await listBoards();
  const boards = summaries
    .filter((b) => !b.locked && !b.isTemplate && !b.remote)
    .map((b) => ({ id: b.id, name: b.name }));
  revokeSummaries(summaries);
  return boards;
}

export function initAgentBridge(): void {
  // The assistant (and __boardcache.runTool) reach the library tools through
  // the registry; the agent endpoint below lists them itself.
  setLibraryToolSource(() => availableLibraryTools() as unknown as BoardTool[]);
  const agent = desktopAgent();
  if (!agent) return;
  agent.onRequest((req: AgentRequest) => {
    void (async () => {
      if (req.kind === 'call') inFlight.add(req.id);
      try {
        const result =
          req.kind === 'tools'
            ? catalog()
            : req.kind === 'boards'
              ? await clipperBoards()
              : await call(req.name, req.args);
        agent.respond({ id: req.id, ok: true, result });
      } catch (err) {
        agent.respond({
          id: req.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inFlight.delete(req.id);
      }
    })();
  });
  agent.ready();
}
