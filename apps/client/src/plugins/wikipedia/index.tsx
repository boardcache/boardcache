import './style.css';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Item } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { z } from 'zod';
import { BookOpenIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { putAsset } from '../../lib/board/assetStore';
import { getCanvasContainer, clientToCanvas } from '../../lib/canvas/canvasDom';
import type { Point } from '../../lib/canvas/coords';
import { placeBesideContent } from '../../lib/canvas/placement';
import { activePageId, addPage, switchPage } from '../../lib/board/pages';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { runCommand, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';
import { aiAvailable, enrichWithAI } from './ai';
import type { AiEnrichment } from './ai';
import { arrange } from './arrange';
import type { ImportOptions, StoredImage } from './arrange';
import { fetchArticle, fetchImageBlob, fetchImageInfo, searchWikipedia } from './wiki';
import type { WikiArticle, WikiSearchHit } from './wiki';

/**
 * Wikipedia plugin: search for an article and lay it out as a board — a
 * title, a summary card, the key facts, one card per section, the article's
 * images with captions and credits, a timeline of dated events, and a
 * sources card — connected in reading order or, with a model, by the
 * relations it finds. One undo step; the result is a named group.
 */

const PLUGIN_ID = 'wikipedia';
const MAX_IMAGES = 6;

const DEFAULT_OPTIONS: ImportOptions = {
  images: true,
  timeline: true,
  facts: true,
  sources: true,
  useAI: true,
  target: 'active',
  group: true,
};

interface DialogState {
  open: boolean;
  openNew: () => void;
  close: () => void;
}

const useWikiDialog = create<DialogState>((set) => ({
  open: false,
  openNew: () => set({ open: true }),
  close: () => set({ open: false }),
}));

type Progress = (message: string) => void;

// --- the import ------------------------------------------------------------

async function storeImages(article: WikiArticle, progress: Progress): Promise<StoredImage[]> {
  const figures = article.figures.slice(0, MAX_IMAGES + 2);
  if (figures.length === 0) return [];
  progress('Reading image credits');
  const infos = await fetchImageInfo(
    figures.map((f) => f.file),
    article.lang,
  ).catch(() => []);
  const stored: StoredImage[] = [];
  for (const info of infos) {
    if (stored.length >= MAX_IMAGES) break;
    const fig = figures.find((f) => f.file === info.file);
    if (!fig) continue;
    progress(`Fetching image ${stored.length + 1} of ${Math.min(MAX_IMAGES, infos.length)}…`);
    const blob = await fetchImageBlob(info.url);
    if (!blob) continue;
    let width = info.width;
    let height = info.height;
    try {
      const bmp = await createImageBitmap(blob);
      width = bmp.width;
      height = bmp.height;
      bmp.close();
    } catch {
      /* metadata size is close enough */
    }
    const assetId = await putAsset(blob);
    stored.push({
      assetId,
      width,
      height,
      file: info.file,
      caption: fig.caption,
      artist: info.artist,
      license: info.license,
      pageUrl: info.descriptionUrl,
      section: fig.section,
    });
  }
  return stored;
}

/** Fetch, arrange and commit an article. Returns the new group id. */
export async function importArticle(
  title: string,
  opts: ImportOptions,
  progress: Progress = () => {},
  at?: Point,
  lang = 'en',
): Promise<{ groupId: string | null; ids: string[]; title: string }> {
  progress('Reading the article');
  const article = await fetchArticle(title, lang);
  if (!article.lead && article.sections.length === 0) {
    throw new Error('That article has no readable text.');
  }
  const images = opts.images ? await storeImages(article, progress) : [];
  let ai: AiEnrichment | null = null;
  if (opts.useAI && aiAvailable()) {
    progress('Summarizing with AI');
    ai = await enrichWithAI(article).catch(() => null);
  }
  progress('Arranging the board');
  const plan = arrange(article, images, ai, opts);

  // A fresh page named after the article, a chosen page, or the one in view.
  if (opts.target === 'new') addPage(article.title);
  else if (opts.target !== 'active') switchPage(opts.target);
  const { doc } = useDocumentStore.getState();
  const page = activePageId(doc);
  const pageStamp = page && page !== doc.pages[0]?.id ? { pageId: page } : {};

  // Place the whole arrangement beside the page's content (or at the point).
  const viewCenter = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const origin = at
    ? { x: at.x - plan.bounds.width / 2, y: at.y - plan.bounds.height / 2 }
    : placeBesideContent(doc, plan.bounds.width, plan.bounds.height, viewCenter).topLeft;
  const baseZ = topZIndex(doc) + 1;
  const groupId = opts.group ? newId() : null;
  const items: Item[] = plan.items.map((it) => ({
    ...it,
    ...pageStamp,
    x: it.x + origin.x,
    y: it.y + origin.y,
    zIndex: baseZ + it.zIndex,
    groupId,
  }));
  runCommand(`Import “${article.title}” from Wikipedia`, (draft) => {
    if (groupId) draft.groups[groupId] = { id: groupId, name: plan.groupName };
    for (const it of items) draft.items[it.id] = it;
    for (const c of plan.connections) draft.connections[c.id] = c;
  });
  const ids = items.map((i) => i.id);
  useSessionStore.getState().setSelection(ids);
  fitViewportTo(
    { x: origin.x, y: origin.y, width: plan.bounds.width, height: plan.bounds.height },
    getCanvasContainer(),
  );
  return { groupId, ids, title: article.title };
}

// --- dialog ------------------------------------------------------------------

function WikiDialogHost() {
  const open = useWikiDialog((s) => s.open);
  return open ? <WikiDialog /> : null;
}

function WikiDialog() {
  const close = () => useWikiDialog.getState().close();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<WikiSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<WikiSearchHit | null>(null);
  const [opts, setOpts] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const withAI = aiAvailable();
  // Where to put it: this page, another page by name, or a new page.
  const pages = useDocumentStore((s) => s.doc.pages);
  const active = activePageId(useDocumentStore.getState().doc);
  const targets = [
    { value: 'active', label: 'This page' },
    ...pages.filter((p) => p.id !== active).map((p) => ({ value: p.id, label: p.name })),
    { value: 'new', label: 'A new page named after the article' },
  ];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setPicked(null);
    try {
      const found = await searchWikipedia(q);
      setHits(found);
      if (found.length === 1) setPicked(found[0]!);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const run = async () => {
    if (!picked) return;
    setError(null);
    try {
      await importArticle(picked.title, { ...opts, useAI: opts.useAI && withAI }, setProgress);
      close();
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  const toggle = (key: Exclude<keyof ImportOptions, 'target'>) => (
    <label className="settings-row wiki-option">
      <input
        type="checkbox"
        checked={opts[key]}
        disabled={progress !== null}
        data-testid={`wiki-opt-${key}`}
        onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
      />
      <span>
        {key === 'images' && `Images and captions (up to ${MAX_IMAGES})`}
        {key === 'timeline' && 'Timeline of dated events'}
        {key === 'facts' && 'Key facts'}
        {key === 'sources' && 'Sources and credits'}
        {key === 'useAI' && 'Summaries, events and connections with AI'}
        {key === 'group' && 'Group the cards so the article moves as one'}
      </span>
    </label>
  );

  return (
    <UiDialog
      title="Import Wikipedia Article"
      onClose={close}
      className="wiki-sheet"
      size="large"
      testId="wiki-dialog"
      dismissable={progress === null}
    >
      <div className="wiki-body">
        <div className="wiki-search-row">
          <input
            ref={inputRef}
            value={query}
            placeholder="Search Wikipedia"
            data-testid="wiki-search"
            disabled={progress !== null}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
          />
          <button
            type="button"
            className="community-preview-btn"
            disabled={searching || !query.trim() || progress !== null}
            data-testid="wiki-search-go"
            onClick={() => void search()}
          >
            {searching ? 'Searching' : 'Search'}
          </button>
        </div>

        {hits && hits.length === 0 && <p className="settings-hint">No articles match.</p>}
        {hits && hits.length > 0 && (
          <div className="wiki-results" data-testid="wiki-results" role="listbox">
            {hits.map((h) => (
              <button
                type="button"
                key={h.title}
                role="option"
                aria-selected={picked?.title === h.title}
                className={`wiki-result${picked?.title === h.title ? ' active' : ''}`}
                disabled={progress !== null}
                onClick={() => setPicked(h)}
              >
                <span className="wiki-result-thumb">
                  {h.thumbnail ? <img src={h.thumbnail} alt="" /> : <BookOpenIcon />}
                </span>
                <span className="wiki-result-text">
                  <span className="wiki-result-title">{h.title}</span>
                  {h.description && <span className="wiki-result-desc">{h.description}</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        {picked && (
          <div className="plugin-settings wiki-options">
            <label className="settings-row wiki-target">
              <span>Add to</span>
              <UiSelect
                value={opts.target}
                options={targets}
                ariaLabel="Where to add the article"
                testId="wiki-target"
                onChange={(target) => setOpts({ ...opts, target })}
              />
            </label>
            {toggle('images')}
            {toggle('facts')}
            {toggle('timeline')}
            {toggle('sources')}
            {toggle('group')}
            {withAI ? (
              toggle('useAI')
            ) : (
              <p className="settings-hint">
                Sign in for hosted AI to get section summaries, a curated timeline and labelled
                connections. Without it, cards carry the article’s own opening paragraphs and
                connect in reading order.
              </p>
            )}
          </div>
        )}

        {error && <p className="wiki-error">{error}</p>}

        <div className="wiki-foot">
          <span className="settings-hint wiki-progress" data-testid="wiki-progress">
            {progress ?? (picked ? `“${picked.title}” arrives as connected cards.` : '')}
          </span>
          <button
            type="button"
            className="sync-primary"
            disabled={!picked || progress !== null}
            data-testid="wiki-import"
            onClick={() => void run()}
          >
            {progress ? 'Importing' : 'Import to board'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

// --- registration -------------------------------------------------------------

const toolSchema = z.object({
  title: z
    .string()
    .describe('Exact Wikipedia article title (or a search query; the top hit is used).'),
  lang: z.string().optional().describe('Wikipedia language code, default "en".'),
  images: z.boolean().optional().describe('Import the article’s images (default true).'),
  timeline: z.boolean().optional().describe('Add a timeline of dated events (default true).'),
  useAI: z.boolean().optional().describe('Summarize and connect sections with AI (default true).'),
  newPage: z
    .boolean()
    .optional()
    .describe('Create a new page named after the article and import there (default false).'),
  pageId: z
    .string()
    .optional()
    .describe('Import onto this existing page (default: the page in view).'),
  group: z.boolean().optional().describe('Group the cards so they move as one (default true).'),
  x: z.number().optional(),
  y: z.number().optional(),
});

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 58,
    name: 'Wikipedia',
    description:
      'Turn a Wikipedia article into a board: a summary, key facts, a card per section, the images with credits, a timeline of dated events and a sources card — connected in reading order, or by the relations AI finds.',
  },
  addMenu: [
    {
      label: 'Import Wikipedia Article',
      category: 'documents',
      icon: <BookOpenIcon />,
      onSelect: () => useWikiDialog.getState().openNew(),
    },
  ],
  Component: WikiDialogHost,
  tools: [
    {
      name: 'import_wikipedia',
      description:
        'Import a Wikipedia article as an arranged board: title, summary card, key facts, one card per section, images with captions and credits, a timeline of dated events, a sources card, and connections between related cards. Returns the group id and item ids.',
      parameters: toolSchema,
      access: 'write',
      execute: async (args, ctx) => {
        const lang = args.lang ?? 'en';
        let title = args.title;
        try {
          await fetchArticle(title, lang);
        } catch {
          const hit = (await searchWikipedia(title, lang))[0];
          if (!hit) throw new Error(`No Wikipedia article matches “${args.title}”.`);
          title = hit.title;
        }
        const center = ctx.viewCenter();
        const at = args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : center;
        return importArticle(
          title,
          {
            ...DEFAULT_OPTIONS,
            images: args.images ?? true,
            timeline: args.timeline ?? true,
            useAI: args.useAI ?? true,
            target: args.newPage ? 'new' : (args.pageId ?? 'active'),
            group: args.group ?? true,
          },
          () => {},
          at,
          lang,
        );
      },
    },
  ],
});
