/**
 * `llms.txt`, `llms-full.txt` and a Markdown copy of each page, from the pages an index is built
 * from: what agents look for on a docs site. Runtime-neutral; the plugins and the CLI write the
 * files this returns.
 *
 * - `llms.txt` follows llmstxt.org: the site's name as the H1, its summary as a quote, then a
 *   section of links per part of the site, each to the page's Markdown copy.
 * - `llms-full.txt`, a common convention rather than part of the spec, holds every page in one
 *   file.
 * - Each page's copy is at its URL without a trailing slash, plus `.md` (`/docs/intro/` →
 *   `/docs/intro.md`, the site's root → `/index.md`), as Mintlify, GitBook, Fumadocs and the
 *   Docusaurus and Starlight llms plugins write them. It starts with a pointer to `llms.txt`.
 */
import { mapLinkDestinations } from './text/links';
import { parseAtxHeading } from './text/markdown';
import { trimSlashes, trimTrailingSlashes } from './text/slashes';
import { plainHeading } from './text/slug';

/** A page to write: what the index was built from, with its content as Markdown. */
export interface LlmsPage {
  /** The page's URL on the site, as the index has it: `/docs/intro`, with any base path. */
  url: string;
  title: string;
  /** A one-line summary, listed after the page's link. */
  description?: string;
  /** The page's content as Markdown. A leading `# Title` is kept as the page's H1. */
  content: string;
  /** The `llms.txt` section to list it under. Default: from the first part of its path. */
  section?: string;
}

/** Which files to write; each is on unless set to `false`. */
export interface LlmsOutputs {
  /** `llms.txt`. */
  index?: boolean;
  /** `llms-full.txt`. */
  full?: boolean;
  /** A `.md` copy of each page. */
  markdown?: boolean;
}

export interface LlmsSite {
  /** The H1 of `llms.txt`: the site's name. */
  title: string;
  /** The summary quoted under it. */
  description?: string;
  /**
   * The site's origin, as `https://docs.example.com`, to link pages absolutely, as `llms.txt`
   * should. Without it, links are root-relative.
   */
  url?: string;
  /**
   * The path the site is served under, as `/docs/` for a Docusaurus `baseUrl`, where `llms.txt`
   * is served and which page URLs start with. Default `/`.
   */
  base?: string;
  /** The site's MCP endpoint, absolute, to point agents at. */
  mcp?: string;
}

/** A file to write, at a path relative to the site's output folder for `base`. */
export interface LlmsFile {
  /** `llms.txt`, `llms-full.txt` or `docs/intro.md`: relative, with `/` separators. */
  path: string;
  content: string;
}

/**
 * The path, relative to the output folder for `base`, of a page's Markdown copy: its URL's path
 * without `base`, a trailing slash or an `.html` ending, plus `.md`; the root is `index.md`.
 * `null` for a URL on another site.
 */
export function markdownPath(url: string, base = '/'): string | null {
  const path = pathUnder(url, base);
  if (path === null) return null;
  return `${decoded(trimSlashes(path.replace(/(?:\/index)?\.html?$/i, ''))) || 'index'}.md`;
}

/**
 * The path of `url` under `base`, as it is written (not decoded), without a query or a hash:
 * `/docs/intro/` under `/docs/` is `/intro/`. `null` for a URL that cannot be parsed.
 */
