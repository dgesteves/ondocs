// The MCP endpoint's tools: search, fetch and list_pages over a loaded index. No model is called
// here; the agent that calls them brings its own.
import {
  findPage,
  indexPages,
  pageMarkdown,
  pageSections,
  sectionChunks,
  sectionMarkdown,
  snippet,
} from '../search/pages';
import {
  retrieve,
  type LoadedIndex,
  type RetrievalHit,
  type RetrievalOptions,
} from '../search/retrieve';
import type { RetrievalHooks } from './retrieval';

/** A tool as `tools/list` describes it. */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: Record<string, boolean | string>;
}

/** What `tools/call` returns. */
export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** One search result: a section of a page. */
export interface McpSearchResult {
  /** Pass it to `fetch`: the section's URL as the index has it, anchor included. */
  id: string;
  /** The page title. */
  title: string;
  /** The section's heading path, `Install › With pnpm`; empty at the top of a page. */
  heading: string;
  /** The section's absolute URL. */
  url: string;
  /** The part of the section that best matches the query. */
  text: string;
}

/** Retrieval settings for `search`: looser than the ask endpoint's, as the agent judges results. */
export const MCP_RETRIEVAL = { minKeywordCoverage: 0.3 } as const satisfies RetrievalOptions;

/** Sections `search` returns at most. */
export const SEARCH_RESULTS = 8;

/**
 * What `search` says when no section clears its gate: a word the docs never use outweighs the
 * rest of a query, so a plain question can find nothing that keywords would find.
 */
export const NO_RESULTS_NOTE =
  'No section matched enough of the query. Search again with fewer or different keywords, such ' +
  'as a feature, option or API name, or call list_pages to browse the pages, before concluding ' +
  'that the docs do not cover it.';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * The `locale` argument of `search` and `list_pages`, for an endpoint with `indexes`: the locales
 * it has an index for, besides the default one.
 */
function localeProperty(locales: readonly string[]): Record<string, unknown> {
  return locales.length === 0
    ? {}
    : {
        locale: {
          type: 'string',
          description: 'The docs in this language, instead of the default ones.',
          enum: [...locales],
        },
      };
}

export function mcpTools(
  siteName: string,
  maxQueryLength: number,
  locales: readonly string[] = [],
): McpTool[] {
  return [
    {
      name: 'search',
      title: `Search ${siteName}`,
      description:
        `Search ${siteName}. Returns up to ${String(SEARCH_RESULTS)} matching sections, best ` +
        'first, each with an id, its page title and heading, a URL and a snippet. Use keywords ' +
        'or a short question; then read a result in full by passing its id to fetch.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look for: keywords, an API name, or a short question.',
            minLength: 1,
            maxLength: maxQueryLength,
          },
          ...localeProperty(locales),
        },
        required: ['query'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                heading: { type: 'string' },
                url: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['id', 'title', 'heading', 'url', 'text'],
            },
          },
          note: { type: 'string' },
        },
        required: ['results'],
      },
      annotations: { title: `Search ${siteName}`, ...READ_ONLY },
    },
    {
      name: 'fetch',
      title: `Read a page of ${siteName}`,
      description:
        `Read a page or section of ${siteName} as Markdown. Takes an id from search or a page ` +
        'URL: an id with #anchor returns that section, a page URL the whole page.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'An id from search, or a page URL or path.',
            minLength: 1,
            maxLength: 2048,
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          text: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['id', 'title', 'url', 'text'],
      },
      annotations: { title: `Read a page of ${siteName}`, ...READ_ONLY },
    },
    {
      name: 'list_pages',
      title: `List the pages of ${siteName}`,
      description:
        `List the pages of ${siteName}, with their titles and URLs. Pass a path prefix, such as ` +
        '/docs/guides, to list only the pages under it.',
      inputSchema: {
        type: 'object',
        properties: {
          prefix: {
            type: 'string',
            description: 'Only pages whose path starts with this, e.g. /docs/guides.',
            maxLength: 2048,
          },
          ...localeProperty(locales),
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                url: { type: 'string' },
              },
              required: ['id', 'title', 'url'],
            },
          },
          total: { type: 'number' },
        },
        required: ['pages', 'total'],
      },
      annotations: { title: `List the pages of ${siteName}`, ...READ_ONLY },
    },
  ];
}

