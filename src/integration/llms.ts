// Writing llms.txt, llms-full.txt and the pages' .md copies into a build, and linking each page
// to its copy: what the plugins and the CLI share. Node.js only.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  buildLlmsFiles,
  decoded,
  markdownCopies,
  pathUnder,
  rootedPath,
  type LlmsOutputs,
  type LlmsPage,
  type LlmsSite,
} from '../llms';
import type { Logger } from './build';

/**
 * The plugins' `llmsTxt` option: `false` writes none of the files, an object turns off each one
 * and names the site.
 */
export type LlmsTxtOption =
  | boolean
  | {
      /** `llms.txt`: the site's title and summary and a link to every page. Default `true`. */
      index?: boolean;
      /** `llms-full.txt`: every page in one file. Default `true`. */
      full?: boolean;
      /**
       * A Markdown copy of each page, at its URL plus `.md`, which the plugins link from the
       * page's `<head>`. Default `true`.
       */
      markdown?: boolean;
      /** The H1 of `llms.txt`. Default: the site's title. */
      title?: string;
      /** The summary under it. Default: the site's tagline or description. */
      description?: string;
    };

/** Which of the three files a plugin writes, and who already writes one instead. */
export type LlmsOutput = keyof Required<LlmsOutputs>;

const FILE_OF: Record<Exclude<LlmsOutput, 'markdown'>, string> = {
  index: 'llms.txt',
  full: 'llms-full.txt',
};

/** The outputs `option` turns on: all three by default, none for `false`. */
export function llmsOutputs(option: LlmsTxtOption | undefined): Required<LlmsOutputs> {
  if (option === false) return { index: false, full: false, markdown: false };
  const given = typeof option === 'object' ? option : {};
  return {
    index: given.index ?? true,
    full: given.full ?? true,
    markdown: given.markdown ?? true,
  };
}

export interface WriteLlmsFilesOptions {
  /** The pages, such as `loadBuiltPage(…, { markdown: true }).page` for each indexed page. */
  pages: readonly LlmsPage[];
  /** The site's title, summary, URL, base path and MCP endpoint, for `llms.txt`. */
  site: LlmsSite;
  /** Which files to write: `llmsOutputs(options.llmsTxt)`. */
  outputs: Required<LlmsOutputs>;
  /** The outputs another plugin of the site writes, by output, with that plugin's name. */
  owners?: ReadonlyMap<LlmsOutput, string>;
  /** The build output folder that `site.base` is served from. */
  dir: string;
  /** How the log refers to `dir`, e.g. `build/`. */
  label: string;
  log: Logger;
  /** Replace files that are there, as the CLI does in the folder it is told to write to. */
  overwrite?: boolean;
  /**
   * Link each page to its `.md` copy: a `<link rel="alternate" type="text/markdown">` in the
   * `<head>` of the page's HTML in `dir`, which agents follow to the copy. The value is how the
   * framework writes pages, as `readBuiltHtml` takes it: `'directory'` (`guide/index.html`) or
   * `'file'` (`guide.html`). A URL ending in `/` or `.html` says which itself. Default: no links,
   * as the CLI writes the files for pages it did not build.
   */
  linkPages?: 'directory' | 'file';
}

/**
 * Writes the files for `pages` into `dir`, leaving out the outputs another plugin writes
 * (`owners`: output → plugin name) and never replacing a file already there, which came from
 * the site's static files or another plugin. Says what it wrote, and what it left alone. Never
 * writes outside `dir`: a page whose URL leads out of it, as `/../../AGENTS`, gets no copy.
 */
