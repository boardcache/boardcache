import { z } from 'zod';
import type { BoardTool } from '../../lib/tools/registry';
import {
  PROVIDERS,
  availableProviders,
  providerSpec,
  providerStatus,
  searchProvider,
  type ProviderId,
  type ProviderKind,
  type SearchOptions,
} from './providers';

/**
 * The Research plugin's board tools: one search tool per kind of source,
 * each fanning out to whichever provider the caller names or the first one
 * available here (keys present, cross-origin allowed). Results are
 * normalised so an agent can quote, cite and import them the same way
 * whatever the provider. Nothing here writes to the board: the agent
 * decides what becomes a card, with set_item_meta source and quote.
 */

const KIND_DESC: Record<ProviderKind, string> = {
  web: 'the open web',
  news: 'news articles',
  papers: 'scholarly papers',
  collections: 'museum, library and archive collections (images, records, digitised pages)',
  books: 'books',
  social: 'social posts',
};

function ids(kind: ProviderKind): [ProviderId, ...ProviderId[]] {
  const list = PROVIDERS.filter((p) => p.kind === kind).map((p) => p.id);
  return list as [ProviderId, ...ProviderId[]];
}

function describeAvailability(kind: ProviderKind): string {
  return PROVIDERS.filter((p) => p.kind === kind)
    .map(
      (p) =>
        `${p.id} (${p.label}${p.needsKey ? ', key' : ', no key'}${p.corsSafe ? '' : ', desktop'})`,
    )
    .join('; ');
}

function searchTool(
  name: string,
  kind: ProviderKind,
  extra: string,
  dated: boolean,
  images: boolean,
): BoardTool {
  const sources = ids(kind);
  return {
    name,
    description:
      `Search ${KIND_DESC[kind]} through the Research plugin's providers: ${describeAvailability(kind)}. ` +
      `Omit \`source\` to use the first provider available on this device (research_sources lists them). ${extra} ` +
      'Returns normalised results (title, url, snippet, date, author, site, image, license). Quote only from what you then fetch or from the snippet, and cite the url.',
    parameters: z.object({
      query: z.string().min(2).max(400),
      source: z.enum(['auto', ...sources]).default('auto'),
      count: z.number().int().min(1).max(25).default(8),
      ...(dated
        ? {
            from: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional()
              .describe('YYYY-MM-DD'),
            to: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional()
              .describe('YYYY-MM-DD'),
          }
        : {}),
      ...(images
        ? { imagesOnly: z.boolean().default(true).describe('Only records with an image') }
        : {}),
    }),
    access: 'external',
    execute: async (args: {
      query: string;
      source: string;
      count: number;
      from?: string;
      to?: string;
      imagesOnly?: boolean;
    }) => {
      const available = availableProviders(kind);
      const chosen: ProviderId | undefined =
        args.source === 'auto' ? available[0] : (args.source as ProviderId);
      if (!chosen) {
        const why = PROVIDERS.filter((p) => p.kind === kind)
          .map((p) => `${p.label}: ${providerStatus(p.id).reason}`)
          .join('; ');
        throw new Error(`No ${kind} provider is available here. ${why}.`);
      }
      const opts: SearchOptions = {
        count: args.count,
        ...(args.from ? { from: args.from } : {}),
        ...(args.to ? { to: args.to } : {}),
        ...(args.imagesOnly !== undefined ? { imagesOnly: args.imagesOnly } : {}),
      };
      const outcome = await searchProvider(chosen, args.query, opts);
      return {
        source: outcome.source,
        provider: providerSpec(outcome.source).label,
        count: outcome.results.length,
        results: outcome.results,
        ...(outcome.note ? { note: outcome.note } : {}),
        ...(available.length > 1
          ? { alsoAvailable: available.filter((p) => p !== outcome.source) }
          : {}),
      };
    },
  };
}

const researchSourcesTool: BoardTool = {
  name: 'research_sources',
  description:
    'Which research providers can run on this device right now (keys entered, cross-origin allowed), grouped by kind, and why the others cannot. Call it once before researching so you search what is actually available.',
  parameters: z.object({}),
  access: 'read',
  execute: () => {
    const kinds: ProviderKind[] = ['web', 'news', 'papers', 'collections', 'books', 'social'];
    return Object.fromEntries(
      kinds.map((kind) => [
        kind,
        PROVIDERS.filter((p) => p.kind === kind).map((p) => {
          const s = providerStatus(p.id);
          return {
            id: p.id,
            label: p.label,
            available: s.available,
            ...(s.reason ? { reason: s.reason } : {}),
            about: p.blurb,
          };
        }),
      ]),
    );
  },
};

export const researchTools: BoardTool[] = [
  researchSourcesTool,
  searchTool(
    'search_web',
    'web',
    'Use for current facts, official pages and articles to read; follow up with read_webpage.',
    false,
    false,
  ),
  searchTool(
    'search_news',
    'news',
    'from/to narrow the dates; The Guardian returns article text in the snippet, the NYT an abstract, GDELT titles only.',
    true,
    false,
  ),
  searchTool(
    'search_papers',
    'papers',
    'Abstracts come back in the snippet; the url prefers an open-access copy; extra carries the DOI and citation count.',
    true,
    false,
  ),
  searchTool(
    'search_collections',
    'collections',
    'Image urls are real and importable with import_from_url; read the license field before using one, and credit artist, date and the item url.',
    false,
    true,
  ),
  searchTool(
    'search_books',
    'books',
    'Google Books returns snippets to quote as snippets; the Internet Archive returns scans whose pages can be imported.',
    false,
    false,
  ),
  searchTool(
    'search_social',
    'social',
    'A post is evidence only of what its author said and when: keep the handle, date and url, and verify claims elsewhere.',
    false,
    false,
  ),
];
