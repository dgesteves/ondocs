// How a Next.js docs site routes its content files. That depends on the folder: Next.js's App
// Router serves the `page.mdx` files in `app`, while Fumadocs and Nextra each read a content
// folder of their own, by rules of their own. Node.js only.

import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { slug } from 'github-slugger';

import { createFenceScanner, parseAtxHeading } from '../text/markdown';

/** A Next.js config, or Fumadocs's `source.config.ts`. */
export const NEXT_CONFIG = /^(?:next\.config\.[cm]?[jt]s|source\.config\.[cm]?ts)$/;

/**
 * - `app`: an App Router folder (`app`, `src/app`, or a folder in one). Only `page.mdx` files are
 *   pages, `(group)` and `@slot` folders are not part of the URL, and `_private` and `[dynamic]`
 *   folders are not routed.
 * - `fumadocs`: a content folder, as Fumadocs reads it. `index.mdx` is its folder's page,
 *   `(group)` folders are not part of the URL, and every other file is a page.
 * - `nextra`: a content folder, as Nextra reads it: the same, but `(group)` folders stay in the
 *   URL.
 * - `content`: any other content folder, read by the site's own code: as Fumadocs reads it.
 */
export type NextRouting = 'app' | 'fumadocs' | 'nextra' | 'content';

/** The Next.js site a folder is in, as far as its URLs and heading ids go. */
export interface NextSite {
  /** How the site routes the folder. */
  routing: NextRouting;
  /**
   * The site depends on `nextra`, which renders the pages of every folder it reads, `app`
   * included: it slugs `[#id]` heading ids there too.
   */
  nextra: boolean;
}

/**
 * The Next.js site that `directory` is in: the nearest folder at or above it with a Next.js
 * config or a `package.json`. A content folder belongs to Nextra or Fumadocs when the site
 * depends on it.
 */
export async function nextSite(directory: string): Promise<NextSite> {
  const start = await realpath(directory).catch(() => resolve(directory));
  for (let dir = start; ; dir = dirname(dir)) {
    const names = await readdir(dir).catch(() => [] as string[]);
    const isSite = names.includes('package.json') || names.some((name) => NEXT_CONFIG.test(name));
    if (!isSite && dir !== dirname(dir)) continue;
    const manifest = await readFile(join(dir, 'package.json'), 'utf8').catch(() => '');
    const nextra = /"nextra"\s*:/.test(manifest);
    // Next.js reads `app` or `src/app`, as Nextra does when it builds its page map.
    if (/^(?:src\/)?app(?:\/|$)/.test(relative(dir, start).split(sep).join('/'))) {
      return { routing: 'app', nextra };
    }
    if (nextra) return { routing: 'nextra', nextra };
    const fumadocs =
      /"fumadocs-(?:core|mdx|ui)"\s*:/.test(manifest) ||
      names.some((name) => /^source\.config\.[cm]?ts$/.test(name));
    return { routing: fumadocs ? 'fumadocs' : 'content', nextra };
  }
}

/** How the Next.js site that `directory` is in routes it; see {@link nextSite}. */
export async function nextRouting(directory: string): Promise<NextRouting> {
  return (await nextSite(directory)).routing;
}

const GROUP = /^\(.+\)$/;

/**
 * The path a file in the folder is served at, without the base URL and the slashes around it, or
 * `null` when it is not a page. `relativePath` uses `/`. Checked against Next.js's
 * `normalizeAppPath`, Fumadocs's `getSlugs` and Nextra's `convertToPageMap`, which all compare
 * names as written: `Index.mdx` and `page.mdx` in a content folder are pages of their own.
 */
export function nextPath(relativePath: string, routing: NextRouting): string | null {
  const dirs = relativePath.split('/');
  const name = (dirs.pop() ?? '').replace(/\.(?:mdx?|markdown|html?)$/i, '');
  if (routing === 'app') {
    if (name !== 'page' || dirs.some((dir) => dir.startsWith('_') || dir.startsWith('['))) {
      return null;
    }
    return dirs.filter((dir) => !GROUP.test(dir) && !dir.startsWith('@')).join('/');
  }
  const folders = routing === 'nextra' ? dirs : dirs.filter((dir) => !GROUP.test(dir));
  return [...folders, ...(name === 'index' ? [] : [name])].join('/');
}

/**
 * Rewrites `## Title [#id]`, the custom heading id Fumadocs and Nextra read, as `## Title {#id}`,
 * which the chunker reads, outside fenced code. Nextra slugs the id (`[#Setup]` is `#setup`), in
 * every folder of its site, and Fumadocs keeps it as written. An id with spaces or brackets stays
 * as written.
 */
export function nextHeadingIds(source: string, { nextra }: Pick<NextSite, 'nextra'>): string {
  if (!source.includes('[#')) return source;
  const scan = createFenceScanner();
  return source
    .split('\n')
    .map((line) => {
      if (scan(line) !== 'prose' || !parseAtxHeading(line)) return line;
      const text = line.trimEnd();
      const open = text.lastIndexOf('[#');
      const id = open === -1 || !text.endsWith(']') ? '' : text.slice(open + 2, -1);
      if (!/^[^\s[\]{}]+$/.test(id)) return line;
      return `${text.slice(0, open).trimEnd()} {#${nextra ? slug(id) : id}}`;
    })
    .join('\n');
}
