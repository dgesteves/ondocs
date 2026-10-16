import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { StarlightUserConfig } from '@astrojs/starlight/types';
import type { AstroIntegration } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ondocs from '../src/astro';
import { parseIndexFile } from '../src/index-file';
import { mockEmbeddingModel } from '../src/mock';
import starlightOndocs from '../src/starlight';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-astro-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A page as Starlight 0.42 builds it, chrome and all, from what a real build writes. */
function starlightPage(
  title: string,
  markdown: string,
  { pagefind = true, lang = 'en', banner = '' } = {},
): string {
  return `<!DOCTYPE html><html lang="${lang}" dir="ltr" data-theme="dark" data-has-toc data-has-sidebar class="astro-uknsdzpk"><head><meta charset="utf-8"/><title>${title} | Acme Docs</title><script>
	window.StarlightThemeProvider = (() => { const storedTheme = typeof localStorage !== 'undefined' && localStorage.getItem('starlight-theme'); })();
</script></head><body class="astro-uknsdzpk"><a class="sl-skip-link astro-qhummnor" href="#_top">Skip to content</a><div class="page sl-flex astro-g77elgym"><header class="header astro-g77elgym"><div class="header astro-vzdplpq4"><div class="title-wrapper sl-flex astro-vzdplpq4"><a href="/" class="site-title sl-flex astro-mtwtsapi"><span class="astro-mtwtsapi">Acme Docs</span></a></div><site-search class="astro-3zc6wlnj"><button data-open-modal disabled aria-label="Search" class="astro-3zc6wlnj"><span class="sl-hidden md:sl-block astro-3zc6wlnj" aria-hidden="true">Search</span><kbd class="astro-3zc6wlnj"><kbd class="astro-3zc6wlnj">Ctrl</kbd><kbd class="astro-3zc6wlnj">K</kbd></kbd></button><dialog style="padding:0" aria-label="Search" class="astro-3zc6wlnj"><button data-close-modal>Cancel</button></dialog></site-search></div></header><nav class="sidebar print:hidden astro-g77elgym" aria-label="Main"><button popovertarget="starlight__sidebar" class="sl-menu-button sl-flex md:sl-hidden print:hidden astro-gzvgytkx"><span class="sr-only astro-gzvgytkx">Menu</span></button><sl-sidebar-pane popover id="starlight__sidebar" class="sidebar-pane astro-g77elgym"><ul class="top-level astro-cxyjek37"><li class="astro-cxyjek37"><a href="/guides/setup/" class="astro-cxyjek37"><span class="astro-cxyjek37">Sidebar link</span></a></li></ul></sl-sidebar-pane></nav><div class="main-frame astro-g77elgym"><div class="lg:sl-flex astro-diwahtgj"><aside class="right-sidebar-container print:hidden astro-diwahtgj"><div class="right-sidebar astro-diwahtgj"><starlight-toc data-min-h="2" data-max-h="3"><nav aria-labelledby="starlight__on-this-page"><h2 id="starlight__on-this-page">On this page</h2><ul class="astro-u6knexgl"><li class="astro-u6knexgl"><a href="#_top" class="astro-u6knexgl"><span class="astro-u6knexgl">Overview</span></a></li></ul></nav></starlight-toc></div></aside><div class="main-pane astro-diwahtgj"><main${pagefind ? ' data-pagefind-body' : ''} class="astro-uknsdzpk" lang="${lang}" dir="ltr">${banner ? `<div class="sl-banner astro-5wrfavop" data-pagefind-ignore>${banner}</div>` : ''}<div class="content-panel astro-n7rsyblg"><div class="sl-container astro-n7rsyblg"><h1 id="_top" class="astro-mxmfkvky">${title}</h1></div></div><div class="content-panel astro-n7rsyblg"><div class="sl-container astro-n7rsyblg"><div class="sl-markdown-content">${markdown}</div><footer class="sl-flex astro-ocltnucx"><div class="meta sl-flex astro-ocltnucx"><a href="https://github.com/acme/docs/edit/main/page.md" class="sl-flex astro-eez2twj6">Edit page</a><p class="astro-xm4ok7ou">Last updated: <time datetime="2026-10-01T00:00:00.000Z">Oct 1, 2026</time></p></div><div class="pagination-links print:hidden astro-rqi3ghp7" dir="ltr"><a href="/" rel="prev" class="astro-rqi3ghp7"><span class="astro-rqi3ghp7">Previous<br class="astro-rqi3ghp7"><span class="link-title astro-rqi3ghp7">Introduction</span></span></a></div></footer></div></div></main></div></div></div></div></body></html>`;
}

/** A heading as Starlight renders it: an anchor link whose label is for screen readers only. */
const heading = (id: string, text: string) =>
  `<div class="sl-heading-wrapper level-h2"><h2 id="${id}">${text}</h2><a class="sl-anchor-link" href="#${id}"><span aria-hidden="true" class="sl-anchor-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m12.11 15.39-3.88 3.88"/></svg></span><span class="sr-only" data-pagefind-ignore>Section titled “${text}”</span></a></div>`;

/** An Expressive Code terminal block: one <div> per line, the snippet again in data-code. */
const terminal = (...lines: string[]) =>
  `<div class="expressive-code"><link rel="stylesheet" href="/_astro/ec.w36nc.css"><script type="module" src="/_astro/ec.0vx5m.js"></script><figure class="frame is-terminal not-content"><figcaption class="header"><span class="title"></span><span class="sr-only">Terminal window</span></figcaption><pre data-language="sh"><code>${lines
    .map(
      (line) =>
        `<div class="ec-line"><div class="code">${line ? `<span style="--0:#82AAFF;--1:#3B61B0">${line}</span>` : '\n'}</div></div>`,
    )
    .join(
      '',
    )}</code></pre><div class="copy"><div aria-live="polite"></div><button title="Copy to clipboard" data-copied="Copied!" data-code="${lines.join('\u007f')} => <done>"><div></div></button></div></figure></div>`;