/** A tool result: the structured value, and the same as JSON text for clients that read only text. */
function result(structured: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

/** A tool error the agent can read and act on. */
export function toolError(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const ABSOLUTE = /^https?:\/\//i;

/** `url` made absolute against the site, unless it already is. */
function absolute(url: string, site: string | undefined): string {
  if (!site || ABSOLUTE.test(url)) return url;
  try {
    return new URL(url, site).href;
  } catch {
    return url;
  }
}

/** The retrieval settings `search` runs with: its own defaults, then the endpoint's `retrieval`. */
export function searchRetrieval(
  retrieval: (RetrievalOptions & RetrievalHooks) | undefined,
): RetrievalOptions & RetrievalHooks {
  return { ...MCP_RETRIEVAL, topK: SEARCH_RESULTS * 3, ...retrieval };
}

/**
 * The sections that best match `query`: retrieval's ranked chunks, merged by section (one result
 * per URL, anchor included) with a snippet of the best chunk, at most {@link SEARCH_RESULTS}.
 */
export function searchSections(
  index: LoadedIndex,
  query: string,
  vector: readonly number[] | null,
  options: { retrieval?: RetrievalOptions | undefined; siteUrl?: string | undefined },
): McpSearchResult[] {
  const retrieval = retrieve(index, { text: query, vector }, searchRetrieval(options.retrieval));
  return sectionResults(retrieval.hits, query, options.siteUrl);
}

/** Ranked chunks as `search` returns them: one result per section, best first. */
export function sectionResults(
  hits: readonly RetrievalHit[],
  query: string,
  siteUrl: string | undefined,
): McpSearchResult[] {
  const results: McpSearchResult[] = [];
  const seen = new Set<string>();
  for (const { chunk } of hits) {
    if (seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    results.push({
      id: chunk.url,
      title: chunk.title,
      heading: chunk.heading,
      url: absolute(chunk.url, siteUrl),
      text: snippet(chunk.text, query),
    });
    if (results.length === SEARCH_RESULTS) break;
  }
  return results;
}

/** `search`'s result: the sections, with {@link NO_RESULTS_NOTE} when there are none. */
export function searchResult(results: McpSearchResult[]): McpToolResult {
  return result(results.length > 0 ? { results } : { results, note: NO_RESULTS_NOTE });
}

/** Characters `fetch` returns at most; a longer page is cut, with its sections listed after. */
export const MAX_FETCH_CHARS = 60_000;

/** `fetch`: a page, or a section of one, as Markdown. */
export function fetchPage(
  index: LoadedIndex,
  id: string,
  siteUrl: string | undefined,
  maxChars = MAX_FETCH_CHARS,
): McpToolResult {
  const found = findPage(index, id);
  if (!found) {
    return toolError(
      `No page matches ${JSON.stringify(id)}. Use search to find one, or list_pages to see them all.`,
    );
  }
  const { page, section } = found;
  const { overlap } = index.chunking;
  const chunks = section ? sectionChunks(page, section) : [];
  const whole = chunks.length === 0;
  let text = whole ? pageMarkdown(page, overlap) : sectionMarkdown(page, chunks, overlap);
  const notes: string[] = [];
  if (section && whole)
    notes.push(
      `This page has no section #${section.slice(section.indexOf('#') + 1)}; here is the whole page.`,
    );
  if (!whole)
    notes.push(
      `This is one section of the page ${absolute(page.url, siteUrl)}; fetch that URL for the whole page.`,
    );
  if (text.length > maxChars) {
    const sections = pageSections(page)
      .map((entry) => `- ${entry.heading}: ${entry.url}`)
      .join('\n');
    text = `${text.slice(0, maxChars).replace(/\s+\S*$/, '')}\n\n[Cut at ${String(maxChars)} characters. Fetch a section by its id to read the rest:]\n${sections}`;
  }
  const url = absolute(section && !whole ? section : page.url, siteUrl);
  return result({
    id: section && !whole ? section : page.url,
    title: page.title,
    url,
    text: notes.length > 0 ? `${text}\n\n${notes.join(' ')}` : text,
    metadata: { page: absolute(page.url, siteUrl), sections: pageSections(page).length },
  });
}

/** Pages `list_pages` returns at most; narrow a bigger site with `prefix`. */
export const MAX_LISTED_PAGES = 500;

/** `list_pages`: the pages, optionally only those under a path prefix. */
export function listPages(
  index: LoadedIndex,
  prefix: string | undefined,
  siteUrl: string | undefined,
): McpToolResult {
  const wanted = prefix?.trim().replace(/\/+$/, '') ?? '';
  const path = (url: string): string => {
    if (!ABSOLUTE.test(url)) return url;
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };
  const target = wanted
    ? path(wanted.startsWith('/') || ABSOLUTE.test(wanted) ? wanted : `/${wanted}`)
    : '';
  const pages = indexPages(index).filter((page) => {
    if (!target || target === '/') return true;
    const pagePath = path(page.url);
    return pagePath === target || pagePath.startsWith(`${target}/`);
  });
  const listed = pages.slice(0, MAX_LISTED_PAGES).map((page) => ({
    id: page.url,
    title: page.title,
    url: absolute(page.url, siteUrl),
  }));
  const structured: Record<string, unknown> = { pages: listed, total: pages.length };
  if (pages.length > listed.length) {
    structured.note = `Showing the first ${String(listed.length)} of ${String(pages.length)} pages; pass a prefix to narrow the list.`;
  }
  return result(structured);
}
