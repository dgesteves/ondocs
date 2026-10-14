// The Docusaurus plugin on a site with versioned docs: by default it indexes each docs plugin's
// last version, the one readers land on, and leaves the others out of the index and llms.txt.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ondocs, { type OndocsOptions } from '../src/docusaurus';
import { parseIndexFile } from '../src/index-file';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-docusaurus-versions-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A page as Docusaurus 3 builds it, with its page type on <html> and its text in an <article>. */
const page = (classes: string, title: string, text: string) =>
  `<!doctype html><html lang=en class="${classes}"><head><title>${title} | Acme</title></head><body><main><article><div class=markdown><header><h1>${title}</h1></header><p>${text}</p></div></article></main></body></html>`;
const doc = (version: string, id: string, title: string, text: string) =>
  page(
    `docs-wrapper plugin-docs plugin-id-default docs-version-${version} docs-doc-page docs-doc-id-${id}`,
    title,
    text,
  );

/** What the docs plugin loaded for one instance: each version's path, and which one is last. */
const docsPlugin = (id: string, versions: [name: string, path: string, isLast: boolean][]) => ({
  name: 'docusaurus-plugin-content-docs',
  options: { id },
  content: {
    loadedVersions: versions.map(([versionName, path, isLast]) => ({
      versionName,
      path,
      isLast,
      docs: [],
    })),
  },
});

/**
 * A built site with versioned docs at /docs (2.0, the last version), /docs/next (unreleased)
 * and /docs/1.0, a second, unversioned docs instance at /community, and a blog. A doc whose slug
 * starts like a version's (`nextjs`) belongs to the last version.
 */
async function site(docsBase = '/docs') {
  const at = (path: string) => `${docsBase.replace(/\/$/, '')}${path}`;
  const pages: Record<string, string> = {
    [at('/intro')]: doc('2.0', 'intro', 'Introduction', 'Install version 2.'),
    [at('/nextjs')]: doc('2.0', 'nextjs', 'Next.js', 'Use it with Next.js.'),
    [at('/next/intro')]: doc('current', 'intro', 'Introduction', 'Install the next version.'),
    [at('/next/nextjs')]: doc('current', 'nextjs', 'Next.js', 'Use it with Next.js.'),
    [at('/1.0/intro')]: doc('1.0', 'intro', 'Introduction', 'Install version 1.'),
    '/community/support': doc('current', 'support', 'Support', 'Ask on the forum.'),
    '/blog/release': page('blog-wrapper plugin-blog blog-post-page', 'Release', '2.0 is out.'),
  };
  const outDir = join(root, 'build');
  for (const [route, html] of Object.entries(pages)) {
    await mkdir(join(outDir, route), { recursive: true });
    await writeFile(join(outDir, route, 'index.html'), html);
  }
  return {
    outDir,
    routesPaths: Object.keys(pages),
    plugins: [
      docsPlugin('default', [
        ['current', at('/next'), false],
        ['2.0', docsBase, true],
        ['1.0', at('/1.0'), false],
      ]),
      docsPlugin('community', [['current', '/community', true]]),
      { name: 'docusaurus-plugin-content-blog', options: { id: 'default' }, content: {} },
    ] as { name: string; options?: unknown; content?: unknown }[],
  };
}

const context = {
  siteDir: '',
  siteConfig: { title: 'Acme', url: 'https://acme.dev' },
  baseUrl: '/',
  i18n: { currentLocale: 'en' },
};

async function build(s: Awaited<ReturnType<typeof site>>, options: OndocsOptions = {}) {
  await ondocs({ ...context, siteDir: root }, { embedding: 'none', ...options }).postBuild(s);
  const index = parseIndexFile(await readFile(join(s.outDir, 'ask-index.json'), 'utf8'));
  return index.documents.map((document) => document.url);
}

const ALL = [
  '/blog/release',
  '/community/support',
  '/docs/1.0/intro',
  '/docs/intro',
  '/docs/next/intro',
  '/docs/next/nextjs',
  '/docs/nextjs',
];

describe('ondocs/docusaurus with versioned docs', () => {
  it('indexes the last version of each docs plugin, and every page outside the docs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = await site();
    expect(await build(s)).toEqual([
      '/blog/release',
      '/community/support',
      '/docs/intro',
      '/docs/nextjs',
    ]);
    // llms.txt and the .md copies follow the index.
    const llms = await readFile(join(s.outDir, 'llms.txt'), 'utf8');
    expect(llms).toContain('https://acme.dev/docs/intro.md');
    expect(llms).not.toMatch(/\/docs\/(next|1\.0)\//);
    expect(existsSync(join(s.outDir, 'docs/intro.md'))).toBe(true);
    expect(existsSync(join(s.outDir, 'docs/next/intro.md'))).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "[ondocs] Indexing the last docs version, without /docs/next, /docs/1.0. Set versions: 'all' to index every version.",
    );
  });

  it("indexes every version with versions: 'all'", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await build(await site(), { versions: 'all' })).toEqual(ALL);
  });

  it('keeps the pages around docs served from the site root', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // routeBasePath: '/': the last version is at /, the others at /next and /1.0.
    expect(await build(await site('/'))).toEqual([
      '/blog/release',
      '/community/support',
      '/intro',
      '/nextjs',
    ]);
  });

  it('indexes every version when the docs plugin’s versions cannot be read', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = await site();
    const unread = [
      // No content, as from a plugin that passes on only names and options.
      { name: 'docusaurus-plugin-content-docs' },
      // Content of another shape.
      { name: 'docusaurus-plugin-content-docs', content: { loadedVersions: 'none' } },
      {
        name: 'docusaurus-plugin-content-docs',
        content: { loadedVersions: [{ path: '/docs/next', isLast: false }] },
      },
      // Content that throws as it is read.
      {
        name: 'docusaurus-plugin-content-docs',
        get content(): unknown {
          throw new Error('not loaded');
        },
      },
    ];
    for (const plugin of unread) {
      expect(await build({ ...s, plugins: [plugin] })).toEqual(ALL);
    }
  });

  it('refuses a versions option it does not know', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => ondocs(context, { versions: 'current' as unknown as 'last' })).toThrow(
      "ondocs: versions is 'last' (the default) or 'all', not \"current\".",
    );
  });
});