const aside = (text: string) =>
  `<aside aria-label="Tip" class="starlight-aside starlight-aside--tip"><p class="starlight-aside__title" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="starlight-aside__icon"><path d="M1 1"/></svg>Tip</p><div class="starlight-aside__content"><p>${text}</p></div></aside>`;

type Format = 'directory' | 'file' | 'preserve';
type TrailingSlash = 'always' | 'never' | 'ignore';

interface SiteOptions {
  site?: string;
  /** Other integrations' names, as Astro lists them. */
  integrations?: string[];
  format?: Format;
  trailingSlash?: TrailingSlash;
  base?: string;
  i18n?: unknown;
  /** An SSR adapter's name, such as `@astrojs/node`: the integration then serves the routes. */
  adapter?: string;
}

/**
 * Writes `pages` (route path → HTML) where Astro writes them for `format`, and returns the
 * `pages` that `astro:build:done` reports: pathnames without a leading slash, with a trailing
 * slash as Astro adds one for `trailingSlash` and `format`.
 */
async function build(
  integration: AstroIntegration,
  pages: Record<string, string>,
  {
    site,
    integrations = [],
    format = 'directory',
    trailingSlash = 'ignore',
    base = '/',
    i18n,
    adapter,
  }: SiteOptions = {},
) {
  const outDir = join(root, 'dist');
  const reported: { pathname: string }[] = [];
  const slash =
    trailingSlash === 'always' || (trailingSlash === 'ignore' && format === 'directory');
  for (const [path, html] of Object.entries(pages)) {
    const status = path === '404' || path === '500';
    const file =
      path === ''
        ? 'index.html'
        : format === 'directory' && !status
          ? `${path}/index.html`
          : `${path}.html`;
    await mkdir(dirname(join(outDir, file)), { recursive: true });
    await writeFile(join(outDir, file), html);
    reported.push({ pathname: path === '' ? '' : slash ? `${path}/` : path });
  }
  const logger = { info: vi.fn(), warn: vi.fn() };
  const injected: [string, string][] = [];
  const updateConfig = vi.fn();
  const hooks = integration.hooks as Record<string, (options: unknown) => unknown>;
  await hooks['astro:config:setup']?.({
    config: {
      site,
      ...(adapter
        ? {
            adapter: { name: adapter, hooks: {} },
            base,
            root: pathToFileURL(`${root}/`),
            srcDir: pathToFileURL(`${root}/src/`),
          }
        : {}),
    },
    injectScript: (stage: string, content: string) => injected.push([stage, content]),
    injectRoute: vi.fn(),
    updateConfig,
    logger,
  });
  await hooks['astro:config:done']?.({
    config: {
      root: pathToFileURL(`${root}/`),
      ...(site ? { site } : {}),
      integrations: [{ name: 'ondocs' }, ...integrations.map((name) => ({ name }))],
      base,
      trailingSlash,
      build: { format },
      ...(i18n ? { i18n } : {}),
    },
    logger,
  });
  await hooks['astro:build:done']?.({
    dir: pathToFileURL(`${outDir}/`),
    pages: reported,
    assets: new Map(),
    logger,
  });
  const read = async (file = 'ask-index.json') =>
    parseIndexFile(await readFile(join(outDir, file), 'utf8'));
  return { outDir, logger, injected, updateConfig, read };
}

/** The Astro integration the Starlight plugin adds, for a Starlight config. */
function starlightIntegration(
  options: Parameters<typeof starlightOndocs>[0] = {},
  config: Partial<StarlightUserConfig> = {},
): AstroIntegration {
  const plugin = starlightOndocs({ embeddingModel: mockEmbeddingModel(), ...options });
  let added: AstroIntegration | undefined;
  const setup = plugin.hooks['config:setup'] as unknown as (options: unknown) => void;
  setup({
    config: { title: 'Acme Docs', ...config },
    addIntegration: (integration: AstroIntegration) => {
      added = integration;
    },
  });
  if (!added) throw new Error('the plugin added no integration');
  return added;
}

const STARLIGHT_PAGES: Record<string, string> = {
  '': starlightPage('Introduction', '<p>Welcome to the docs.</p>'),
  'guides/setup': starlightPage(
    'Setup',
    `<p>Install it first.</p>${heading('install', 'Install')}${terminal('npm install acme', '', 'npx acme --init')}${aside('Pin the version.')}${heading('configure', 'Configure')}<p>Then configure it.</p>`,
    { banner: 'A new release is out!' },
  ),
  'reference/api': starlightPage('API', `${heading('options', 'Options')}<p>Every option.</p>`),
  // `pagefind: false` in its frontmatter.
  changelog: starlightPage('Changelog', '<p>1.0 released.</p>', { pagefind: false }),
  // Starlight's 404 page has no data-pagefind-body either.
  '404': starlightPage('404', '<p>Page not found.</p>', { pagefind: false }),
};

