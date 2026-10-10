import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLlmsFiles, fromHtml, fromMarkdown, markdownPath, type LlmsPage } from '../src';
import { llmsOutputs, writeLlmsFiles } from '../src/integration';

const PAGES: LlmsPage[] = [
  {
    url: '/docs/',
    title: 'Introduction',
    description: 'What it is.',
    content: '# Introduction\n\nHello.',
  },
  { url: '/docs/install', title: 'Install', content: 'Run `npm i acme`.' },
  { url: '/docs/guides', title: 'Guides', content: 'All the guides.' },
  {
    url: '/docs/guides/deploy/',
    title: 'Deploy',
    description: 'Ship it.',
    content: '## Vercel\n\nPush.',
  },
  { url: '/docs/api/options', title: 'Options', content: 'Every option.' },
];

const files = (pages = PAGES, site = {}, outputs = {}) =>
  new Map(
    buildLlmsFiles(pages, { title: 'Acme', description: 'Docs for Acme.', ...site }, outputs).map(
      (file) => [file.path, file.content],
    ),
  );

describe('markdownPath', () => {
  it('is the URL without a trailing slash, plus .md, and index.md at the root', () => {
    expect(markdownPath('/docs/intro')).toBe('docs/intro.md');
    expect(markdownPath('/docs/intro/')).toBe('docs/intro.md');
    expect(markdownPath('/')).toBe('index.md');
    expect(markdownPath('/guides/setup.html')).toBe('guides/setup.md');
    expect(markdownPath('/guides/index.html')).toBe('guides.md');
    expect(markdownPath('/docs/caf%C3%A9#x')).toBe('docs/café.md');
    expect(markdownPath('https://acme.dev/docs/a')).toBe('docs/a.md');
  });

  it('is relative to the base path the site is served under', () => {
    expect(markdownPath('/docs/intro', '/docs/')).toBe('intro.md');
    expect(markdownPath('/docs/', '/docs/')).toBe('index.md');
    expect(markdownPath('/docs/fr/intro', '/docs/fr/')).toBe('intro.md');
  });
});

describe('buildLlmsFiles', () => {
  it('writes llms.txt as llmstxt.org has it: H1, summary, then sections of links to the .md copies', () => {
    expect(files().get('llms.txt')).toBe(
      [
        '# Acme',
        '',
        '> Docs for Acme.',
        '',
        'Each page links to its Markdown copy: its URL plus `.md`.',
        '',
        'Every page in one file: /llms-full.txt',
        '',
        '## Docs',
        '',
        '- [Introduction](/docs.md): What it is.',
        '- [Install](/docs/install.md)',
        '- [Guides](/docs/guides.md)',
        '',
        '## Guides',
        '',
        '- [Deploy](/docs/guides/deploy.md): Ship it.',
        '',
        '## API',
        '',
        '- [Options](/docs/api/options.md)',
        '',
      ].join('\n'),
    );
  });

  it('links absolutely with the site URL, under its base path, and names the MCP endpoint', () => {
    const llms = files(
      PAGES.map((page) => ({ ...page, url: page.url.replace(/^\/docs/, '/docs/v2') })),
      { url: 'https://acme.dev', base: '/docs/v2/', mcp: 'https://acme.dev/api/mcp' },
    );
    const text = llms.get('llms.txt') ?? '';
    expect(text).toContain('- [Install](https://acme.dev/docs/v2/install.md)');
    expect(text).toContain('Every page in one file: https://acme.dev/docs/v2/llms-full.txt');
    expect(text).toContain(
      'Agents can search these docs over MCP, with search, fetch and list_pages tools: https://acme.dev/api/mcp',
    );
    expect([...llms.keys()]).toContain('guides/deploy.md');
  });

  it('writes each page’s .md with a pointer to llms.txt, and one H1', () => {
    const llms = files();
    expect(llms.get('docs.md')).toBe(
      '> From Acme. Every page, as Markdown: /llms.txt\n\n# Introduction\n\nHello.\n',
    );
    expect(llms.get('docs/guides/deploy.md')).toBe(
      '> From Acme. Every page, as Markdown: /llms.txt\n\n# Deploy\n\n## Vercel\n\nPush.\n',
    );
  });

  it('writes every page in llms-full.txt, with its URL', () => {
    const full = files(PAGES.slice(0, 2), { url: 'https://acme.dev' }).get('llms-full.txt');
    expect(full).toBe(
      [
        '# Acme',
        '',
        '> Docs for Acme.',
        '',
        '---',
        '',
        '# Introduction',
        '',
        'Source: https://acme.dev/docs/',
        '',
        'Hello.',
        '',
        '---',
        '',
        '# Install',
        '',
        'Source: https://acme.dev/docs/install',
        '',
        'Run `npm i acme`.',
        '',
      ].join('\n'),
    );
  });

  it('leaves out what is turned off, and the pointers to it', () => {
    expect([...files(PAGES, {}, { full: false, markdown: false }).keys()]).toEqual(['llms.txt']);
    const index = files(PAGES, {}, { full: false, markdown: false }).get('llms.txt') ?? '';
    expect(index).toContain('- [Install](/docs/install)');
    expect(index).not.toContain('llms-full.txt');
    expect(index).not.toContain('Markdown copy');
    const noIndex = files(PAGES, {}, { index: false });
    expect(noIndex.has('llms.txt')).toBe(false);
    expect(noIndex.get('docs/install.md')).toBe('# Install\n\nRun `npm i acme`.\n');
    expect(llmsOutputs(false)).toEqual({ index: false, full: false, markdown: false });
    expect(llmsOutputs({ full: false })).toEqual({ index: true, full: false, markdown: true });
  });
});

