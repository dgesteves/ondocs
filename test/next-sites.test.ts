// The URLs ondocs gives the pages of a Fumadocs site and a Nextra site. test/fixtures/fumadocs-site
// is what create-fumadocs-app 16.2.18 makes, and test/fixtures/nextra-site is Nextra 4.6.1's
// docs-theme example, each with a page for every rule that moves one. The URLs expected here are
// the routes `next build` gave those pages.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '../src/cli/main';
import { chunkDocument } from '../src/chunk';
import { detectFramework, loadDirectory } from '../src/node';
import { nextHeadingIds, nextRouting } from '../src/node/next';

const fixtures = join(import.meta.dirname, 'fixtures');
const fumadocs = join(fixtures, 'fumadocs-site/content/docs');
const nextraContent = join(fixtures, 'nextra-site/src/content');
const nextraApp = join(fixtures, 'nextra-site/src/app');

const urls = async (directory: string, baseUrl?: string) =>
  Object.fromEntries(
    (await loadDirectory(directory, { framework: 'auto', ...(baseUrl ? { baseUrl } : {}) })).map(
      (document) => [document.id, document.url],
    ),
  );

describe('a Fumadocs site', () => {
  it('is read as Fumadocs reads content/docs', async () => {
    expect(await detectFramework(fumadocs)).toBe('next');
    expect(await nextRouting(fumadocs)).toBe('fumadocs');
    // A Next.js site's own content folder, as this repository's website has, by the same rules.
    const website = join(import.meta.dirname, '../examples/nextjs/content/docs');
    expect(await nextRouting(website)).toBe('content');
  });

  it('gives each page the URL Fumadocs serves it at', async () => {
    expect(await urls(fumadocs, '/docs')).toEqual({
      // `(group)` folders are left out; `page.mdx` is a page of its own, as is `Index.mdx`.
      '(api)/endpoints/page.mdx': '/docs/endpoints/page',
      '(api)/reference.mdx': '/docs/reference',
      '01-intro.mdx': '/docs/01-intro',
      'Upper/Index.mdx': '/docs/Upper/Index',
      // Fumadocs serves `_` files and folders.
      '_partials/note.mdx': '/docs/_partials/note',
      'guides/configure.md': '/docs/guides/configure',
      'guides/index.mdx': '/docs/guides',
      'guides/install.mdx': '/docs/guides/install',
      'index.mdx': '/docs',
      'test.mdx': '/docs/test',
    });
  });

  it('anchors a `[#id]` heading at its id, and keeps it as written in the .md copy', async () => {
    const [install] = (await loadDirectory(join(fumadocs, 'guides'), { framework: 'auto' })).filter(
      (document) => document.id === 'install.mdx',
    );
    if (!install) throw new Error('install.mdx was not loaded');
    // Fumadocs keeps a custom id as written.
    expect(chunkDocument(install).map(({ heading, anchor }) => [heading, anchor])).toEqual([
      ['Install with npm', 'install-with-npm'],
      ['Use Docker', 'docker'],
      ['Upgrade', 'Upgrade-Guide'],
    ]);
    const copies = await loadDirectory(join(fumadocs, 'guides'), {
      framework: 'auto',
      markdown: true,
    });
    const copy = copies.find((document) => document.id === 'install.mdx');
    expect(copy?.content).toContain('## Use Docker [#docker]');
  });
});