describe('ondocs/starlight', () => {
  it('indexes the region Starlight marks for search, at the URLs Astro serves', async () => {
    const { read } = await build(starlightIntegration(), STARLIGHT_PAGES);
    const index = await read();
    // Not the changelog (`pagefind: false`) or the 404 page.
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([
      ['/', 'Introduction'],
      ['/guides/setup/', 'Setup'],
      ['/reference/api/', 'API'],
    ]);
    const text = index.chunks.map((c) => `${c.heading}\n${c.text}`).join('\n');
    // No header, search, sidebar, table of contents, banner, heading anchors' labels, code
    // frame labels, copy button, edit link, last updated date or pagination.
    for (const chrome of [
      'Skip to content',
      'Search',
      'Ctrl',
      'Sidebar link',
      'On this page',
      'Overview',
      'A new release',
      'Section titled',
      'Terminal window',
      '<done>',
      'Edit page',
      'Last updated',
      'Previous',
      'Acme Docs',
    ]) {
      expect([chrome, text.includes(chrome)]).toEqual([chrome, false]);
    }
    const install = index.chunks.find((c) => c.anchor === 'install');
    // Code blocks keep their lines, and asides (notes, tips) are content.
    expect(install?.text).toBe(
      '```\nnpm install acme\n\nnpx acme --init\n```\n\nTip\n\nPin the version.',
    );
    expect(index.chunks.find((c) => c.anchor === 'configure')?.heading).toBe('Configure');
    expect(index.embedding?.model).toBe('mock-hash-512');
  });

  it('follows base, trailingSlash and build.format', async () => {
    const cases: [SiteOptions, string[]][] = [
      [{ format: 'file' }, ['/', '/guides/setup', '/reference/api']],
      [
        { format: 'directory', trailingSlash: 'never', base: '/docs' },
        ['/docs', '/docs/guides/setup', '/docs/reference/api'],
      ],
      [
        { format: 'file', trailingSlash: 'always', base: '/docs/' },
        ['/docs/', '/docs/guides/setup/', '/docs/reference/api/'],
      ],
      [
        { format: 'preserve', base: '/docs' },
        ['/docs/', '/docs/guides/setup', '/docs/reference/api'],
      ],
    ];
    for (const [site, urls] of cases) {
      await rm(join(root, 'dist'), { recursive: true, force: true });
      const { read } = await build(starlightIntegration(), STARLIGHT_PAGES, site);
      expect([site, (await read()).documents.map((d) => d.url)]).toEqual([site, urls]);
    }
  });

  it('writes an index per locale, and excludes paths relative to base and the locale', async () => {
    const french = (title: string, text: string) =>
      starlightPage(title, `<p>${text}</p>`, { lang: 'fr' });
    const pages = {
      ...STARLIGHT_PAGES,
      fr: french('Introduction', 'Bienvenue.'),
      'fr/guides/setup': french('Installation', 'Installez-le.'),
      'fr/changelog': french('Journal', 'Nouveautés.'),
      'pt-br/guides/setup': starlightPage('Instalação', '<p>Instale.</p>', { lang: 'pt-BR' }),
    };
    const integration = starlightIntegration(
      { exclude: ['/changelog', 'reference'] },
      {
        title: { en: 'Acme Docs', fr: 'Docs Acme' },
        locales: {
          root: { label: 'English', lang: 'en' },
          fr: { label: 'Français' },
          'pt-br': { label: 'Português', lang: 'pt-BR' },
        },
      },
    );
    const { read, logger, outDir } = await build(integration, pages, { base: '/docs' });
    expect((await read()).documents.map((d) => d.url)).toEqual(['/docs/', '/docs/guides/setup/']);
    expect((await read('fr/ask-index.json')).documents.map((d) => [d.url, d.title])).toEqual([
      ['/docs/fr/', 'Introduction'],
      ['/docs/fr/guides/setup/', 'Installation'],
    ]);
    expect((await read('pt-br/ask-index.json')).documents.map((d) => d.url)).toEqual([
      '/docs/pt-br/guides/setup/',
    ]);
    const indexed = logger.info.mock.calls.filter(([message]) =>
      String(message).startsWith('Indexed'),
    );
    expect(indexed.map(([message]) => String(message).split(' → ')[1])).toEqual([
      // Where each file is, from the project root.
      expect.stringMatching(/^dist\/ask-index\.json /) as string,
      expect.stringMatching(/^dist\/fr\/ask-index\.json /) as string,
      expect.stringMatching(/^dist\/pt-br\/ask-index\.json /) as string,
    ]);

    // Every locale under its own path: the root, which has no pages, gets the default locale's
    // index and llms files, where the endpoints and agents read them. Not the first locale's.
    await rm(outDir, { recursive: true });
    const prefixed = starlightIntegration(
      {},
      { defaultLocale: 'en', locales: { fr: { label: 'Français' }, en: { label: 'English' } } },
    );
    const { outDir: dir, logger: log } = await build(prefixed, {
      en: starlightPage('Introduction', '<p>Welcome.</p>'),
      fr: french('Introduction', 'Bienvenue.'),
    });
    for (const file of ['ask-index.json', 'llms.txt', 'llms-full.txt']) {
      expect([file, await readFile(join(dir, file), 'utf8')]).toEqual([
        file,
        await readFile(join(dir, 'en', file), 'utf8'),
      ]);
    }
    expect((await read()).documents.map((d) => d.url)).toEqual(['/en/']);
    expect(existsSync(join(dir, 'fr', 'ask-index.json'))).toBe(true);
    expect(existsSync(join(dir, 'index.md'))).toBe(false);
    expect(log.info).toHaveBeenCalledWith(
      "Copied en's ask-index.json, llms.txt, llms-full.txt → dist, which has no pages of its own, for the endpoints and agents that read them there.",
    );
  });

  it('reuses vectors per locale from node_modules/.cache, and falls back to keyword-only', async () => {
    const pages = { ...STARLIGHT_PAGES, fr: starlightPage('Introduction', '<p>Bienvenue.</p>') };
    const config = {
      locales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' } },
    };
    await build(starlightIntegration({}, config), pages);
    const { logger } = await build(starlightIntegration({}, config), pages);
    for (const [message] of logger.info.mock.calls) {
      expect(message).toMatch(/^Indexed \d+ pages into \d+ chunks, 0 embedded, \d+ reused → /);
    }
    const cache = join(root, 'node_modules', '.cache', 'ondocs');
    expect(existsSync(join(cache, 'astro-root.json'))).toBe(true);
    expect(existsSync(join(cache, 'astro-fr.json'))).toBe(true);

    const keywordOnly = await build(starlightIntegration({ embeddingModel: undefined }), pages);
    expect(keywordOnly.logger.warn.mock.calls[0]?.[0]).toContain(
      'No embedding model: building a keyword-only index.',
    );
    expect((await keywordOnly.read()).embedding).toBeNull();
  });

  it('adds the dialog to every page, titled after the site, in Starlight’s colors', async () => {
    const { injected, updateConfig } = await build(
      starlightIntegration(
        { endpoint: 'https://api.example.com/ask', dialog: { shortcut: 'j', theme: 'light' } },
        {
          title: { fr: 'Docs Acme', en: 'Acme Docs' },
          locales: { root: { label: 'English', lang: 'en' } },
        },
      ),
      STARLIGHT_PAGES,
    );
    const [styles, script] = injected;
    expect(styles?.[0]).toBe('page-ssr');
    expect(styles?.[1].split('\n')).toEqual([
      'import "ondocs/react/styles.css";',
      'import "ondocs/embed/launcher.css";',
      'import "ondocs/starlight/launcher.css";',
    ]);
    expect(script?.[0]).toBe('page');
    expect(script?.[1]).toBe(
      `import { mountAskDialog } from 'ondocs/embed/standalone';\nmountAskDialog(${JSON.stringify({
        endpoint: 'https://api.example.com/ask',
        shortcut: 'j',
        theme: 'light',
        title: 'Ask Acme Docs',
      })});`,
    );
    expect(updateConfig).toHaveBeenCalledWith({
      vite: {
        plugins: [
          expect.objectContaining({ name: 'ondocs:quiet-use-client' }),
          expect.objectContaining({ name: 'ondocs:virtual-module' }),
        ],
        optimizeDeps: { include: ['ondocs/embed/standalone'] },
      },
    });
  });

  it('writes llms.txt, llms-full.txt and .md copies per locale, as it does the index', async () => {
    const { outDir, logger } = await build(
      starlightIntegration({}, { description: 'Docs for Acme.' }),
      STARLIGHT_PAGES,
      { site: 'https://acme.dev' },
    );
    const llms = await readFile(join(outDir, 'llms.txt'), 'utf8');
    expect(llms.split('\n').slice(0, 3)).toEqual(['# Acme Docs', '', '> Docs for Acme.']);
    expect(llms).toContain('- [Setup](https://acme.dev/guides/setup.md)');
    expect(llms).not.toContain('Changelog');
    const setup = await readFile(join(outDir, 'guides/setup.md'), 'utf8');
    expect(setup).toContain(
      '# Setup\n\nInstall it first.\n\n## Install\n\n```sh\nnpm install acme',
    );
    expect(existsSync(join(outDir, 'index.md'))).toBe(true);
    expect(existsSync(join(outDir, 'changelog.md'))).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('Wrote llms.txt, llms-full.txt, 3 .md pages → dist');
  });

  it('links each page to its .md copy, with base, trailingSlash, build.format and locales', async () => {
    const pages = {
      ...STARLIGHT_PAGES,
      fr: starlightPage('Introduction', '<p>Bienvenue.</p>', { lang: 'fr' }),
      'fr/guides/setup': starlightPage('Installation', '<p>Installez-le.</p>', { lang: 'fr' }),
    };
    const config = {
      locales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' } },
    };
    const cases: [SiteOptions, Record<string, string | null>][] = [
      [
        { format: 'directory', base: '/docs' },
        {
          'index.html': '/docs/index.md',
          'guides/setup/index.html': '/docs/guides/setup.md',
          'fr/index.html': '/docs/fr/index.md',
          'fr/guides/setup/index.html': '/docs/fr/guides/setup.md',
          // pagefind: false, so not indexed and no copy.
          'changelog/index.html': null,
          '404.html': null,
        },
      ],
      [
        { format: 'file', trailingSlash: 'always', base: '/docs/' },
        {
          'index.html': '/docs/index.md',
          'guides/setup.html': '/docs/guides/setup.md',
          'fr/guides/setup.html': '/docs/fr/guides/setup.md',
          'changelog.html': null,
        },
      ],
      [
        { format: 'directory', trailingSlash: 'never' },
        { 'index.html': '/index.md', 'reference/api/index.html': '/reference/api.md' },
      ],
    ];
    for (const [options, expected] of cases) {
      await rm(join(root, 'dist'), { recursive: true, force: true });
      const { outDir } = await build(starlightIntegration({}, config), pages, options);
      for (const [file, href] of Object.entries(expected)) {
        const html = await readFile(join(outDir, file), 'utf8');
        const links = [
          ...html.matchAll(/<link rel="alternate" type="text\/markdown" href="([^"]*)">/g),
        ].map((match) => match[1]);
        expect([options, file, links]).toEqual([options, file, href ? [href] : []]);
        if (href) expect(existsSync(join(outDir, href.replace(/^\/docs\//, '/')))).toBe(true);
      }
    }
  });

  it('leaves llms files to starlight-llms-txt and starlight-page-actions, and keeps public/ files', async () => {
    const plugin = (name: string) => ({ name, hooks: {} });
    const { outDir, logger } = await build(
      starlightIntegration({}, { plugins: [plugin('starlight-llms-txt')] as never }),
      { ...STARLIGHT_PAGES, 'llms-small.txt': 'not a page' },
    );
    expect(existsSync(join(outDir, 'llms.txt'))).toBe(false);
    expect(existsSync(join(outDir, 'guides/setup.md'))).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'starlight-llms-txt writes llms.txt, so ondocs does not.',
    );
    await rm(outDir, { recursive: true });
    const second = await build(starlightIntegration(), STARLIGHT_PAGES, {
      integrations: ['starlight-page-actions-integration'],
    });
    expect(existsSync(join(second.outDir, 'guides/setup.md'))).toBe(false);
    expect(existsSync(join(second.outDir, 'llms.txt'))).toBe(true);
    // Its copies are its own to link.
    expect(await readFile(join(second.outDir, 'guides/setup/index.html'), 'utf8')).not.toContain(
      'text/markdown',
    );
  });

  it('gives McpInstall.astro the MCP endpoint, resolved against site', async () => {
    const mcpModule = async (options: Parameters<typeof starlightOndocs>[0], site?: string) => {
      const { updateConfig } = await build(starlightIntegration(options), STARLIGHT_PAGES, {
        ...(site ? { site } : {}),
      });
      const { plugins } = (updateConfig.mock.calls[0]?.[0] as { vite: { plugins: unknown[] } })
        .vite;
      const plugin = plugins[1] as {
        resolveId: (id: string) => string | null;
        load: (id: string) => string | null;
      };
      const id = plugin.resolveId('virtual:ondocs/mcp');
      expect(plugin.resolveId('other')).toBeNull();
      return id === null ? null : plugin.load(id);
    };
    expect(await mcpModule({ mcp: '/api/mcp' }, 'https://docs.acme.dev')).toBe(
      'export default {"url":"https://docs.acme.dev/api/mcp","name":"acme-docs"};',
    );
    expect(await mcpModule({})).toBe('export default null;');
    await expect(mcpModule({ mcp: '/api/mcp' })).rejects.toThrow(/astro.config's site/);
    // A placeholder left in a URL stops the build, rather than going into llms.txt as it is.
    await expect(
      mcpModule({ mcp: 'https://<your-site>/api/mcp' }, 'https://docs.acme.dev'),
    ).rejects.toThrow(/is not a valid URL/);
  });

  it('names the MCP route it serves with an adapter in llms.txt and McpInstall.astro', async () => {
    const line = 'Agents can search these docs over MCP, with search, fetch and list_pages tools:';
    const mock = { model: 'mock' } as const;
    const advertised = async (
      options: Parameters<typeof starlightOndocs>[0],
      site: SiteOptions,
    ) => {
      // A build keeps an llms.txt it finds, so each starts from none.
      await rm(join(root, 'dist'), { recursive: true, force: true });
      const { outDir, updateConfig } = await build(starlightIntegration(options), STARLIGHT_PAGES, {
        adapter: '@astrojs/node',
        ...site,
      });
      const { plugins } = (
        updateConfig.mock.calls[0]?.[0] as {
          vite: { plugins: { name: string; load?: (id: string) => unknown }[] };
        }
      ).vite;
      const llms = await readFile(join(outDir, 'llms.txt'), 'utf8');
      return {
        module: plugins
          .find((plugin) => plugin.name === 'ondocs:virtual-module')
          ?.load?.('\0virtual:ondocs/mcp'),
        llms: llms.split('\n').find((text) => text.startsWith(line)) ?? null,
      };
    };
    expect(await advertised({ route: mock }, { site: 'https://acme.dev' })).toEqual({
      module: 'export default {"url":"https://acme.dev/api/mcp","name":"acme-docs"};',
      llms: `${line} https://acme.dev/api/mcp`,
    });
    // Under base, at route.mcp's path, or at the URL `mcp` gives.
    expect(
      (await advertised({ route: mock }, { site: 'https://acme.dev', base: '/docs/' })).llms,
    ).toBe(`${line} https://acme.dev/docs/api/mcp`);
    expect(
      (await advertised({ route: { ...mock, mcp: '/mcp' } }, { site: 'https://acme.dev/' })).llms,
    ).toBe(`${line} https://acme.dev/mcp`);
    expect(
      (
        await advertised(
          { route: mock, mcp: 'https://mcp.acme.dev/' },
          { site: 'https://acme.dev' },
        )
      ).llms,
    ).toBe(`${line} https://mcp.acme.dev/`);
    // None when it serves none, or without `site` to make the URL absolute.
    for (const [options, site] of [
      [{ route: { ...mock, mcp: false } }, { site: 'https://acme.dev' }],
      [{ route: false }, { site: 'https://acme.dev' }],
      [{ route: mock }, {}],
    ] as const) {
      expect(await advertised(options, site)).toEqual({
        module: 'export default null;',
        llms: null,
      });
    }
    // Without `site`, the log says what would name the route.
    const hint = 'Set site in astro.config so llms.txt names /docs/api/mcp for agents.';
    const logged = async (options: Parameters<typeof starlightOndocs>[0], site?: string) => {
      const { logger } = await build(starlightIntegration(options), STARLIGHT_PAGES, {
        adapter: '@astrojs/node',
        base: '/docs/',
        ...(site ? { site } : {}),
      });
      return logger.info.mock.calls.map(([message]) => String(message)).join('\n');
    };
    expect(await logged({ route: mock })).toContain(hint);
    expect(await logged({ route: mock }, 'https://acme.dev')).not.toContain('Set site');
    expect(await logged({ route: mock, mcp: 'https://mcp.acme.dev/' })).not.toContain('Set site');
  });

  it('ships McpInstall.astro next to the integration, importing what exists', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'src/astro/McpInstall.astro'),
      'utf8',
    );
    expect(source).toContain("from 'virtual:ondocs/mcp'");
    // Resolved from dist/astro/, where the build copies it: dist/index.js is the root entry.
    expect(source).toContain("import { mcpInstallLinks } from '../index.js';");
    // The commands and config McpInstall from ondocs/react shows, for the same clients.
    for (const field of ['claudeCode', 'codex', 'gemini', 'json', 'codexToml']) {
      expect(source).toContain(`<code>{links.${field}}</code>`);
    }
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports['./astro/McpInstall.astro']).toBe('./dist/astro/McpInstall.astro');
  });
});