describe('fromHtml with markdown', () => {
  const page = (main: string) =>
    `<html><head><title>T</title><meta name="description" content="A page &amp; more."></head><body><main>${main}</main></body></html>`;
  const md = (main: string, url = '/docs/guides/setup') =>
    fromHtml(page(main), { id: 'x', url, markdown: true })?.content;

  it('keeps links, resolving relative ones, and drops unsafe ones', () => {
    expect(
      md(
        '<p>See <a href="../install">the <code>install</code> page</a>, <a href="#opts">options</a>, <a href="https://x.dev/a b">X</a> and <a href="javascript:alert(1)">this</a>.</p>',
      ),
    ).toBe(
      'See [the `install` page](/docs/install), [options](#opts), [X](https://x.dev/a%20b) and this.',
    );
  });

  it('keeps emphasis, images, numbered and nested lists, quotes and rules', () => {
    expect(
      md(
        '<p><strong>Bold</strong> and <em>soft</em>.</p><img src="/img/a.png" alt="A chart"><ol><li>One</li><li>Two<ul><li>Two a</li></ul></li></ol><blockquote><p>Quoted <em>text</em>.</p></blockquote><hr><p>After.</p>',
      ),
    ).toBe(
      '**Bold** and *soft*.\n\n![A chart](/img/a.png)\n\n1. One\n1. Two\n  - Two a\n\n> Quoted *text*.\n\n---\n\nAfter.',
    );
  });

  it('writes tables with a header row, from minified HTML without closing tags too', () => {
    const table =
      '<table><thead><tr><th>Flag<th>Default<tbody><tr><td><code>--out</code><td>a | b<tr><td>--x</table>';
    expect(md(table)).toBe('| Flag | Default |\n| --- | --- |\n| `--out` | a \\| b |\n| --x |  |');
  });

  it('keeps code blocks’ language, and drops heading ids', () => {
    expect(
      md(
        '<h2 id="setup">Setup</h2><pre data-language="ts"><code>const a = 1;</code></pre><pre class="prism-code language-sh"><code>npm i</code></pre>',
      ),
    ).toBe('## Setup\n\n```ts\nconst a = 1;\n```\n\n```sh\nnpm i\n```');
  });

  it('leaves the text the index reads exactly as it was', () => {
    const html = page(
      '<h2 id="a">A</h2><p>See <a href="/b">B</a> and <strong>C</strong>.</p><ol><li>One</li></ol>',
    );
    expect(fromHtml(html, { id: 'x', url: '/x' })?.content).toBe(
      '## A {#a}\n\nSee B and C.\n\n- One',
    );
  });

  it('reads the page’s description', () => {
    expect(fromHtml(page('<p>x</p>'), { id: 'x', url: '/x' })?.description).toBe('A page & more.');
  });
});

describe('fromMarkdown with markdown', () => {
  const source =
    '---\ndescription: The setup.\n---\n\n# Setup\n\nSee [install](./install.md) and ![a chart](/a.png).\n\n[ref]: https://x.dev\n';
  it('keeps links, images and definitions, which the index drops', () => {
    expect(fromMarkdown(source, { id: 'x', url: '/x', markdown: true })?.content).toBe(
      '# Setup\n\nSee [install](./install.md) and ![a chart](/a.png).\n\n[ref]: https://x.dev',
    );
    expect(fromMarkdown(source, { id: 'x', url: '/x' })?.content).toBe(
      '# Setup\n\nSee install and a chart.',
    );
    expect(fromMarkdown(source, { id: 'x', url: '/x' })?.description).toBe('The setup.');
  });
});

describe('writeLlmsFiles', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ondocs-llms-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const log = () => ({ info: vi.fn(), warn: vi.fn() });

  it('writes the files, and says so', async () => {
    const logger = log();
    await writeLlmsFiles({
      pages: PAGES,
      site: { title: 'Acme' },
      outputs: llmsOutputs(undefined),
      dir,
      label: 'build',
      log: logger,
    });
    expect(existsSync(join(dir, 'llms.txt'))).toBe(true);
    expect(existsSync(join(dir, 'docs/guides/deploy.md'))).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('Wrote llms.txt, llms-full.txt, 5 .md pages → build');
  });

  it('never replaces a file the build already has, and leaves another plugin’s outputs to it', async () => {
    await writeFile(join(dir, 'llms.txt'), '# Mine\n');
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs/install.md'), 'mine');
    const logger = log();
    await writeLlmsFiles({
      pages: PAGES,
      site: { title: 'Acme' },
      outputs: llmsOutputs(undefined),
      owners: new Map([['full', 'docusaurus-plugin-llms']]),
      dir,
      label: 'build',
      log: logger,
    });
    expect(await readFile(join(dir, 'llms.txt'), 'utf8')).toBe('# Mine\n');
    expect(await readFile(join(dir, 'docs/install.md'), 'utf8')).toBe('mine');
    expect(existsSync(join(dir, 'llms-full.txt'))).toBe(false);
    expect(existsSync(join(dir, 'docs/guides/deploy.md'))).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'docusaurus-plugin-llms writes llms-full.txt, so ondocs does not.',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Left docs\/install\.md, llms\.txt as they were/),
    );
  });

  it('replaces files when told to, as the CLI is', async () => {
    await writeFile(join(dir, 'llms.txt'), 'old');
    await writeLlmsFiles({
      pages: PAGES,
      site: { title: 'Acme' },
      outputs: llmsOutputs(undefined),
      dir,
      label: '.',
      log: log(),
      overwrite: true,
    });
    expect((await readFile(join(dir, 'llms.txt'), 'utf8')).startsWith('# Acme')).toBe(true);
  });
});
