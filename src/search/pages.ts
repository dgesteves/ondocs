// Pages and sections read back out of a loaded index: what the MCP endpoint's `fetch` and
// `list_pages` serve, and the snippets its `search` shows. Runtime-neutral.
import type { IndexDocument } from '../index-file';
import { trimTrailingSlashes } from '../text/slashes';
import { tokenize } from '../text/tokenize';
import type { LoadedIndex, RetrievedChunk } from './retrieve';

/** A page of the index with its chunks, in reading order. */
export interface IndexPage extends IndexDocument {
  readonly chunks: readonly RetrievedChunk[];
}

const pagesByIndex = new WeakMap<LoadedIndex, IndexPage[]>();

/** The index's pages that have content, in `documents` order. Computed once per index. */
export function indexPages(index: LoadedIndex): readonly IndexPage[] {
  let pages = pagesByIndex.get(index);
  if (pages) return pages;
  const chunks = new Map<string, RetrievedChunk[]>();
  for (const chunk of index.chunks) {
    let list = chunks.get(chunk.documentId);
    if (!list) {
      list = [];
      chunks.set(chunk.documentId, list);
    }
    list.push(chunk);
  }
  pages = index.documents.flatMap((document) => {
    const list = chunks.get(document.id);
    return list ? [{ ...document, chunks: list }] : [];
  });
  pagesByIndex.set(index, pages);
  return pages;
}

/**
 * `next` without the context it repeats from the end of `previous`. Consecutive chunks of a
 * section start with up to `overlap` characters of the one before, then a blank line; the longest
 * such prefix that `previous` ends with is that context.
 */
function withoutOverlap(previous: string, next: string, overlap: number): string {
  let cut = -1;
  for (
    let at = next.indexOf('\n\n');
    at !== -1 && at <= overlap;
    at = next.indexOf('\n\n', at + 1)
  ) {
    if (at > 0 && previous.endsWith(next.slice(0, at))) cut = at;
  }
  return cut === -1 ? next : next.slice(cut + 2);
}

/** A heading path as the chunker writes it, split back into its headings. */
const headingPath = (heading: string): string[] => (heading ? heading.split(' › ') : []);

/**
 * `chunks` (of one page, in order) as Markdown: each section under its heading, at the depth of
 * its heading path (the page title being the `#`), and each chunk without the overlap it shares
 * with the one before it. `from` is the heading path already open above the first chunk.
 */
function chunksMarkdown(
  chunks: readonly RetrievedChunk[],
  overlap: number,
  from: readonly string[] = [],
): string {
  const parts: string[] = [];
  let path: readonly string[] = from;
  let previous: RetrievedChunk | null = null;
  for (const chunk of chunks) {
    const next = headingPath(chunk.heading);
    const sameSection =
      previous !== null && previous.url === chunk.url && previous.heading === chunk.heading;
    if (!sameSection) {
      // Open the headings that differ from the ones already open.
      let shared = 0;
      while (shared < Math.min(path.length, next.length) && path[shared] === next[shared])
        shared += 1;
      if (shared === next.length && next.length > 0) shared -= 1;
      for (let depth = shared; depth < next.length; depth += 1) {
        parts.push(`${'#'.repeat(Math.min(depth + 2, 6))} ${next[depth] ?? ''}`);
      }
      path = next;
    }
    parts.push(
      sameSection && previous ? withoutOverlap(previous.text, chunk.text, overlap) : chunk.text,
    );
    previous = chunk;
  }
  return parts.join('\n\n');
}

/** A whole page as Markdown: its title, then every section. */
export function pageMarkdown(page: IndexPage, overlap: number): string {
  return `# ${page.title}\n\n${chunksMarkdown(page.chunks, overlap)}`.trimEnd();
}

/**
 * The chunks of `page` a section URL (`/docs/page#anchor`) cites: the section, with any
 * subsections that link to it because they have no anchor of their own. Empty when the page has
 * no such section.
 */
export function sectionChunks(page: IndexPage, url: string): RetrievedChunk[] {
  return page.chunks.filter((chunk) => chunk.url === url);
}

/** A section as Markdown, under its full heading path and the page title. */
export function sectionMarkdown(
  page: IndexPage,
  chunks: readonly RetrievedChunk[],
  overlap: number,
): string {
  return `# ${page.title}\n\n${chunksMarkdown(chunks, overlap)}`.trimEnd();
}

