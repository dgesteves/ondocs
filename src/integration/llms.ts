// Writing llms.txt, llms-full.txt and the pages' .md copies into a build: what the plugins and the
// CLI share. Node.js only.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildLlmsFiles, type LlmsOutputs, type LlmsPage, type LlmsSite } from '../llms';
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
      /** A Markdown copy of each page, at its URL plus `.md`. Default `true`. */
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
}

/**
 * Writes the files for `pages` into `dir`, leaving out the outputs another plugin writes
 * (`owners`: output → plugin name) and never replacing a file already there, which came from
 * the site's static files or another plugin. Says what it wrote, and what it left alone.
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
  let written = 0;
  for (const file of files) {
    const target = join(dir, ...file.path.split('/'));
    if (!overwrite && existsSync(target)) {
      kept.push(file.path);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    written += 1;
  }
  const pagesWritten = files.filter(
    (file) => file.path.endsWith('.md') && !kept.includes(file.path),
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
}