export async function writeLlmsFiles({
  pages,
  site,
  outputs,
  owners = new Map(),
  dir,
  label,
  log,
  overwrite = false,
  linkPages,
}: WriteLlmsFilesOptions): Promise<void> {
  const enabled = {
    index: outputs.index && !owners.has('index'),
    full: outputs.full && !owners.has('full'),
    markdown: outputs.markdown && !owners.has('markdown'),
  };
  for (const [output, owner] of owners) {
    if (!outputs[output]) continue;
    const what = output === 'markdown' ? 'the pages’ .md copies' : FILE_OF[output];
    log.info(`${owner} writes ${what}, so ondocs does not.`);
  }
  if (!enabled.index && !enabled.full && !enabled.markdown) return;

  const files = buildLlmsFiles(pages, site, enabled);
  const kept: string[] = [];
  const outside: string[] = [];
  let written = 0;
  for (const file of files) {
    const target = inside(dir, file.path);
    if (target === undefined) {
      outside.push(file.path);
      continue;
    }
    if (!overwrite && existsSync(target)) {
      kept.push(file.path);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    written += 1;
  }
  const pagesWritten = files.filter(
    (file) =>
      file.path.endsWith('.md') && !kept.includes(file.path) && !outside.includes(file.path),
  ).length;
  const named = [
    enabled.index && !kept.includes('llms.txt') ? 'llms.txt' : null,
    enabled.full && !kept.includes('llms-full.txt') ? 'llms-full.txt' : null,
    pagesWritten > 0 ? `${String(pagesWritten)} .md pages` : null,
  ].filter(Boolean);
  if (written > 0) log.info(`Wrote ${named.join(', ')} → ${label}`);
  if (kept.length > 0) {
    const sample = kept.slice(0, 3).join(', ');
    const more = kept.length > 3 ? ` and ${String(kept.length - 3)} more` : '';
    log.warn(
      `Left ${sample}${more} as they were: the build already has them, from the site's static ` +
        'files or another plugin. Set llmsTxt: false (or turn off that file) to stop this warning.',
    );
  }
  if (outside.length > 0) {
    const sample = outside.slice(0, 3).join(', ');
    const more = outside.length > 3 ? ` and ${String(outside.length - 3)} more` : '';
    log.warn(
      `Left out ${sample}${more}: their pages’ URLs lead out of ${label}. Give each page a ` +
        'path with no . or .. segment.',
    );
  }
  // Every copy but those is in `dir` now, written or already there.
  if (enabled.markdown && linkPages) {
    for (const [page, copy] of markdownCopies(pages, site.base)) {
      if (outside.includes(copy)) continue;
      const html = builtHtmlFile(dir, page.url, site.base, linkPages);
      const href = rootedPath(copy.split('/').map(encodeURIComponent).join('/'), site.base);
      if (html) rewrite(html, (text) => withMarkdownLink(text, href));
    }
  }
}

/**
 * The HTML file the build wrote for the page at `url`, in `dir`, the output folder for `base`:
 * the one a URL ending in `.html` names, `guide/index.html` for one ending in `/`, and else as
 * `layout` has it, trying the other layout second, as `readBuiltHtml` does. `undefined` when
 * there is none.
 */
function builtHtmlFile(
  dir: string,
  url: string,
  base: string | undefined,
  layout: 'directory' | 'file',
): string | undefined {
  const under = pathUnder(url, base);
  if (under === null) return undefined;
  const path = decoded(under).replace(/^\/+/, '');
  const clean = path.replace(/\/+$/, '');
  const candidates = /\.html?$/i.test(path)
    ? [path]
    : clean === ''
      ? ['index.html']
      : path.endsWith('/') || layout === 'directory'
        ? [`${clean}/index.html`, `${clean}.html`]
        : [`${clean}.html`, `${clean}/index.html`];
  return candidates
    .map((file) => inside(dir, file))
    .find((file): file is string => file !== undefined && existsSync(file));
}

/**
 * The file at `path` (relative, with `/` separators) in `dir`, or `undefined` when `path` leads
 * out of `dir`, as `../../AGENTS.md` does, or is `dir` itself.
 */
function inside(dir: string, path: string): string | undefined {
  const root = resolve(dir);
  const target = resolve(root, ...path.split('/'));
  const rel = relative(root, target);
  return rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    ? undefined
    : target;
}

const HEAD_END =
  /<!--[\s\S]*?-->|<(script|style|template|title|noscript)\b[\s\S]*?<\/\1\s*>|<\/head\s*>/gi;

/**
 * `html` with `<link rel="alternate" type="text/markdown" href="…">` to `href` at the end of its
 * `<head>`. `null` when its head links a Markdown copy already, or it has no `</head>`.
 */
export function withMarkdownLink(html: string, href: string): string | null {
  // The first </head> that is not text in a comment, a script or the like.
  let end: number | undefined;
  for (const match of html.matchAll(HEAD_END)) {
    if (!/^<\/head/i.test(match[0])) continue;
    end = match.index;
    break;
  }
  if (end === undefined) return null;
  const head = html.slice(0, end);
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  if (links.some((link) => /\btype\s*=\s*["']?text\/markdown["'\s/>]/i.test(link))) return null;
  const tag = `<link rel="alternate" type="text/markdown" href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  return `${head}${tag}${html.slice(end)}`;
}

/**
 * Changes a file in one step: read, changed, and written to a file beside it that then takes its
 * place, so a plugin that reads it at the same time (Docusaurus runs every plugin's `postBuild`
 * at once) reads it whole, before or after, and none of its own changes in between are lost.
 * Nothing is written when `change` returns `null`.
 */
function rewrite(file: string, change: (text: string) => string | null): void {
  const changed = change(readFileSync(file, 'utf8'));
  if (changed === null) return;
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, changed, 'utf8');
  try {
    renameSync(temporary, file);
  } catch {
    // Windows refuses to replace a file another process has open: write it in place.
    rmSync(temporary, { force: true });
    writeFileSync(file, changed, 'utf8');
  }
}