/** The sections of a page, in order: each distinct section URL with its heading path. */
export function pageSections(page: IndexPage): { url: string; heading: string }[] {
  const seen = new Set<string>();
  const sections: { url: string; heading: string }[] = [];
  for (const chunk of page.chunks) {
    if (!chunk.heading || seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    sections.push({ url: chunk.url, heading: chunk.heading });
  }
  return sections;
}

const SENTENCES = /(?<=[.!?:])\s+|\n+/;

/**
 * The part of `text` that best matches `query`, about `max` characters long: the run of
 * sentences (or lines) holding the most distinct query words, earliest first on a tie, with
 * whitespace collapsed and an ellipsis where it was cut.
 */
export function snippet(text: string, query: string, max = 280): string {
  const terms = new Set(tokenize(query));
  const sentences = text
    .split(SENTENCES)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (sentences.length === 0) return '';
  const words = sentences.map((sentence) => new Set(tokenize(sentence)));
  let best = { start: 0, end: 1, score: -1 };
  for (let start = 0; start < sentences.length; start += 1) {
    let length = 0;
    const found = new Set<string>();
    let end = start;
    while (end < sentences.length) {
      const sentence = sentences[end] ?? '';
      if (end > start && length + 1 + sentence.length > max) break;
      length += (end > start ? 1 : 0) + sentence.length;
      for (const word of words[end] ?? []) if (terms.has(word)) found.add(word);
      end += 1;
    }
    if (found.size > best.score) best = { start, end, score: found.size };
  }
  let out = sentences.slice(best.start, best.end).join(' ');
  let cut = false;
  if (out.length > max) {
    out = out.slice(0, max).replace(/\s+\S*$/, '');
    cut = true;
  }
  const truncatedEnd = cut || best.end < sentences.length;
  return `${best.start > 0 ? '…' : ''}${out}${truncatedEnd ? '…' : ''}`;
}

/** Path endings agents add to a page URL: `.md`, `/index.md`, `.mdx`, `.html`, `/index.html`. */
const PAGE_SUFFIX = /(?:\/index)?\.(?:md|mdx|html?)$/i;

/** A path compared without its trailing slash, Markdown or HTML ending, or percent-encoding. */
function comparablePath(path: string): string {
  let value = path;
  try {
    value = decodeURI(value);
  } catch {
    // Keep it as it is.
  }
  value = trimTrailingSlashes(value.replace(PAGE_SUFFIX, ''));
  return value || '/';
}

/** An anchor without its percent-encoding, or as it is when it is not valid encoding. */
function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

/**
 * The page (and, after `#`, the section) a reference names: a URL from the index, with or
 * without an origin, a trailing slash or a `.md` ending; a page's document id; or a chunk id. An
 * absolute URL whose page the index holds as a path is looked up by its path, whatever its host,
 * since the endpoint may not run on the site's own origin.
 */
export function findPage(
  index: LoadedIndex,
  reference: string,
): { page: IndexPage; section: string | null } | null {
  const pages = indexPages(index);
  const value = reference.trim();
  if (!value) return null;

  const byId = pages.find((page) => page.id === value);
  if (byId) return { page: byId, section: null };
  const chunk = index.chunks.find((candidate) => candidate.id === value);
  if (chunk) {
    const page = pages.find((candidate) => candidate.id === chunk.documentId);
    if (page) return { page, section: chunk.url.includes('#') ? chunk.url : null };
  }

  const lookup = (url: string): { page: IndexPage; section: string | null } | null => {
    const hash = url.indexOf('#');
    const path = hash === -1 ? url : url.slice(0, hash);
    const anchor = hash === -1 ? '' : url.slice(hash + 1);
    const absolute = ABSOLUTE.test(path);
    const wanted = comparablePath(absolute || path.startsWith('/') ? path : `/${path}`);
    const page = pages.find(
      (candidate) =>
        candidate.url === path ||
        // An absolute URL in the index is only compared with absolute URLs, and a path with paths.
        (ABSOLUTE.test(candidate.url) === absolute && comparablePath(candidate.url) === wanted),
    );
    if (!page) return null;
    if (!anchor) return { page, section: null };
    // A URL from search is absolute, and `new URL` percent-encodes an anchor that is not ASCII
    // (`#configura%C3%A7%C3%A3o`), so anchors are compared decoded.
    const decoded = decodeAnchor(anchor);
    const match = page.chunks.find((chunk) => {
      const at = chunk.url.indexOf('#');
      return at !== -1 && decodeAnchor(chunk.url.slice(at + 1)) === decoded;
    });
    return { page, section: match ? match.url : `${page.url}#${anchor}` };
  };
  const found = lookup(value);
  if (found || !ABSOLUTE.test(value)) return found;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return lookup(`${url.pathname}${url.hash}`);
}

const ABSOLUTE = /^https?:\/\//i;
