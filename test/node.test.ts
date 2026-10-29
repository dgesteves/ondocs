import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chunkDocument } from '../src/chunk';
import { detectFramework, frameworkUrl, loadDirectory } from '../src/node';
import { matchesGlob } from '../src/node/glob';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-node-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ids = async (directory: string, options?: Parameters<typeof loadDirectory>[1]) =>
  (await loadDirectory(directory, options)).map((document) => [document.id, document.url]);

describe('loadDirectory', () => {
  it('keeps .html in the URLs of HTML files, unless the host serves clean URLs', async () => {
    const content = join(root, 'content');
    await mkdir(join(content, 'docs'), { recursive: true });
    await writeFile(join(content, 'docs/install.html'), '<main><h1>Install</h1></main>');
    await writeFile(join(content, 'docs/index.html'), '<main><h1>Docs</h1></main>');
    await writeFile(join(content, 'guide.md'), '# Guide');

    expect(await ids(content)).toEqual([
      ['docs/index.html', '/docs'],
      ['docs/install.html', '/docs/install.html'],
      ['guide.md', '/guide'],
    ]);
    expect(await ids(content, { cleanUrls: true })).toEqual([
      ['docs/index.html', '/docs'],
      ['docs/install.html', '/docs/install'],
      ['guide.md', '/guide'],
    ]);
    // A framework's rules are its own: Docusaurus serves clean URLs.
    expect(await ids(content, { framework: 'docusaurus' })).toContainEqual([
      'docs/install.html',
      '/docs/install',
    ]);
  });

  it('normalizes file names to NFC, so ids and URLs match on every file system', async () => {
    const content = join(root, 'content');
    await mkdir(content);
    // macOS keeps names as created; a file written in decomposed form stays that way.
    await writeFile(join(content, 'café.md'), '# Café\n\nCoffee.');
    expect((await readdir(content))[0]).toBe('café.md');

    const [document] = await loadDirectory(content);
    expect(document?.id).toBe('café.md');
    expect(document?.url).toBe('/café');
    expect(document?.content).toContain('Coffee.');
    // Ignore patterns are written in the same normal form.
    expect(await ids(content, { ignore: ['café.md'] })).toEqual([]);
  });

  it('follows symlinked files and directories, skipping links that loop', async () => {
    const content = join(root, 'content');
    const shared = join(root, 'shared');
    await mkdir(content);
    await mkdir(join(shared, 'dir'), { recursive: true });
    await writeFile(join(content, 'real.md'), 'Real.');
    await writeFile(join(shared, 's.md'), 'Shared file.');
    await writeFile(join(shared, 'dir', 'i.md'), 'Shared directory.');
    await symlink('../shared/s.md', join(content, 'linked.md'));
    await symlink('../shared/dir', join(content, 'linkeddir'));
    // Cycles: a directory linking to itself, and one linking back up to the root.
    await symlink('.', join(shared, 'dir', 'self'));
    await symlink(content, join(shared, 'dir', 'up'));
    await symlink('missing.md', join(content, 'broken.md'));

    expect(await ids(content)).toEqual([
      ['linked.md', '/linked'],
      ['linkeddir/i.md', '/linkeddir/i'],
      ['real.md', '/real'],
    ]);
  });

  it('skips dot-directories and node_modules, and reads files in a stable order', async () => {
    const content = join(root, 'content');
    await mkdir(join(content, '.vitepress'), { recursive: true });
    await mkdir(join(content, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(content, 'b'), { recursive: true });
    await writeFile(join(content, '.vitepress', 'x.md'), 'Hidden.');
    await writeFile(join(content, 'node_modules', 'pkg', 'README.md'), 'Dependency.');
    await writeFile(join(content, '.draft.md'), 'Hidden.');
    await writeFile(join(content, 'b', 'index.md'), 'B.');
    await writeFile(join(content, 'a.md'), 'A.');
    expect(await ids(content)).toEqual([
      ['a.md', '/a'],
      ['b/index.md', '/b'],
    ]);
  });

  it('skips generated 404 pages at any depth, and keeps pages that only look like one', async () => {
    const content = join(root, 'content');
    await mkdir(join(content, 'fr'), { recursive: true });
    await mkdir(join(content, '404'), { recursive: true });
    await mkdir(join(content, 'docs'), { recursive: true });
    await writeFile(join(content, '404.html'), '<main><h1>Page not found</h1></main>');
    await writeFile(join(content, '404.htm'), '<main><h1>Page not found</h1></main>');
    await writeFile(join(content, '404', 'index.html'), '<main><h1>Page not found</h1></main>');
    await writeFile(join(content, 'fr', '404.html'), '<main><h1>Page not found</h1></main>');
    await writeFile(join(content, 'docs', '404-errors.html'), '<main><h1>404 errors</h1></main>');
    await writeFile(join(content, 'docs', 'install.html'), '<main><h1>Install</h1></main>');

    expect(await ids(content)).toEqual([
      ['docs/404-errors.html', '/docs/404-errors.html'],
      ['docs/install.html', '/docs/install.html'],
    ]);
  });

  it('matches --ignore globs without node:path matchesGlob, which is experimental on Node 22', async () => {
    const spy = vi.spyOn(process, 'emitWarning');
    const content = join(root, 'content');
    await mkdir(join(content, 'guides', 'old'), { recursive: true });
    await writeFile(join(content, 'index.md'), 'Home.');
    await writeFile(join(content, 'guides', 'setup.md'), 'Setup.');
    await writeFile(join(content, 'guides', 'old', 'v1.mdx'), 'Old.');
    expect(await ids(content, { ignore: ['guides/**'] })).toEqual([['index.md', '/']]);
    expect(await ids(content, { ignore: ['**/old/**', '*.md'] })).toEqual([
      ['guides/setup.md', '/guides/setup'],
    ]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('framework URLs', () => {
  const write = async (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), text);
    }
  };
  const auto = { framework: 'auto' } as const;

  it('follows Docusaurus: slug, id, number prefixes, folder indexes and partials', async () => {
    await write({
      'website/package.json': '{"name":"site"}',
      'website/docusaurus.config.ts': 'export default {}',
      'website/docs/introduction.md': '---\nslug: /\n---\n# Intro',
      'website/docs/guides/docs/docs-introduction.mdx':
        '---\nid: introduction\nslug: /docs-introduction\n---\n# Docs',
      'website/docs/guides/creating-pages.md': '---\nslug: creating-pages-guide\n---\n# Pages',
      'website/docs/guides/moved.md': '---\nslug: ../moved-out\n---\n# Moved',
      'website/docs/02-tutorial/01-setup.md': '# Setup',
      'website/docs/02-tutorial/tutorial.md': '# Tutorial',
      'website/docs/Category/category.md': '# Category',
      'website/docs/releases/1.0-release.md': '# 1.0',
      'website/docs/releases/2024-12-recap.md': '# Recap',
      'website/docs/raw/01-keep.md': '---\nparse_number_prefixes: false\n---\n# Keep',
      'website/docs/api/plugin.md': '---\nid: plugin-api\n---\n# Plugin',
      // An id is used as written: Docusaurus strips number prefixes from file names only.
      'website/docs/03-ids/01-intro.md': '---\nid: 01-intro\n---\n# Intro',
      'website/docs/03-ids/setup.md': '---\nid: 2-step\n---\n# Two steps',
      'website/docs/03-ids/04-deploy.md': '---\nid: deploy-guide\n---\n# Deploy',
      'website/docs/_partial.mdx': 'Shared text.',
      'website/docs/_snippets/note.md': 'Note.',
    });
    const docs = join(root, 'website/docs');
    expect(await detectFramework(docs)).toBe('docusaurus');
    // Checked against @docusaurus/plugin-content-docs' own getSlug.
    expect(Object.fromEntries(await ids(docs, { ...auto, baseUrl: '/docs' }))).toEqual({
      '02-tutorial/01-setup.md': '/docs/tutorial/setup',
      // Not the folder's page: the index test compares names as written, prefix included.
      '02-tutorial/tutorial.md': '/docs/tutorial/tutorial',
      '03-ids/01-intro.md': '/docs/ids/01-intro',
      '03-ids/04-deploy.md': '/docs/ids/deploy-guide',
      '03-ids/setup.md': '/docs/ids/2-step',
      'Category/category.md': '/docs/Category',
      'api/plugin.md': '/docs/api/plugin-api',
      'guides/creating-pages.md': '/docs/guides/creating-pages-guide',
      'guides/docs/docs-introduction.mdx': '/docs/docs-introduction',
      'guides/moved.md': '/docs/moved-out',
      'introduction.md': '/docs',
      'raw/01-keep.md': '/docs/raw/01-keep',
      'releases/1.0-release.md': '/docs/releases/1.0-release',
      'releases/2024-12-recap.md': '/docs/releases/2024-12-recap',
    });
    // The library keeps paths as they are unless asked.
    expect(await ids(join(docs, 'releases'))).toEqual([
      ['1.0-release.md', '/1.0-release'],
      ['2024-12-recap.md', '/2024-12-recap'],
    ]);
  });

  it('follows Starlight slugs and slugified paths, and Next.js-style content', async () => {
    await write({
      'site/package.json': '{"dependencies":{"@astrojs/starlight":"^1"}}',
      'site/astro.config.mjs': 'export default {}',
      'site/src/content/docs/Getting Started.md': '# Start',
      'site/src/content/docs/guides/i18n.md': '---\nslug: translations\n---\n# i18n',
      'site/src/content/docs/guides/README.md': '# Readme',
      'site/src/content/docs/guides/empty-slug.md': "---\nslug: ''\n---\n# Empty",
      'site/src/content/docs/_shared/served.md': '# Served',
      'site/src/content/docs/_draft.md': '# Draft',
      'next/package.json': '{"name":"docs"}',
      'next/next.config.mjs': 'export default {}',
      'next/content/docs/(root)/cli.mdx': '# CLI',
      'next/content/docs/(root)/index.mdx': '# Home',
      'next/content/docs/(root)/_blocks.mdx': '# Blocks',
      'next/content/docs/getting-started/page.mdx': '# Getting started',
      'next/app/(marketing)/pricing/page.mdx': '# Pricing',
      'next/app/@modal/login/page.mdx': '# Log in',
      'next/app/page.mdx': '# Home',
      'next/app/_lib/page.mdx': '# Private',
      'next/app/blog/[slug]/page.mdx': '# Post',
      'next/app/notes.mdx': '# Notes',
      'plain/(notes)/a.md': '# A',
      'plain/_index.md': '# Section',
    });
    expect(Object.fromEntries(await ids(join(root, 'site/src/content/docs'), auto))).toEqual({
      'Getting Started.md': '/getting-started',
      // Astro skips `_` files, not `_` folders, and only `index` is a folder's page.
      '_shared/served.md': '/_shared/served',
      'guides/README.md': '/guides/readme',
      'guides/empty-slug.md': '/guides/empty-slug',
      'guides/i18n.md': '/translations',
    });
    // A content folder, as Fumadocs reads it: it serves `_blocks` (ui.shadcn.com/docs/_blocks),
    // so it stays, and `page.mdx` is a page of its own.
    expect(
      Object.fromEntries(await ids(join(root, 'next/content/docs'), { ...auto, baseUrl: '/docs' })),
    ).toEqual({
      '(root)/_blocks.mdx': '/docs/_blocks',
      '(root)/cli.mdx': '/docs/cli',
      '(root)/index.mdx': '/docs',
      'getting-started/page.mdx': '/docs/getting-started/page',
    });
    // The App Router: only `page.mdx` files, outside `_private` and `[dynamic]` folders, with
    // `(group)` and `@slot` folders left out.
    expect(Object.fromEntries(await ids(join(root, 'next/app'), auto))).toEqual({
      '(marketing)/pricing/page.mdx': '/pricing',
      '@modal/login/page.mdx': '/login',
      'page.mdx': '/',
    });
    // frameworkUrl, which sees a path and not its folder, reads it as either, unless it is told
    // which rules the folder follows. A file that is not a page by those rules is read as either.
    expect(frameworkUrl('getting-started/page.mdx', {}, 'next', '/docs')).toBe(
      '/docs/getting-started',
    );
    expect(
      frameworkUrl('getting-started/page.mdx', {}, 'next', '/docs', { routing: 'fumadocs' }),
    ).toBe('/docs/getting-started/page');
    expect(frameworkUrl('(marketing)/pricing/page.mdx', {}, 'next', '/', { routing: 'app' })).toBe(
      '/pricing',
    );
    expect(frameworkUrl('notes.mdx', {}, 'next', '/', { routing: 'app' })).toBe('/notes');
    // Without a framework config, paths are kept as they are (Hugo's _index.md is a section page).
    expect(await detectFramework(join(root, 'plain'))).toBe('none');
    expect(await ids(join(root, 'plain'), auto)).toEqual([
      ['(notes)/a.md', '/(notes)/a'],
      ['_index.md', '/'],
    ]);
    // Astro without Starlight is not Starlight.
    await write({ 'astro/package.json': '{"name":"a"}', 'astro/astro.config.mjs': '' });
    expect(await detectFramework(join(root, 'astro'))).toBe('none');
  });

  it('leaves footnote references out of heading anchors where the framework does', async () => {
    const page = [
      '# Setup',
      '## Install [^1]',
      'Run it.',
      '## Use `[^1]` in [^note] text',
      'A.',
      '## Undefined [^x]',
      'B.',
      '[^1]: One.',
      '[^NOTE]: Labels match whatever their case.',
    ].join('\n\n');
    await write({
      'docusaurus/package.json': '{"name":"d"}',
      'docusaurus/docusaurus.config.js': 'module.exports = {}',
      'docusaurus/docs/setup.md': page,
      'fumadocs/package.json': '{"dependencies":{"fumadocs-core":"16.17.1"}}',
      'fumadocs/next.config.mjs': 'export default {}',
      'fumadocs/content/docs/setup.mdx': page,
      'starlight/package.json': '{"dependencies":{"@astrojs/starlight":"0.42.5"}}',
      'starlight/astro.config.mjs': 'export default {}',
      'starlight/src/content/docs/setup.md': page,
      'website/package.json': '{"name":"w"}',
      'website/next.config.mjs': 'export default {}',
      'website/content/setup.md': page,
      'plain/setup.md': page,
    });
    const anchors = async (directory: string) => {
      const [document] = await loadDirectory(join(root, directory), { framework: 'auto' });
      if (!document) throw new Error(`${directory} has no page`);
      return chunkDocument(document).map(({ heading, anchor }) => [heading, anchor]);
    };
    // Docusaurus 3.10, Fumadocs 16.17 and Nextra 4.6 slug a heading without its references (as
    // `Install `), and only a label with a definition is a reference.
    const dropped = [
      ['Install', 'install-'],
      ['Use [^1] in text', 'use-1-in--text'],
      ['Undefined [^x]', 'undefined-x'],
    ];
    expect(await anchors('docusaurus/docs')).toEqual(dropped);
    expect(await anchors('fumadocs/content/docs')).toEqual(dropped);
    // Astro 7.3, and so Starlight, puts each footnote's number in the id (`install-1`), and other
    // sites render headings their own way: their anchors are what they were.
    const kept = [
      ['Install [^1]', 'install-1'],
      ['Use [^1] in [^note] text', 'use-1-in-note-text'],
      ['Undefined [^x]', 'undefined-x'],
    ];
    expect(await anchors('starlight/src/content/docs')).toEqual(kept);
    expect(await anchors('website/content')).toEqual(kept);
    expect(await anchors('plain')).toEqual(kept);
  });

  it('detects the framework through a linked content folder', async () => {
    await write({
      'site/package.json': '{"name":"site"}',
      'site/docusaurus.config.js': 'module.exports = {}',
      'site/docs/01-a.md': '# A',
    });
    await symlink(join(root, 'site/docs'), join(root, 'linked'));
    expect(await detectFramework(join(root, 'linked'))).toBe('docusaurus');
    expect(frameworkUrl('a/b.md', { slug: './c' }, 'docusaurus')).toBe('/a/c');
  });
});

describe('matchesGlob', () => {
  it.each([
    ['*.md', 'a.md', true],
    ['*.md', 'guides/a.md', false],
    ['**/*.md', 'a.md', true],
    ['**/*.md', 'guides/deep/a.md', true],
    ['guides/**', 'guides/a.md', true],
    ['guides/**', 'guides/x/y.md', true],
    ['guides/**', 'guidesx/a.md', false],
    ['**/drafts/**', 'a/drafts/b/c.md', true],
    ['**/drafts/**', 'drafts/c.md', true],
    ['a/**/b.md', 'a/b.md', true],
    ['a/**/b.md', 'a/x/y/b.md', true],
    ['a/**/b.md', 'ab.md', false],
    ['?.md', 'a.md', true],
    ['?.md', 'ab.md', false],
    ['[ab].md', 'b.md', true],
    ['[!ab].md', 'b.md', false],
    ['[^ab].md', 'c.md', true],
    ['[a-c]*.md', 'cat.md', true],
    ['[]a].md', '].md', true],
    ['[!]a].md', 'a.md', false],
    ['[!]a].md', 'b.md', true],
    ['[a.md', '[a.md', true],
    ['[a/b].md', 'a/b].md', false],
    ['*.{md,mdx}', 'a.mdx', true],
    ['*.{md,mdx}', 'a.html', false],
    ['{guides,blog}/**', 'blog/a.md', true],
    ['{a,b{c,d}}.md', 'bd.md', true],
    ['{a}.md', '{a}.md', true],
    ['a+b (1).md', 'a+b (1).md', true],
    ['guides\\*.md', 'guides/a.md', true],
    ['Guides/*.md', 'guides/a.md', false],
    ['a*b.md', 'a/b.md', false],
  ])('%s against %s: %s', (pattern, path, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});
