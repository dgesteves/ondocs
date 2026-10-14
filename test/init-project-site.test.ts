// `ondocs init --host github-pages` for a project site, served under a path such as
// https://acme.github.io/gadgetly. The Worker reads the index from SITE_URL and links to the
// pages by their URLs in it, so the index the printed command builds must have the same path:
// without it, every citation and MCP link points at https://acme.github.io/guide/..., a 404.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseIndexFile } from '../src';
import { main } from '../src/cli/main';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ondocs-project-site-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function site(contents: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(contents)) {
    await mkdir(join(cwd, path, '..'), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
}

async function run(args: string[], answers?: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const queue = [...(answers ?? [])];
  const code = await main(args, {
    cwd,
    env: {},
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    ...(answers ? { prompt: () => Promise.resolve(queue.shift() ?? '') } : {}),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const siteUrl = async (): Promise<string | undefined> =>
  /"SITE_URL": "([^"]*)"/.exec(
    await readFile(join(cwd, 'ondocs-worker/wrangler.jsonc'), 'utf8'),
  )?.[1];

/** The `ondocs index` arguments of the step init prints, without the embedding. */
const indexArgs = (stdout: string): string[] | undefined =>
  /Build the index with the site: npx ondocs (.+?) -e workers-ai:/.exec(stdout)?.[1]?.split(' ');

const PAGE = (title: string, id: string) =>
  `<html><body><main><h1>${title}</h1><h2 id="${id}">${id}</h2><p>About ${id}.</p></main></body></html>`;

const HUGO = {
  'hugo.toml': 'baseURL = "https://acme.github.io/gadgetly/"\ntitle = "Gadgetly"\n',
  'public/index.html': PAGE('Gadgetly', 'features'),
  'public/guide/config.html': PAGE('Configuration', 'schedule'),
};

describe('ondocs init on a GitHub Pages project site', () => {
  it('prints an index command whose pages are under SITE_URL, as the Worker links to them', async () => {
    await site(HUGO);
    const result = await run(['init', '--host', 'github-pages']);
    expect(result.code).toBe(0);
    expect(await siteUrl()).toBe('https://acme.github.io/gadgetly');
    const args = indexArgs(result.stdout);
    expect(args?.slice(0, 2)).toEqual(['index', 'public']);

    // Build the index as the step says, keyword-only, and resolve its URLs as the Worker's MCP
    // tools do: against SITE_URL's origin.
    expect((await run([...(args ?? []), '-e', 'none'])).code).toBe(0);
    const index = parseIndexFile(await readFile(join(cwd, 'public/ask-index.json'), 'utf8'));
    const urls = index.documents.map((d) => new URL(d.url, 'https://acme.github.io').href).sort();
    expect(urls).toEqual([
      'https://acme.github.io/gadgetly',
      'https://acme.github.io/gadgetly/guide/config.html',
    ]);
    expect(args).toEqual([
      'index',
      'public',
      '-o',
      'public/ask-index.json',
      '--base-url',
      '/gadgetly',
    ]);
  });

  it.each([
    ['Hugo’s baseURL', HUGO, []],
    ['MkDocs’s site_url', { 'mkdocs.yml': 'site_url: https://acme.github.io/gadgetly/\n' }, []],
    [
      'Jekyll’s url and baseurl',
      { '_config.yml': 'url: "https://acme.github.io"\nbaseurl: "/gadgetly"\n' },
      [],
    ],
    [
      '--site-url, for plain HTML',
      { 'public/index.html': PAGE('Gadgetly', 'features') },
      ['--out', 'public', '--site-url', 'https://acme.github.io/gadgetly/'],
    ],
  ] as const)('takes the path from %s', async (_, contents, args) => {
    await site(contents);
    const result = await run(['init', '--host', 'github-pages', ...args]);
    expect(result.code).toBe(0);
    expect(await siteUrl()).toBe('https://acme.github.io/gadgetly');
    expect(indexArgs(result.stdout)?.slice(-2)).toEqual(['--base-url', '/gadgetly']);
  });

  it('takes the path from the URL it was given when the config has a placeholder', async () => {
    await site({ 'hugo.toml': 'baseURL = "https://example.org/"\n' });
    const result = await run(
      ['init', '--host', 'github-pages'],
      ['https://acme.github.io/gadgetly'],
    );
    expect(result.code).toBe(0);
    expect(await siteUrl()).toBe('https://acme.github.io/gadgetly');
    expect(indexArgs(result.stdout)?.slice(-2)).toEqual(['--base-url', '/gadgetly']);
  });

  it('adds no --base-url for a site at the root of its domain', async () => {
    await site({ 'hugo.toml': 'baseURL = "https://acme.github.io/"\n' });
    const user = await run(['init', '--host', 'github-pages']);
    expect(indexArgs(user.stdout)).toEqual(['index', 'public', '-o', 'public/ask-index.json']);

    // --site-url wins over the config, and so does its path.
    await site({ 'hugo.toml': 'baseURL = "https://acme.github.io/gadgetly/"\n' });
    const custom = await run([
      'init',
      '--host',
      'github-pages',
      '--site-url',
      'https://docs.acme.dev',
      '--yes',
    ]);
    expect(await siteUrl()).toBe('https://docs.acme.dev');
    expect(indexArgs(custom.stdout)).toEqual(['index', 'public', '-o', 'public/ask-index.json']);
  });

  it.each([
    ['without the base', 'https://acme.github.io'],
    ['with the base, as VitePress’s own sitemap needs', 'https://acme.github.io/widgetron/'],
  ])('keeps VitePress’s base once in SITE_URL, from a sitemap.hostname %s', async (_, hostname) => {
    await site({
      '.vitepress/config.mts': `import { defineConfig } from 'vitepress';\n\nexport default defineConfig({\n  title: 'Widgetron',\n  base: '/widgetron/',\n  sitemap: { hostname: '${hostname}' },\n});\n`,
    });
    expect((await run(['init', '--host', 'github-pages'])).code).toBe(0);
    expect(await siteUrl()).toBe('https://acme.github.io/widgetron');
  });

  it('keeps Jekyll’s baseurl once when its url has it too', async () => {
    await site({ '_config.yml': 'url: "https://acme.github.io/gadgetly"\nbaseurl: "/gadgetly"\n' });
    expect((await run(['init', '--host', 'github-pages'])).code).toBe(0);
    expect(await siteUrl()).toBe('https://acme.github.io/gadgetly');
  });

  it('appends a base that only looks like the end of the URL’s path', async () => {
    await site({ '_config.yml': 'url: "https://acme.github.io/api-docs"\nbaseurl: "/docs"\n' });
    expect((await run(['init', '--host', 'github-pages'])).code).toBe(0);
    expect(await siteUrl()).toBe('https://acme.github.io/api-docs/docs');
  });
});

describe('the docs of a static site’s index command', () => {
  it.each(['examples/nextjs/content/docs/script-tag.md', 'templates/cloudflare-worker/README.md'])(
    '%s tells a project site to add --base-url',
    async (path) => {
      const text = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
      expect(text).toMatch(
        /project site,? at `https:\/\/user\.github\.io\/repo`[^\n]*`--base-url \/repo`/,
      );
    },
  );
});
