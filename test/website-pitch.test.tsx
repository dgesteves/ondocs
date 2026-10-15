// @vitest-environment jsdom
// The pitch the README leads with, open-source Ask AI first and the MCP server second, is the one
// the website's llms.txt and footer and the example sites' descriptions give: none of them still
// says ondocs makes docs "answerable by people and by agents".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { HOME_DESCRIPTION } from '../examples/nextjs/lib/site';

const root = join(import.meta.dirname, '..');
const site = join(root, 'examples/nextjs');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

/** The README's line under its heading, without the bold: the pitch in full. */
const pitch = (read('README.md').split('\n')[2] ?? '').replace(/\*\*/g, '');
/** The pitch in one sentence, where there is no room for more. */
const SHORT = 'Open-source Ask AI for your docs, with an MCP server for agents.';

const OLD = [/answerable by people and by agents/i, /an ask box for your docs/i];
// Changelogs keep what was published; these two tests name the old pitch to rule it out.
const KEEP = [
  /(?:^|\/)changelog\.md$/i,
  /^test\/(?:website-pitch\.test\.tsx|readme-claims\.test\.ts)$/,
];
const BINARY = /\.(?:png|jpe?g|webp|gif|ico|svg|mp4|webm|woff2?|ttf|pdf)$/i;

describe('the pitch on the website and the example sites', () => {
  it('is the README’s: open-source Ask AI, then the MCP server', () => {
    expect(pitch).toMatch(/^Open-source Ask AI for your docs\. .*an MCP server for coding agents/);
  });

  it('opens the website’s llms.txt', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(site);
    const { GET } = await import('../examples/nextjs/app/llms.txt/route');
    const summary = (await (await GET()).text()).split('\n').find((line) => line.startsWith('> '));
    expect(summary?.slice(0, pitch.length + 2)).toBe(`> ${pitch}`);
  });

  it('opens its llms-full.txt', async () => {
    // Imported by path, so the typecheck does not follow it into the site's JavaScript.
    const file = 'ondocs.config.mjs';
    const { default: config } = (await import(/* @vite-ignore */ `../examples/nextjs/${file}`)) as {
      default: { llmsTxt: { description: string } };
    };
    expect(config.llmsTxt.description).toBe(pitch);
  });

  it('is in the website’s footer, in one sentence', async () => {
    const { SiteFooter } = await import('../examples/nextjs/components/site-footer');
    document.body.innerHTML = renderToStaticMarkup(<SiteFooter />);
    const about = document.querySelector('.footer-about p:not(.footer-brand)')?.textContent ?? '';
    expect(about.slice(0, SHORT.length)).toBe(SHORT);
  });

  it('describes the VitePress demo as the website’s home page does, and is Docusaurus’s tagline', () => {
    // VitePress's description heads its llms.txt and is the meta description of a page without
    // its own, where search results show about 160 characters. Docusaurus's tagline heads its
    // llms.txt, and is in the JavaScript every page loads.
    const vitepress = /\bdescription:\s*'([^']*)'/.exec(
      read('examples/vitepress/.vitepress/config.mts'),
    );
    expect(vitepress?.[1]).toBe(HOME_DESCRIPTION);
    const docusaurus = /\btagline:\s*'([^']*)'/.exec(
      read('examples/docusaurus/docusaurus.config.ts'),
    );
    expect(docusaurus?.[1]).toBe(SHORT);
  });

  it('has no copy of the old pitch left', () => {
    const stale = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((file) => file && !BINARY.test(file) && !KEEP.some((keep) => keep.test(file)))
      .filter((file) => {
        const full = join(root, file);
        if (!existsSync(full)) return false;
        const text = readFileSync(full, 'utf8');
        return OLD.some((old) => old.test(text));
      });
    expect(stale).toEqual([]);
  });
});
