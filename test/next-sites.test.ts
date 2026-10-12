// The URLs ondocs gives the pages of a Fumadocs site and a Nextra site. test/fixtures/fumadocs-site
// is what create-fumadocs-app 16.2.18 makes, and test/fixtures/nextra-site is Nextra 4.6.1's
// docs-theme example, each with a page for every rule that moves one. The URLs expected here are
// the routes `next build` gave those pages.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '../src/cli/main';
import { chunkDocument } from '../src/chunk';
import { detectFramework, frameworkUrl, loadDirectory } from '../src/node';
import { nextHeadingIds, nextRouting, nextSite } from '../src/node/next';

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

const anchors = async (directory: string, id: string) => {
  const page = (await loadDirectory(directory, { framework: 'auto' })).find(
    (document) => document.id === id,
  );
  if (!page) throw new Error(`${id} was not loaded`);
  return chunkDocument(page).map(({ heading, anchor }) => [heading, anchor]);
};

/** Runs `ondocs index` in test/fixtures, and returns what it printed. */
const cli = async (args: string[]) => {
  const stdout: string[] = [];
  const code = await main(args, {
    cwd: fixtures,
    env: {},
    stdout: (line) => stdout.push(line),
    stderr: (line) => stdout.push(line),
  });
  expect(code).toBe(0);
  return stdout;
};

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
      'getting-started/page.mdx': '/docs/getting-started/page',
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
    // Nextra renders the pages of src/app too.
    expect(await nextSite(nextraApp)).toEqual({ routing: 'app', nextra: true });
    expect(await nextSite(fumadocs)).toEqual({ routing: 'fumadocs', nextra: false });
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

  it('slugs a mixed-case `[#id]` in src/app too, as Nextra renders it there', async () => {
    // `## Upgrade [#Upgrade-Guide]` renders as `id="upgrade-guide"` in an app page as well.
    expect(await anchors(nextraApp, 'anchor-case/page.mdx')).toEqual([
      ['Upgrade', 'upgrade-guide'],
    ]);
  });

  it('leaves footnote references out of a heading, as Nextra leaves them out of its id', async () => {
    // The starter's `### Install Next.js, Nextra and React [^1]` renders as
    // `id="install-nextjs-nextra-and-react-"`: the space before the reference stays.
    expect(await anchors(nextraContent, 'get-started.mdx')).toEqual([
      ['Quick start with Vercel', 'quick-start-with-vercel'],
      ['Create manually', 'create-manually'],
      ['Create manually › Install Next.js, Nextra and React', 'install-nextjs-nextra-and-react-'],
      ['Create manually › Install the docs theme', 'install-the-docs-theme-'],
    ]);
    // The page's `.md` copy keeps them as written.
    const copies = await loadDirectory(nextraContent, { framework: 'auto', markdown: true });
    expect(copies.find((document) => document.id === 'get-started.mdx')?.content).toContain(
      '### Install Next.js, Nextra and React [^1]',
    );
  });

  it('gives each content page the URL Nextra serves it at, under contentDirBasePath', async () => {
    expect(await urls(nextraContent, '/docs')).toEqual({
      // Nextra keeps `(group)` folders in the URL, and serves `_` files and folders.
      '(group)/grouped.mdx': '/docs/(group)/grouped',
      '(group)/links.mdx': '/docs/(group)/links',
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
      'anchor-case/page.mdx': '/anchor-case',
      'guides/(setup)/install/page.mdx': '/guides/install',
      'guides/page.mdx': '/guides',
    });
    const [install] = await loadDirectory(join(nextraApp, 'guides/(setup)'), { framework: 'auto' });
    if (!install) throw new Error('install/page.mdx was not loaded');
    expect(chunkDocument(install).map(({ anchor }) => anchor)).toContain('docker');
  });

  it("resolves a (group) page's relative links in its .md copy from the page's folder", async () => {
    const out = await mkdtemp(join(tmpdir(), 'ondocs-next-'));
    await cli([
      'index',
      'nextra-site/src/content',
      '--base-url',
      '/docs',
      '-e',
      'none',
      '-o',
      join(out, 'ask-index.json'),
      '--llms-txt',
      join(out, 'llms'),
    ]);
    // The page is /docs/(group)/links, so its folder is /docs/(group)/, as Nextra keeps it.
    const copy = await readFile(join(out, 'llms/docs/(group)/links.md'), 'utf8');
    expect(copy).toContain('[a page next to it](/docs/(group)/grouped)');
    expect(copy).toContain("[that page's file](/docs/(group)/grouped.md)");
    expect(copy).toContain('[a page above it](/docs/get-started)');
    expect(copy).toContain('![A diagram](/docs/(group)/diagram.svg)');
    await rm(out, { recursive: true, force: true });
  });

  it('says which rules the CLI follows', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ondocs-next-'));
    const said = async (dir: string) =>
      (await cli(['index', dir, '-e', 'none', '-o', join(out, 'ask-index.json')]))[0];
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

describe('frameworkUrl', () => {
  it("gives every page the URL loadDirectory gives it, given its folder's routing", async () => {
    for (const [directory, baseUrl] of [
      [fumadocs, '/docs'],
      [nextraContent, '/docs'],
      [nextraApp, '/'],
    ] as const) {
      const routing = await nextRouting(directory);
      for (const { id, url } of await loadDirectory(directory, { framework: 'auto', baseUrl })) {
        expect([id, frameworkUrl(id, {}, 'next', baseUrl, { routing })]).toEqual([id, url]);
      }
    }
    // A content folder's page.mdx is a page of its own, in Fumadocs and in Nextra.
    expect(
      frameworkUrl('getting-started/page.mdx', {}, 'next', '/docs', { routing: 'fumadocs' }),
    ).toBe('/docs/getting-started/page');
    expect(frameworkUrl('page.mdx', {}, 'next', '/docs', { routing: 'nextra' })).toBe('/docs/page');
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
        { nextra: false },
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
    expect(nextHeadingIds('## Upgrade [#Upgrade-Guide]', { nextra: true })).toBe(
      '## Upgrade {#upgrade-guide}',
    );
  });
});