describe('ondocs/starlight with dialog.navbar', () => {
  /** The plugin's config:setup, with what it updated and the integration it added. */
  function setup(
    options: Parameters<typeof starlightOndocs>[0],
    config: Partial<StarlightUserConfig> = {},
  ) {
    const plugin = starlightOndocs({ embeddingModel: mockEmbeddingModel(), ...options });
    const updateConfig = vi.fn();
    let integration: AstroIntegration | undefined;
    (plugin.hooks['config:setup'] as unknown as (options: unknown) => void)({
      config: { title: 'Acme Docs', ...config },
      addIntegration: (added: AstroIntegration) => {
        integration = added;
      },
      updateConfig,
      astroConfig: { root: pathToFileURL('/site/') },
    });
    if (!integration) throw new Error('the plugin added no integration');
    return { updateConfig, integration };
  }

  /** What the integration sets up in Astro: its injected scripts, and the navbar module. */
  async function astroSetup(integration: AstroIntegration) {
    const injected: [string, string][] = [];
    const updateConfig = vi.fn();
    const hooks = integration.hooks as Record<string, (options: unknown) => unknown>;
    await hooks['astro:config:setup']?.({
      config: { base: '/' },
      injectScript: (stage: string, content: string) => injected.push([stage, content]),
      updateConfig,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const { plugins } = (updateConfig.mock.calls[0]?.[0] as { vite: { plugins: unknown[] } }).vite;
    const navbar = (
      plugins as { resolveId?: (id: string) => string | null; load?: (id: string) => unknown }[]
    )
      .map((plugin) => {
        const id = plugin.resolveId?.('virtual:ondocs/starlight/navbar');
        return id ? plugin.load?.(id) : undefined;
      })
      .find((code) => code !== undefined && code !== null);
    return { injected, navbar };
  }

  it('leaves Starlight’s Search as it is without the option', async () => {
    const { updateConfig, integration } = setup({});
    expect(updateConfig).not.toHaveBeenCalled();
    const { injected, navbar } = await astroSetup(integration);
    expect(navbar).toBeUndefined();
    expect(injected.find(([stage]) => stage === 'page-ssr')?.[1]).not.toContain('button.css');
  });

  it('puts its Search in place, rendering Starlight’s, with the button after it', async () => {
    const { updateConfig, integration } = setup(
      { dialog: { navbar: true } },
      { components: { Footer: './src/Footer.astro' } },
    );
    expect(updateConfig).toHaveBeenCalledWith({
      components: { Footer: './src/Footer.astro', Search: 'ondocs/starlight/Search.astro' },
    });
    const { injected, navbar } = await astroSetup(integration);
    expect(navbar).toBe(
      [
        'export { default } from "@astrojs/starlight/components/Search.astro";',
        'export const renderSearch = true;',
        'export const shortcut = "I";',
        'export const buttons = {"":{"label":"Ask AI","controlKey":"Ctrl"}};',
        '',
      ].join('\n'),
    );
    // The button's look, then Starlight's colors; and no floating button.
    expect(injected.find(([stage]) => stage === 'page-ssr')?.[1]).toContain(
      'import "ondocs/embed/button.css";\nimport "ondocs/starlight/launcher.css";',
    );
    const page = injected.find(([stage]) => stage === 'page')?.[1] ?? '';
    expect(page).toContain('"launcher":false');
    expect(page).not.toContain('navbar');
  });

  it('wraps the Search the site has, resolved from the project root, in each locale’s words', async () => {
    const { integration } = setup(
      {
        dialog: {
          navbar: true,
          shortcut: 'j',
          labels: { controlKey: 'Ctrl' },
          locales: { fr: { labels: { launcher: 'Demander', controlKey: 'Strg' } } },
        },
      },
      {
        components: { Search: './src/components/Search.astro' },
        pagefind: false,
        locales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' } },
      },
    );
    const { navbar } = await astroSetup(integration);
    expect(navbar).toContain(
      `export { default } from ${JSON.stringify(join('/site', 'src/components/Search.astro'))};`,
    );
    // Starlight renders a replaced Search even without Pagefind.
    expect(navbar).toContain('export const renderSearch = true;');
    expect(navbar).toContain('export const shortcut = "J";');
    expect(navbar).toContain(
      'export const buttons = {"":{"label":"Ask AI","controlKey":"Ctrl"},"fr":{"label":"Demander","controlKey":"Strg"}};',
    );
  });

  it('renders no search box where Starlight would render none, and takes a label', async () => {
    const { integration } = setup(
      { dialog: { navbar: 'Ask the docs', shortcut: false } },
      { pagefind: false },
    );
    const { navbar } = await astroSetup(integration);
    expect(navbar).toContain('export const renderSearch = false;');
    expect(navbar).toContain('export const shortcut = "";');
    expect(navbar).toContain('"label":"Ask the docs"');
  });

  it('does not wrap its own Search, with the plugin listed twice', () => {
    const { updateConfig } = setup(
      { dialog: { navbar: true } },
      { components: { Search: 'ondocs/starlight/Search.astro' } },
    );
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('ships Search.astro next to the plugin, reading the navbar module', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'src/starlight/Search.astro'),
      'utf8',
    );
    expect(source).toContain("from 'virtual:ondocs/starlight/navbar'");
    expect(source).toContain('data-ondocs-open');
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(manifest.exports['./starlight/Search.astro']).toBe('./dist/starlight/Search.astro');
    expect(manifest.exports['./embed/button.css']).toBe('./dist/embed/button.css');
  });
});

describe('ondocs/astro', () => {
  /** A page of a plain Astro site: chrome around <main>. */
  const page = (title: string, main: string, head = '') =>
    `<!DOCTYPE html><html lang="en"><head><title>${title} | Acme</title>${head}</head><body><header><nav><a href="/">Home</a></nav><p>Site header</p></header><main>${main}</main><footer>Site footer</footer></body></html>`;

  const PAGES: Record<string, string> = {
    '': page('Home', '<h1>Welcome</h1><p>The home page.</p>'),
    'guides/setup': page(
      'Setup',
      '<h1>Setup</h1><p>Install it.</p><div class="toc">Table of contents</div><aside>Related links</aside>',
    ),
    hidden: page(
      'Hidden',
      '<h1>Hidden</h1><p>Not for search.</p>',
      '<meta name="robots" content="noindex">',
    ),
    landing:
      '<html><head><title>Landing</title></head><body><div class="hero">Big words</div></body></html>',
    '404': page('Not found', '<h1>Not found</h1>'),
    '500': page('Error', '<h1>Error</h1>'),
  };

  it('indexes each page’s <main>, without noindex, 404 and 500 pages', async () => {
    const integration = ondocs({ embeddingModel: mockEmbeddingModel(), ignore: '.toc' });
    const { read, injected } = await build(integration, PAGES);
    const index = await read();
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([
      ['/', 'Welcome'],
      ['/guides/setup/', 'Setup'],
      // A page without <main> or <article> is read from its <body>.
      ['/landing/', 'Landing'],
    ]);
    const text = index.chunks.map((c) => c.text).join('\n');
    for (const chrome of [
      'Site header',
      'Site footer',
      'Home',
      'Table of contents',
      'Related links',
    ]) {
      expect([chrome, text.includes(chrome)]).toEqual([chrome, false]);
    }
    expect(injected.map(([stage]) => stage)).toEqual(['page-ssr', 'page']);
    expect(injected[0]?.[1]).not.toContain('starlight');
    expect(injected[1]?.[1]).toContain('mountAskDialog({"endpoint":"/api/ask"});');
  });

  it('reads the part of the page `content` selects, and skips pages without it', async () => {
    const integration = ondocs({ embeddingModel: mockEmbeddingModel(), content: '.prose' });
    const pages = {
      a: page('A', '<h1>A</h1><div class="prose"><p>Prose A.</p></div><p>Not prose.</p>'),
      b: page('B', '<h1>B</h1><p>No prose here.</p>'),
    };
    const { read } = await build(integration, pages);
    const index = await read();
    // The title comes from <title> when the selected part has no <h1>.
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([['/a/', 'A | Acme']]);
    expect(index.chunks.map((c) => c.text)).toEqual(['Prose A.']);
  });

  it('writes nothing, with a warning, when no page has content', async () => {
    const integration = ondocs({ embeddingModel: mockEmbeddingModel(), content: '#missing' });
    const { logger, outDir } = await build(integration, PAGES);
    expect(logger.warn).toHaveBeenCalledWith(
      'None of the 6 pages Astro built has content to index in #missing, so there is no ask-index.json.',
    );
    expect(existsSync(join(outDir, 'ask-index.json'))).toBe(false);
  });

  it('writes an index per locale of Astro’s i18n config', async () => {
    const pages = {
      '': page('Home', '<h1>Home</h1><p>English.</p>'),
      es: page('Inicio', '<h1>Inicio</h1><p>Español.</p>'),
      'pt/guide': page('Guia', '<h1>Guia</h1><p>Português.</p>'),
    };
    const i18n = {
      defaultLocale: 'en',
      locales: ['en', 'es', { path: 'pt', codes: ['pt-BR', 'pt'] }],
      routing: { prefixDefaultLocale: false },
    };
    const integration = ondocs({ embeddingModel: mockEmbeddingModel(), indexFile: '/ask.json' });
    const { read } = await build(integration, pages, { i18n });
    expect((await read('ask.json')).documents.map((d) => d.url)).toEqual(['/']);
    expect((await read('es/ask.json')).documents.map((d) => d.url)).toEqual(['/es/']);
    expect((await read('pt/ask.json')).documents.map((d) => d.url)).toEqual(['/pt/guide/']);

    // With the default locale prefixed too, its pages get their own index, which the root, with
    // no pages, gets a copy of. Not a copy of llms.txt where the site has one of its own.
    await rm(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'llms.txt'), '# Our own\n');
    const prefixed = { ...i18n, routing: { prefixDefaultLocale: true } };
    const { outDir, logger } = await build(
      ondocs({ embeddingModel: mockEmbeddingModel() }),
      {
        'en/start': page('Start', '<h1>Start</h1><p>English.</p>'),
        'es/inicio': page('Inicio', '<h1>Inicio</h1><p>Español.</p>'),
      },
      { i18n: prefixed },
    );
    expect(existsSync(join(outDir, 'en', 'ask-index.json'))).toBe(true);
    expect(await readFile(join(outDir, 'ask-index.json'), 'utf8')).toBe(
      await readFile(join(outDir, 'en', 'ask-index.json'), 'utf8'),
    );
    expect(await readFile(join(outDir, 'llms.txt'), 'utf8')).toBe('# Our own\n');
    expect(logger.info).toHaveBeenCalledWith(
      "Copied en's ask-index.json, llms-full.txt → dist, which has no pages of its own, for the endpoints and agents that read them there.",
    );
    expect(await readFile(join(outDir, 'en/start/index.html'), 'utf8')).toContain(
      '<link rel="alternate" type="text/markdown" href="/en/start.md"></head>',
    );
  });

  it('links each indexed page to its .md copy, and no other page', async () => {
    const { outDir } = await build(ondocs({ embeddingModel: mockEmbeddingModel() }), PAGES, {
      base: '/docs',
    });
    const read = (file: string) => readFile(join(outDir, file), 'utf8');
    expect(await read('guides/setup/index.html')).toBe(
      (PAGES['guides/setup'] ?? '').replace(
        '</head>',
        '<link rel="alternate" type="text/markdown" href="/docs/guides/setup.md"></head>',
      ),
    );
    expect(await read('landing/index.html')).toContain('href="/docs/landing.md"');
    // noindex, 404 and 500 pages have no copy.
    for (const file of ['hidden/index.html', '404.html', '500.html']) {
      expect([file, (await read(file)).includes('text/markdown')]).toEqual([file, false]);
    }
  });

  it('posts to ASK_ENDPOINT when set, and says how to get answers in astro dev', async () => {
    // The hint shows once per process.
    Reflect.deleteProperty(globalThis, Symbol.for('ondocs.devEndpointHint'));
    const logger = { info: vi.fn(), warn: vi.fn() };
    /** Runs the hooks of `astro dev`, with the routes the site has. */
    const dev = async (
      integration: AstroIntegration,
      routes: { type: string; patternRegex: RegExp }[],
    ) => {
      const hooks = integration.hooks as Record<string, (options: unknown) => unknown>;
      const injected: string[] = [];
      await hooks['astro:config:setup']?.({
        config: {},
        command: 'dev',
        injectScript: (_: string, content: string) => injected.push(content),
        updateConfig: vi.fn(),
        logger,
      });
      await hooks['astro:routes:resolved']?.({ routes, logger });
      await hooks['astro:server:start']?.({ logger });
      return injected;
    };

    // An SSR site that serves the endpoint itself needs no hint.
    await dev(ondocs({ embeddingModel: null }), [
      { type: 'endpoint', patternRegex: /^\/api\/ask\/?$/ },
    ]);
    expect(logger.info).not.toHaveBeenCalled();
    // A static site does not serve it, though Starlight's `[...slug]` page matches any path.
    await dev(ondocs({ embeddingModel: null }), [
      { type: 'page', patternRegex: /^(?:\/(.*?))?\/?$/ },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      'The dialog posts to /api/ask, which astro dev does not serve. For answers while you work, build the site once, run `npx ondocs dev`, and start the site with ASK_ENDPOINT=http://localhost:8787/api/ask.',
    );

    vi.stubEnv('ASK_ENDPOINT', 'http://localhost:8787/api/ask');
    const [, script] = await dev(ondocs({ embeddingModel: null }), []);
    expect(script).toContain('mountAskDialog({"endpoint":"http://localhost:8787/api/ask"});');
    // Over a configured endpoint too, as the README's config sets one and its local-dev steps
    // start the site with ASK_ENDPOINT.
    const [, configured] = await dev(ondocs({ embeddingModel: null, endpoint: '/api/ask' }), []);
    expect(configured).toContain('mountAskDialog({"endpoint":"http://localhost:8787/api/ask"});');
  });

  it('passes embeddingProviderOptions to the default OpenAI and AI Gateway models', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const body = JSON.parse(init?.body as string) as { input?: string[]; values?: string[] };
        requests.push({ url, body });
        const vectors = (body.input ?? body.values ?? []).map((_, i) => [1, i, 0, 0]);
        return Promise.resolve(
          Response.json(
            url.startsWith('https://api.openai.com/')
              ? { data: vectors.map((embedding) => ({ embedding })) }
              : { embeddings: vectors },
          ),
        );
      }),
    );
    const options = { embeddingProviderOptions: { openai: { dimensions: 4 } } };

    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const { read } = await build(ondocs(options), PAGES);
    expect(requests.at(-1)).toMatchObject({
      url: 'https://api.openai.com/v1/embeddings',
      body: { model: 'text-embedding-3-small', dimensions: 4 },
    });
    expect((await read()).embedding).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: 4,
    });

    await rm(join(root, 'node_modules'), { recursive: true });
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-test');
    await build(ondocs(options), PAGES);
    expect(requests.at(-1)).toMatchObject({
      url: expect.stringMatching(/\/embedding-model$/) as string,
      body: { providerOptions: { openai: { dimensions: 4 } } },
    });
  });

  it('blanks "use client" in Radix and cmdk only, keeping source positions', async () => {
    const { updateConfig } = await build(ondocs({ embeddingModel: null }), PAGES);
    const [[{ vite }]] = updateConfig.mock.calls as [
      [
        {
          vite: { plugins: { transform: (code: string, id: string) => { code: string } | null }[] };
        },
      ],
    ];
    const [plugin] = vite.plugins;
    const code = '"use client";\nexport const x = 1;';
    const radix = plugin!.transform(
      code,
      '/app/node_modules/.pnpm/x/node_modules/@radix-ui/react-dialog/dist/index.mjs',
    );
    expect(radix?.code).toBe(`${' '.repeat(13)}\nexport const x = 1;`);
    expect(
      plugin!.transform(code, 'C:\\app\\node_modules\\cmdk\\dist\\index.mjs')?.code,
    ).toHaveLength(code.length);
    expect(plugin!.transform(code, '/app/node_modules/some-lib/index.mjs')).toBeNull();
    expect(
      plugin!.transform('export const x = 1;', '/app/node_modules/cmdk/dist/index.mjs'),
    ).toBeNull();
  });
});
