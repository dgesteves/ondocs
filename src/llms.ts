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
  return `${decoded(path.replace(/(?:\/index)?\.html?$/i, '').replace(/^\/+|\/+$/g, '')) || 'index'}.md`;
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
  const prefix = base.replace(/\/+$/, '');
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

/** `path` (relative to `base`) from the site's root: `/docs/` and `intro.md` → `/docs/intro.md`. */
export function rootedPath(path: string, base = '/'): string {
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
  return `${prefix}${path}`;
}

/** `path` (relative to `base`) as a URL on the site: absolute with `site.url`, else root-relative. */
function siteHref(path: string, site: LlmsSite): string {
  const rooted = rootedPath(path, site.base);
  return site.url ? new URL(rooted, site.url).href : rooted;
}

/** A page's HTML URL, absolute with `site.url`. */
function pageHref(url: string, site: LlmsSite): string {
  if (/^https?:\/\//i.test(url) || !site.url) return url;
  return new URL(url, site.url).href;
}

/** The page's content without a leading H1 that repeats its title, and that H1's text. */
function splitTitle(page: LlmsPage): string {
  const content = page.content.replace(/^\s+/, '');
  const first = /^#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(content);
  return first ? content.slice(first[0].length).replace(/^\s+/, '') : content;
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
 * when there is one. Pages at the top go first, under "Docs".
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
  pages.forEach((page, i) => {
    const parts = paths[i] ?? [];
    let name = page.section;
    if (!name) {
      const key = parts.slice(0, shared + 1).join('/');
      name =
        parts.length <= shared + 1 ? 'Docs' : (titleAt.get(key) ?? humanize(parts[shared] ?? ''));
    }
    const group = groups.get(name) ?? [];
    group.push(page);
    groups.set(name, group);
  });
  const entries = [...groups];
  // Top-level pages first, then the rest as they come.
  return entries.sort(([a], [b]) => Number(b === 'Docs') - Number(a === 'Docs'));
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
        const label = oneLine(page.title).replace(/[[\]]/g, '\\$&');
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