describe('a Nextra site', () => {
  it('is read as Nextra reads its content folder, and as Next.js reads src/app', async () => {
    expect(await detectFramework(nextraContent)).toBe('next');
    expect(await nextRouting(nextraContent)).toBe('nextra');
    expect(await nextRouting(nextraApp)).toBe('app');
    expect(await nextRouting(join(nextraApp, 'guides'))).toBe('app');
  });

  it('anchors a `[#id]` heading at its id, slugged as Nextra slugs it', async () => {
    const pages = await loadDirectory(nextraContent, { framework: 'auto' });
    const anchors = pages.find((document) => document.id === 'anchors.mdx');
    if (!anchors) throw new Error('anchors.mdx was not loaded');
    expect(chunkDocument(anchors).map(({ heading, anchor }) => [heading, anchor])).toEqual([
      ['Custom anchor', 'custom-anchor'],
      ['Upgrade', 'upgrade-guide'],
    ]);
  });

  it('gives each content page the URL Nextra serves it at, under contentDirBasePath', async () => {
    expect(await urls(nextraContent, '/docs')).toEqual({
      // Nextra keeps `(group)` folders in the URL, and serves `_` files and folders.
      '(group)/grouped.mdx': '/docs/(group)/grouped',
      'Upper/Index.mdx': '/docs/Upper/Index',
      '_hidden.mdx': '/docs/_hidden',
      '_partials/note.mdx': '/docs/_partials/note',
      'anchors.mdx': '/docs/anchors',
      'features/mdx.mdx': '/docs/features/mdx',
      'get-started.mdx': '/docs/get-started',
      'index.mdx': '/docs',
      // The starter's own: "this file should not be treated as App Router page".
      'page.mdx': '/docs/page',
      'themes/docs/callout.mdx': '/docs/themes/docs/callout',
      'themes/docs/index.mdx': '/docs/themes/docs',
    });
  });

  it('reads only the page.mdx files of src/app, as Next.js routes them', async () => {
    // Not `_ignored/page.mdx` (a private folder) or `guides/notes/readme.mdx` (not a page).
    expect(await urls(nextraApp)).toEqual({
      'guides/(setup)/install/page.mdx': '/guides/install',
      'guides/page.mdx': '/guides',
    });
    const [install] = await loadDirectory(join(nextraApp, 'guides/(setup)'), { framework: 'auto' });
    if (!install) throw new Error('install/page.mdx was not loaded');
    expect(chunkDocument(install).map(({ anchor }) => anchor)).toContain('docker');
  });

  it('says which rules the CLI follows', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ondocs-next-'));
    const said = async (dir: string) => {
      const stdout: string[] = [];
      const code = await main(['index', dir, '-e', 'none', '-o', join(out, 'ask-index.json')], {
        cwd: fixtures,
        env: {},
        stdout: (line) => stdout.push(line),
        stderr: (line) => stdout.push(line),
      });
      expect(code).toBe(0);
      return stdout[0];
    };
    expect(await said('fumadocs-site/content/docs')).toBe(
      'Reading fumadocs-site/content/docs with Fumadocs URLs (--framework none to turn off)',
    );
    expect(await said('nextra-site/src/content')).toBe(
      'Reading nextra-site/src/content with Nextra URLs (--framework none to turn off)',
    );
    expect(await said('nextra-site/src/app')).toBe(
      'Reading nextra-site/src/app with Next.js App Router (page.mdx) URLs (--framework none to turn off)',
    );
    await rm(out, { recursive: true, force: true });
  });
});

describe('nextHeadingIds', () => {
  it('rewrites `[#id]` at the end of a heading, outside code, and nothing else', () => {
    expect(
      nextHeadingIds(
        [
          '## Use Docker [#docker]',
          '### Spaced  [#spaced]  ',
          'Text that ends in [#not-a-heading]',
          '## An id with spaces [#not an id]',
          '## Brackets [#a]b]',
          '```md',
          '## In code [#code]',
          '```',
        ].join('\n'),
        'fumadocs',
      ).split('\n'),
    ).toEqual([
      '## Use Docker {#docker}',
      '### Spaced {#spaced}',
      'Text that ends in [#not-a-heading]',
      '## An id with spaces [#not an id]',
      '## Brackets [#a]b]',
      '```md',
      '## In code [#code]',
      '```',
    ]);
    expect(nextHeadingIds('## Upgrade [#Upgrade-Guide]', 'nextra')).toBe(
      '## Upgrade {#upgrade-guide}',
    );
  });
});