export function pathUnder(url: string, base = '/'): string | null {
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0] ?? path;
  const prefix = trimTrailingSlashes(base);
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`)))
    path = path.slice(prefix.length);
  return path;
}

/** `path` decoded, as a file is named, or as it is when it does not decode. */
export function decoded(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * The path of each page's Markdown copy, relative to the output folder for `base`, as
 * `markdownPath` has it: pages in order, leaving out a page on another site and one whose copy
 * an earlier page already has.
 */
export function markdownCopies(pages: readonly LlmsPage[], base = '/'): Map<LlmsPage, string> {
  const copies = new Map<LlmsPage, string>();
  const taken = new Set<string>();
  for (const page of pages) {
    const path = markdownPath(page.url, base);
    if (!path || taken.has(path)) continue;
    taken.add(path);
    copies.set(page, path);
  }
  return copies;
}

/** A host no URL has, to resolve root-relative URLs with `URL` and tell them from absolute ones. */
const NOWHERE = 'https://ondocs.invalid';

/**
 * Markdown read from the file `file` (its path from the content folder, as `guide/index.md`),
 * with each relative link and image resolved, so it works from the page's `.md` copy and from
 * `llms-full.txt`. A copy is not always in its file's folder: `content/index.md` is `/docs.md`,
 * where `./setup.md` would be `/setup.md`. A link to another page's file becomes what `page`
 * returns for that file, its copy or its URL; any other relative link is resolved against
 * `folder`, the URL of the file's folder, as `/docs/guide/`. Fragments, root-relative and
 * absolute links stay as they are.
 */
export function resolveMarkdownLinks(
  markdown: string,
  file: string,
  folder: string,
  page: (file: string) => string | undefined,
): string {
  const root = `${NOWHERE}/content/`;
  const dir = file
    .split('/')
    .slice(0, -1)
    .map((segment) => `${encodeURIComponent(segment)}/`)
    .join('');
  return mapLinkDestinations(markdown, (destination) => {
    if (!destination || /^(?:[a-z][a-z\d+.-]*:|[/#?])/i.test(destination)) return null;
    try {
      const target = new URL(destination, `${root}${dir}`);
      if (target.href.startsWith(root)) {
        const path = decoded(target.pathname.slice('/content/'.length)).normalize('NFC');
        const href = page(path);
        if (href !== undefined) return `${href}${target.search}${target.hash}`;
      }
      const resolved = new URL(destination, new URL(folder, `${NOWHERE}/`));
      return resolved.origin === NOWHERE
        ? `${resolved.pathname}${resolved.search}${resolved.hash}`
        : resolved.href;
    } catch {
      return null;
    }
  });
}

/** `path` (relative to `base`) from the site's root: `/docs/` and `intro.md` → `/docs/intro.md`. */
export function rootedPath(path: string, base = '/'): string {
  const prefix = `/${trimSlashes(base)}/`.replace(/^\/\/$/, '/');
  return `${prefix}${path}`;
}

/** `href` with what would end a Markdown link early, spaces and parentheses, encoded. */
const linkSafe = (href: string): string =>
  href.replace(/[\s()]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)));

/**
 * `path` (relative to `base`, a file's path as `markdownPath` has it) as a URL on the site:
 * absolute with `site.url`, else root-relative, and encoded either way, so `getting started.md`
 * is a link that works.
 */
function siteHref(path: string, site: LlmsSite): string {
  const rooted = rootedPath(path.split('/').map(encodeURIComponent).join('/'), site.base);
  return linkSafe(site.url ? new URL(rooted, site.url).href : rooted);
}

/** A page's HTML URL, absolute with `site.url`. */
function pageHref(url: string, site: LlmsSite): string {
  if (/^https?:\/\//i.test(url) || !site.url) return linkSafe(url);
  return linkSafe(new URL(url, site.url).href);
}

/** Whitespace, and the glyphs a permalink in a heading is written as. */
const GLYPH = /[\s#¶§\u200B-\u200D\u2060\uFEFF]/;

/**
 * Heading text to compare, without the permalink glyphs a page's title can keep from its `<h1>`
 * ("Installation¶", "Installation #") and the content's heading has not, and in lowercase. A
 * loop, not `[…]+$`, which backtracks over a long run of them inside the text.
 */
function bareHeading(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && GLYPH.test(text.charAt(start))) start += 1;
  while (end > start && GLYPH.test(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end).replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The page's content without a leading H1 that repeats its title, which the copy writes as its
 * H1. An H1 that says something else, as a Markdown file's under a frontmatter `title`, stays.
 *
 * The H1 is Markdown, and is compared as the text it renders. The title is text that can read as
 * Markdown ("The <Ask> component", "__init__"), or be Markdown (a frontmatter "Using `useAsk`"),
 * so either reading of it matches.
 */
function splitTitle(page: LlmsPage): string {
  const content = page.content.replace(/^\s+/, '');
  const line = content.split('\n', 1)[0] ?? '';
  const heading = parseAtxHeading(line);
  if (heading?.level !== 1) return content;
  // Without a `{#id}`, which is not part of the text.
  const text = heading.text.replace(/\s*\{#[^\s{}]+\}$/, '');
  const plain = bareHeading(plainHeading(text));
  const same =
    plain === bareHeading(page.title) ||
    plain === bareHeading(plainHeading(page.title)) ||
    bareHeading(text) === bareHeading(page.title);
  return same ? content.slice(line.length).replace(/^\s+/, '') : content;
}

/**
 * A section heading from a path segment: `getting-started` → `Getting started`, and a word of
 * three letters or fewer, as `api` or `cli`, in capitals.
 */
function humanize(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  if (!words) return 'Docs';
  if (/^[a-z]{1,3}$/i.test(words)) return words.toUpperCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * The `llms.txt` sections, in order of first appearance: a page's own `section`, else the first
 * segment of its path below what every page's path shares, named after the page at that segment
 * when there is one. Pages at the top go first, under "Docs", or under "Pages" when another
 * section is called "Docs": a Docusaurus site's own pages, beside its `/docs/`.
 */
function sections(pages: readonly LlmsPage[], site: LlmsSite): [string, LlmsPage[]][] {
  const paths = pages.map((page) =>
    (markdownPath(page.url, site.base) ?? '')
      .replace(/\.md$/, '')
      .split('/')
      .filter((part) => part && part !== 'index'),
  );
  // The segments every page shares, so `/docs/a` and `/docs/b` are not all under "Docs".
  let shared = 0;
  const first = paths[0] ?? [];
  while (
    shared < first.length &&
    paths.every((parts) => parts.length > shared && parts[shared] === first[shared])
  ) {
    shared += 1;
  }
  const titleAt = new Map<string, string>();
  pages.forEach((page, i) => {
    const parts = paths[i] ?? [];
    if (parts.length === shared + 1) titleAt.set(parts.join('/'), page.title);
  });
  const groups = new Map<string, LlmsPage[]>();
  // The pages at the top, which no section name can be.
  const TOP = '\u0000';
  pages.forEach((page, i) => {
    const parts = paths[i] ?? [];
    let name = page.section;
    if (!name) {
      const key = parts.slice(0, shared + 1).join('/');
      name = parts.length <= shared + 1 ? TOP : (titleAt.get(key) ?? humanize(parts[shared] ?? ''));
    }
    const group = groups.get(name) ?? [];
    group.push(page);
    groups.set(name, group);
  });
  const top = groups.get(TOP);
  groups.delete(TOP);
  const atTop = top && groups.has('Docs') ? 'Pages' : 'Docs';
  if (top) groups.set(atTop, [...top, ...(groups.get(atTop) ?? [])]);
  // Top-level pages first, then the rest as they come.
  return [...groups].sort(([a], [b]) => Number(b === atTop) - Number(a === atTop));
}

/** One line of Markdown: newlines and runs of spaces collapsed. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The files to write for `pages`: `llms.txt`, `llms-full.txt` and a `.md` per page, each unless
 * `outputs` turns it off. Pages keep their order; a page on another site gets no `.md` copy.
 */
export function buildLlmsFiles(
  pages: readonly LlmsPage[],
  site: LlmsSite,
  outputs: LlmsOutputs = {},
): LlmsFile[] {
  const files: LlmsFile[] = [];
  const index = outputs.index ?? true;
  const full = outputs.full ?? true;
  const markdown = outputs.markdown ?? true;
  const llmsTxt = siteHref('llms.txt', site);
  const fullTxt = siteHref('llms-full.txt', site);

  const copies = markdown ? markdownCopies(pages, site.base) : new Map<LlmsPage, string>();
  for (const [page, path] of copies) {
    const pointer = index
      ? `> From ${oneLine(site.title)}. Every page, as Markdown: ${llmsTxt}\n\n`
      : '';
    files.push({
      path,
      content: `${pointer}# ${oneLine(page.title)}\n\n${splitTitle(page)}`.trimEnd() + '\n',
    });
  }

  if (index) {
    const lines = [`# ${oneLine(site.title)}`, ''];
    if (site.description?.trim()) lines.push(`> ${oneLine(site.description)}`, '');
    if (markdown) lines.push('Each page links to its Markdown copy: its URL plus `.md`.', '');
    if (full) lines.push(`Every page in one file: ${fullTxt}`, '');
    if (site.mcp) {
      lines.push(
        `Agents can search these docs over MCP, with search, fetch and list_pages tools: ${site.mcp}`,
        '',
      );
    }
    for (const [name, group] of sections(pages, site)) {
      lines.push(`## ${oneLine(name)}`, '');
      for (const page of group) {
        const copy = copies.get(page);
        const href = copy ? siteHref(copy, site) : pageHref(page.url, site);
        const label = oneLine(page.title).replace(/[[\]\\]/g, '\\$&');
        const note = page.description?.trim() ? `: ${oneLine(page.description)}` : '';
        lines.push(`- [${label}](${href})${note}`);
      }
      lines.push('');
    }
    files.push({ path: 'llms.txt', content: lines.join('\n').trimEnd() + '\n' });
  }

  if (full) {
    const parts = [`# ${oneLine(site.title)}`];
    if (site.description?.trim()) parts.push(`> ${oneLine(site.description)}`);
    for (const page of pages) {
      parts.push(
        `---\n\n# ${oneLine(page.title)}\n\nSource: ${pageHref(page.url, site)}\n\n${splitTitle(page)}`.trimEnd(),
      );
    }
    files.push({ path: 'llms-full.txt', content: `${parts.join('\n\n')}\n` });
  }
  return files;
}
