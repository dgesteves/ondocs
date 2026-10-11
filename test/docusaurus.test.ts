import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ondocs, { llmsOwners } from '../src/docusaurus';
import { parseIndexFile } from '../src/index-file';
import { consoleLogger, warnMissingDialogPeers } from '../src/integration';
import { mockEmbeddingModel } from '../src/mock';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-docusaurus-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A page as Docusaurus 3 builds it: its page type in the classes on <html>, chrome around it. */
const html = (classes: string, title: string, main: string) =>
  `<!doctype html><html lang=en dir=ltr class="${classes}" data-has-hydrated=false><head><title data-rh=true>${title}</title></head>
<body><div id=__docusaurus><nav class="navbar navbar--fixed-top">Docs GitHub</nav><div class=main-wrapper>${main}</div>
<footer class=footer>Copyright</footer></div></body></html>`;

const DOCS = 'docs-wrapper plugin-docs plugin-id-default docs-version-current docs-doc-page';
const BLOG = 'blog-wrapper plugin-blog plugin-id-default';

/** A doc: breadcrumbs, a version badge and the Markdown in an <article>, a TOC beside it. */
const doc = (id: string, title: string, markdown: string, { hideTitle = false } = {}) =>
  html(
    `${DOCS} docs-doc-id-${id}`,
    `${title} | Acme Docs`,
    `<main class=docMainContainer><div class=row><div class=col><article>
<nav class=theme-doc-breadcrumbs aria-label=Breadcrumbs><ul class=breadcrumbs><li class=breadcrumbs__item><a href=/>Home</a><li class=breadcrumbs__item><span>${title}</span></ul></nav>
<span class="theme-doc-version-badge badge badge--secondary">Version: 2.0</span>
<div class="theme-doc-markdown markdown">${hideTitle ? '' : `<header><h1>${title}</h1></header>`}${markdown}</div>
<footer class="theme-doc-footer docusaurus-mt-lg">Edit this page</footer></article>
<nav class="pagination-nav docusaurus-mt-lg" aria-label="Docs pages">Previous Next</nav></div>
<div class="col col--3"><div class=tableOfContents><ul><li><a href=#setup>Setup</a></li></ul></div></div></div></main>`,
  );

/** A <DocCardList> card: an <article> of its own. */
const card = (title: string) =>
  `<article class="docCardListItem_W1sv col col--6"><a class="card padding--lg cardContainer_fWXF" href=/${title.toLowerCase()}><h2 class="text--truncate cardTitle_rnsV" title=${title}>📄️<!-- -->${title}</h2><p class="text--truncate cardDescription_PWke">${title} in detail.</p></a></article>`;

/** A blog post: its title, date and authors in a header, the Markdown in its own container. */
const post = (title: string, markdown: string) =>
  html(
    `${BLOG} blog-post-page`,
    `${title} | Acme Docs`,
    `<main class="col col--7"><article class=""><header><h1 class=title_f1Hy>${title}</h1><div class="container_mt6G margin-vert--md"><time datetime=2026-05-01T00:00:00.000Z>May 1, 2026</time> · <!-- -->One min read</div><div class="margin-top--md margin-bottom--sm row"><div class="col col--6 authorCol_Hf19"><div class="avatar margin-bottom--sm"><div class=avatar__intro><div class=avatar__name><a href=/blog/authors/jane><span>Jane Doe</span></a></div><small>Maintainer</small></div></div></div></div></header>
<div id=__blog-post-container class=markdown>${markdown}</div><footer class="row docusaurus-mt-lg">Tags: release</footer></article>
<nav class=pagination-nav>Older post</nav></main>`,
  );

/** A page listing posts or docs, each in an <article> with its teaser. */
const listing = (classes: string, title: string) =>
  html(
    classes,
    `${title} | Acme Docs`,
    `<main class="col col--7"><h1>${title}</h1>${[1, 2]
      .map(
        (i) =>
          `<article class=margin-bottom--xl><header><h2><a href=/blog/post-${String(i)}>Post ${String(i)}</a></h2></header><div class=markdown><p>Teaser ${String(i)}.</p></div></article>`,
      )
      .join('')}</main>`,
  );

/**
 * A built site, as `postBuild` sees it. A locale other than the default one is built into its
 * own directory, with its own base URL (`/docs/fr/`) and pages in its language.
 */
async function site({ baseUrl = '/', locale = 'en' } = {}) {
  const localized = locale === 'en' ? baseUrl : `${baseUrl}${locale}/`;
  const outDir = join(root, 'build', locale === 'en' ? '' : locale);
  const say = (text: string) => (locale === 'en' ? text : `${text} (${locale})`);
  const files: Record<string, string> = {
    'index.html': doc('intro', 'Introduction', `<p>${say('Welcome to the docs.')}</p>`),
    'guides/setup/index.html': doc(
      'guides/setup',
      'Setup',
      `<h2 class=anchor id=setup>Install<a href=#setup class=hash-link aria-label="Direct link to Install" translate=no>\u200b</a></h2><p>${say('Run the installer.')}</p>`,
    ),
    // trailingSlash: false writes the route as a file.
    'guides/deploy.html': doc('guides/deploy', 'Deploy', `<p>${say('Ship it.')}</p>`),
    'reference/index.html': doc(
      'reference/index',
      'Reference',
      `<p>${say('Every option.')}</p><section class=row>${card('Alpha')}${card('Beta')}</section>
<h2 class=anchor id=defaults>Defaults</h2><p>${say('Defaults apply everywhere.')}</p>`,
    ),
    // `hide_title: true`: the title comes from <title>.
    'faq/index.html': doc('faq', 'FAQ', `<p>${say('Answers live here.')}</p>`, {
      hideTitle: true,
    }),
    'changelog/index.html': doc('changelog', 'Changelog', `<p>${say('1.0 released.')}</p>`),
    // A generated-index category page: a docs page without a doc id, all cards.
    'category/guides/index.html': html(
      DOCS,
      'Guides | Acme Docs',
      `<main><div class=generatedIndexPage><header><h1>Guides</h1><p>All the guides.</p></header><article class=margin-top--lg><section class=row>${card('Setup')}${card('Deploy')}</section></article></div></main>`,
    ),
    // One swizzled to show its description in the article.
    'category/more/index.html': html(
      DOCS,
      'More | Acme Docs',
      `<main><article><h1>More</h1><p>More guides.</p><section class=row>${card('Setup')}</section></article></main>`,
    ),
    'blog/first-post/index.html': post('First post', `<p>${say('We shipped it.')}</p>`),
    'blog/index.html': listing(`${BLOG} blog-list-page`, 'Blog'),
    'blog/page/2/index.html': listing(`${BLOG} blog-list-page`, 'Blog'),
    'blog/tags/index.html': listing(`${BLOG} blog-tags-list-page`, 'Tags'),
    'blog/tags/release/index.html': listing(`${BLOG} blog-tags-post-list-page`, 'Release'),
    'blog/authors/jane/index.html': listing(`${BLOG} blog-authors-posts-page`, 'Jane Doe'),
    'tags/index.html': listing('docs-wrapper plugin-docs docs-tags-list-page', 'Tags'),
    'tags/setup/index.html': listing('docs-wrapper plugin-docs docs-tags-doc-list-page', 'Setup'),
    'about/index.html': html(
      'mdx-wrapper plugin-pages plugin-id-default mdx-page',
      'About | Acme Docs',
      `<main class="container container--fluid margin-vert--lg"><div class=row><div class="col col--8"><article><header><h1>About</h1></header><p>${say('Acme makes docs.')}</p></article></div></div></main>`,
    ),
    // A React page, without a page type or an article.
    'landing/index.html': html(
      'plugin-pages plugin-id-default',
      'Acme Docs',
      '<main><h1>Custom React page</h1></main>',
    ),
    // An older or custom theme, without page types: a page with an article is content.
    'legacy/index.html': `<html><head><title>Legacy | Acme Docs</title></head><body><main><article><h1>Legacy</h1><p>${say('An old theme.')}</p></article></main></body></html>`,
    '404.html': doc('404', 'Page Not Found', '<p>Nothing here.</p>'),
  };
  for (const [file, page] of Object.entries(files)) {
    await mkdir(dirname(join(outDir, file)), { recursive: true });
    await writeFile(join(outDir, file), page);
  }
  const routesPaths = [
    '/',
    ...Object.keys(files)
      .filter((file) => file !== 'index.html')
      .map((file) => `/${file.replace(/(\/index)?\.html$/, '')}`)
      .map((route) => (route === '/404' ? '/404.html' : route)),
  ].map((route) => (route === '/' ? localized : `${localized.replace(/\/$/, '')}${route}`));
  const context = {
    siteDir: root,
    siteConfig: { title: 'Acme Docs', titleDelimiter: '|' },
    baseUrl: localized,
    i18n: { currentLocale: locale },
  };
  return { outDir, routesPaths, context };
}

async function build(s: Awaited<ReturnType<typeof site>>, options = {}) {
  await ondocs(s.context, { embeddingModel: mockEmbeddingModel(), ...options }).postBuild(s);
  return parseIndexFile(await readFile(join(s.outDir, 'ask-index.json'), 'utf8'));
}

describe('ondocs/docusaurus', () => {
  it('indexes docs, blog posts and MDX pages, at the URLs Docusaurus serves', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const index = await build(await site());

    // No blog lists, tag or author pages, generated-index pages, React pages without an
    // article, or 404 page.
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([
      ['/', 'Introduction'],
      ['/about', 'About'],
      ['/blog/first-post', 'First post'],
      ['/changelog', 'Changelog'],
      // From <title>, without the site's title.
      ['/faq', 'FAQ'],
      ['/guides/deploy', 'Deploy'],
      ['/guides/setup', 'Setup'],
      ['/legacy', 'Legacy'],
      ['/reference', 'Reference'],
    ]);
    const text = index.chunks.map((c) => `${c.heading}\n${c.text}`).join('\n');
    // The Markdown only: no navbar, breadcrumbs, version badge, table of contents, pagination,
    // footers, a post's date and authors, or the cards of a <DocCardList>.
    for (const chrome of [
      'GitHub',
      'Home',
      'Version: 2.0',
      'Previous',
      'Edit this page',
      'Copyright',
      'May 1, 2026',
      'One min read',
      'Jane Doe',
      'Tags: release',
      'Teaser',
      'Alpha',
      '📄',
    ]) {
      expect([chrome, text.includes(chrome)]).toEqual([chrome, false]);
    }
    // The text after the cards is kept.
    expect(index.chunks.find((c) => c.anchor === 'defaults')?.text).toBe(
      'Defaults apply everywhere.',
    );
    // The heading permalink's zero-width space is not part of the heading.
    expect(index.chunks.find((c) => c.anchor === 'setup')?.heading).toBe('Install');
    expect(index.embedding?.model).toBe('mock-hash-512');
  });

  it('excludes paths relative to the base URL, in every locale', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exclude = ['/changelog', 'blog/', '/guides/setup'];
    const en = await build(await site({ baseUrl: '/docs/' }), { exclude });
    expect(en.documents.map((d) => d.url)).toEqual([
      '/docs/',
      '/docs/about',
      '/docs/faq',
      '/docs/guides/deploy',
      '/docs/legacy',
      '/docs/reference',
    ]);

    const fr = await build(await site({ baseUrl: '/docs/', locale: 'fr' }), { exclude });
    expect(fr.documents.map((d) => d.url)).toEqual(
      en.documents.map((d) => d.url.replace('/docs/', '/docs/fr/')),
    );
    expect(fr.chunks[0]?.text).toBe('Welcome to the docs. (fr)');
  });

  it('reuses vectors per locale, from node_modules/.cache, and falls back to keyword-only', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const en = await site();
    const fr = await site({ locale: 'fr' });
    // The builds share a folder, as a real one would not, so llms.txt is left out.
    const quiet = { llmsTxt: false };
    await build(en, quiet);
    await build(fr, quiet);
    // Building French did not evict the English vectors, nor the reverse.
    await build(en, quiet);
    await build(fr, quiet);
    for (const call of log.mock.calls.slice(-2)) {
      expect(call[0]).toMatch(
        /^\[ondocs\] Indexed 9 pages into \d+ chunks, 0 embedded, \d+ reused → ask-index\.json/,
      );
    }
    const cache = join(root, 'node_modules', '.cache', 'ondocs');
    expect(existsSync(join(cache, 'en-default.json'))).toBe(true);
    expect(existsSync(join(cache, 'fr-default.json'))).toBe(true);

    await ondocs(en.context, { id: 'second', llmsTxt: false }).postBuild(en);
    expect(warn.mock.calls[0]?.[0]).toContain('No embedding model: building a keyword-only index.');
    expect(
      parseIndexFile(await readFile(join(en.outDir, 'ask-index.json'), 'utf8')).embedding,
    ).toBeNull();
    expect(existsSync(join(cache, 'en-second.json'))).toBe(true);
  });

  it('reuses the vectors cached under ask-my-site, the name before ondocs, on the first build', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const en = await site();
    await build(en, { llmsTxt: false });
    const cache = join(root, 'node_modules', '.cache');
    await rename(join(cache, 'ondocs'), join(cache, 'ask-my-site'));

    await build(en, { llmsTxt: false });
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/ 0 embedded, \d+ reused → /);
    expect(existsSync(join(cache, 'ondocs', 'en-default.json'))).toBe(true);
  });

  it('warns about a swizzled copy of the dialog under its name before ondocs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { context } = await site();
    // A swizzled Root is no concern: it renders whichever it imports.
    await mkdir(join(root, 'src', 'theme', 'Root'), { recursive: true });
    ondocs(context, { embeddingModel: mockEmbeddingModel() });
    expect(warn.mock.calls.filter(([line]) => String(line).includes('AskMySite'))).toEqual([]);

    await writeFile(join(root, 'src', 'theme', 'AskMySite.tsx'), 'export default () => null;\n');
    ondocs(context, { embeddingModel: mockEmbeddingModel() });
    expect(warn.mock.calls.filter(([line]) => String(line).includes('AskMySite'))).toEqual([
      [
        '[ondocs] src/theme/AskMySite.tsx swizzles @theme/AskMySite, which is now @theme/Ondocs, ' +
          'so the dialog no longer uses it. Rename it: git mv src/theme/AskMySite.tsx ' +
          'src/theme/Ondocs.tsx, and change any @theme-original/AskMySite import in it to ' +
          '@theme-original/Ondocs.',
      ],
    ]);
  });

  it('passes embeddingProviderOptions to the default OpenAI and AI Gateway models', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const requests: { url: string; body: { input?: string[]; values?: string[] } }[] = [];
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
    const s = await site();
    const options = { embeddingProviderOptions: { openai: { dimensions: 4 } } };

    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    await ondocs(s.context, options).postBuild(s);
    expect(requests.at(-1)).toMatchObject({
      url: 'https://api.openai.com/v1/embeddings',
      body: { model: 'text-embedding-3-small', dimensions: 4 },
    });
    const index = parseIndexFile(await readFile(join(s.outDir, 'ask-index.json'), 'utf8'));
    expect(index.embedding).toMatchObject({ model: 'text-embedding-3-small', dimensions: 4 });
    expect(index.embedding?.settings).toBeDefined();

    // Without the cache, so the gateway embeds every chunk again.
    await rm(join(root, 'node_modules'), { recursive: true });
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-test');
    await ondocs(s.context, options).postBuild(s);
    expect(requests.at(-1)).toMatchObject({
      url: expect.stringMatching(/\/embedding-model$/) as string,
      body: { providerOptions: { openai: { dimensions: 4 } } },
    });
  });

  it('names the packages the dialog needs when the site lacks them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { context } = await site();
    // Installed here, as the site's own packages.
    ondocs(context, {});
    expect(warn).not.toHaveBeenCalled();

    // Resolved from a folder with only cmdk installed.
    await mkdir(join(root, 'node_modules', 'cmdk'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'cmdk', 'index.js'), '');
    await writeFile(join(root, 'node_modules', 'cmdk', 'package.json'), '{"name":"cmdk"}');
    warnMissingDialogPeers(consoleLogger(), pathToFileURL(join(root, 'site.js')));
    expect(warn).toHaveBeenCalledWith(
      '[ondocs] The ask dialog renders with react, react-dom, @radix-ui/react-dialog, which are not installed: npm i react react-dom @radix-ui/react-dialog',
    );
  });

  it('posts to ASK_ENDPOINT when set, and says once how to get answers in docusaurus start', async () => {
    // The hint shows once per process.
    Reflect.deleteProperty(globalThis, Symbol.for('ondocs.devEndpointHint'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { context } = await site();
    const setGlobalData = vi.fn();
    const load = (options = {}) => {
      ondocs(context, options).contentLoaded({ actions: { setGlobalData } });
    };
    // A build says nothing.
    load();
    expect(log).not.toHaveBeenCalled();

    vi.stubEnv('NODE_ENV', 'development');
    // An endpoint elsewhere needs no hint; the site's own path does, once across reloads.
    load({ endpoint: 'https://api.example.com/ask' });
    load();
    load();
    expect(log.mock.calls).toEqual([
      [
        '[ondocs] The dialog posts to /api/ask, which docusaurus start does not serve. For answers while you work, build the site once, run `npx ondocs dev`, and start the site with ASK_ENDPOINT=http://localhost:8787/api/ask.',
      ],
    ]);

    vi.stubEnv('ASK_ENDPOINT', 'http://localhost:8787/api/ask');
    load();
    expect(setGlobalData).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:8787/api/ask' }),
    );
    // Over a configured endpoint too: the README's config sets one, and its local-dev steps
    // start the site with ASK_ENDPOINT, which must win or the dialog posts to a 404.
    load({ endpoint: '/api/ask' });
    expect(setGlobalData).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:8787/api/ask' }),
    );
    vi.stubEnv('ASK_ENDPOINT', '');
    load({ endpoint: 'https://api.example.com/ask' });
    expect(setGlobalData).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: 'https://api.example.com/ask' }),
    );
  });

  it('writes llms.txt, llms-full.txt and a .md per indexed page into the build', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await site({ baseUrl: '/docs/' });
    const context = {
      ...s.context,
      siteConfig: { ...s.context.siteConfig, url: 'https://acme.dev', tagline: 'Docs for Acme.' },
    };
    await ondocs(context, { embeddingModel: mockEmbeddingModel(), mcp: '/api/mcp' }).postBuild(s);
    const llms = await readFile(join(s.outDir, 'llms.txt'), 'utf8');
    expect(llms.split('\n').slice(0, 3)).toEqual(['# Acme Docs', '', '> Docs for Acme.']);
    expect(llms).toContain('- [Setup](https://acme.dev/docs/guides/setup.md)');
    expect(llms).toContain(
      'MCP, with search, fetch and list_pages tools: https://acme.dev/api/mcp',
    );
    // Excluded and listing pages are no more in it than in the index.
    expect(llms).not.toMatch(/tags|Blog list/i);
    const setup = await readFile(join(s.outDir, 'guides/setup.md'), 'utf8');
    expect(setup).toBe(
      '> From Acme Docs. Every page, as Markdown: https://acme.dev/docs/llms.txt\n\n# Setup\n\n## Install\n\nRun the installer.\n',
    );
    expect(existsSync(join(s.outDir, 'index.md'))).toBe(true);
    expect(await readFile(join(s.outDir, 'llms-full.txt'), 'utf8')).toContain(
      'Source: https://acme.dev/docs/guides/setup\n',
    );
  });

  it('links each page to its .md copy in its <head>, under the base URL and locale', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await site({ baseUrl: '/docs/', locale: 'fr' });
    await ondocs(s.context, {
      embeddingModel: mockEmbeddingModel(),
      exclude: ['/changelog'],
    }).postBuild(s);
    const read = (file: string) => readFile(join(s.outDir, file), 'utf8');
    const links = async (file: string) =>
      [
        ...(await read(file)).matchAll(
          /<link rel="alternate" type="text\/markdown" href="([^"]*)">/g,
        ),
      ].map((match) => match[1]);
    expect(await links('index.html')).toEqual(['/docs/fr/index.md']);
    expect(await links('guides/setup/index.html')).toEqual(['/docs/fr/guides/setup.md']);
    // Written as a file, as with trailingSlash: false.
    expect(await links('guides/deploy.html')).toEqual(['/docs/fr/guides/deploy.md']);
    expect(await links('blog/first-post/index.html')).toEqual(['/docs/fr/blog/first-post.md']);
    expect(await links('about/index.html')).toEqual(['/docs/fr/about.md']);
    // Each link is to a copy the build has.
    expect(existsSync(join(s.outDir, 'guides/setup.md'))).toBe(true);
    expect(await read('guides/setup/index.html')).toContain(
      '<link rel="alternate" type="text/markdown" href="/docs/fr/guides/setup.md"></head>',
    );
    // Pages without a copy have no link: listings, generated indexes, React pages, excluded
    // pages and the 404 page.
    for (const file of [
      'blog/index.html',
      'tags/index.html',
      'category/guides/index.html',
      'landing/index.html',
      'changelog/index.html',
      '404.html',
    ]) {
      expect([file, await links(file)]).toEqual([file, []]);
    }
  });

  it('links no page to a copy another plugin writes, or with llmsTxt: false', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await site();
    await ondocs(s.context, { embeddingModel: mockEmbeddingModel() }).postBuild({
      ...s,
      plugins: [{ name: 'docusaurus-plugin-llms', options: { generateMarkdownFiles: true } }],
    });
    expect(await readFile(join(s.outDir, 'guides/setup/index.html'), 'utf8')).not.toContain(
      'text/markdown',
    );
    const off = await site({ locale: 'fr' });
    await ondocs(off.context, { embeddingModel: mockEmbeddingModel(), llmsTxt: false }).postBuild(
      off,
    );
    expect(await readFile(join(off.outDir, 'guides/setup/index.html'), 'utf8')).not.toContain(
      'text/markdown',
    );
  });

  it('leaves the llms files to docusaurus-plugin-llms, and writes none with llmsTxt: false', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await site();
    await ondocs(s.context, { embeddingModel: mockEmbeddingModel() }).postBuild({
      ...s,
      plugins: [
        { name: 'docusaurus-plugin-content-docs' },
        { name: 'docusaurus-plugin-llms', options: { generateMarkdownFiles: false } },
      ],
    });
    expect(existsSync(join(s.outDir, 'llms.txt'))).toBe(false);
    expect(existsSync(join(s.outDir, 'llms-full.txt'))).toBe(false);
    expect(existsSync(join(s.outDir, 'guides/setup.md'))).toBe(true);
    expect(log).toHaveBeenCalledWith(
      '[ondocs] docusaurus-plugin-llms writes llms.txt, so ondocs does not.',
    );

    const clean = await site({ locale: 'fr' });
    await ondocs(clean.context, {
      embeddingModel: mockEmbeddingModel(),
      llmsTxt: false,
    }).postBuild(clean);
    expect(existsSync(join(clean.outDir, 'llms.txt'))).toBe(false);
    expect(existsSync(join(clean.outDir, 'guides/setup.md'))).toBe(false);
  });

  it('knows which llms files each llms plugin writes, from its options', () => {
    const owners = (name: string, options?: unknown) =>
      Object.fromEntries(llmsOwners([{ name, options }]));
    expect(owners('docusaurus-plugin-llms')).toEqual({
      index: 'docusaurus-plugin-llms',
      full: 'docusaurus-plugin-llms',
    });
    expect(
      owners('docusaurus-plugin-llms', { generateMarkdownFiles: true, generateLLMsFullTxt: false }),
    ).toEqual({
      index: 'docusaurus-plugin-llms',
      markdown: 'docusaurus-plugin-llms',
    });
    expect(owners('docusaurus-plugin-llms-txt')).toEqual({
      index: 'docusaurus-plugin-llms-txt',
      markdown: 'docusaurus-plugin-llms-txt',
    });
    expect(
      owners('docusaurus-plugin-llms-txt', {
        content: { enableMarkdownFiles: false, enableLlmsFullTxt: true },
      }),
    ).toEqual({ index: 'docusaurus-plugin-llms-txt', full: 'docusaurus-plugin-llms-txt' });
    expect(owners('copy-page-button-plugin', { generateMarkdownRoutes: true })).toEqual({
      markdown: 'copy-page-button-plugin',
    });
    expect(owners('copy-page-button-plugin')).toEqual({});
  });

  it('resolves the MCP endpoint against the site URL, for <OndocsMcp />', async () => {
    const { context } = await site();
    const withUrl = {
      ...context,
      siteConfig: { ...context.siteConfig, url: 'https://docs.acme.dev' },
    };
    const setGlobalData = vi.fn();
    ondocs(withUrl, { mcp: '/api/mcp' }).contentLoaded({ actions: { setGlobalData } });
    expect(setGlobalData).toHaveBeenLastCalledWith(
      expect.objectContaining({ mcp: { url: 'https://docs.acme.dev/api/mcp', name: 'acme-docs' } }),
    );
    ondocs(context, { mcp: { url: 'https://mcp.acme.dev/', name: 'Acme' } }).contentLoaded({
      actions: { setGlobalData },
    });
    expect(setGlobalData).toHaveBeenLastCalledWith(
      expect.objectContaining({ mcp: { url: 'https://mcp.acme.dev/', name: 'acme' } }),
    );
    // A path needs the site's URL to become one a client can reach.
    expect(() => ondocs(context, { mcp: '/api/mcp' })).toThrow(/needed to make it absolute/);
  });

  it('hands the dialog its settings, and points Docusaurus at files that exist', async () => {
    const { context } = await site();
    const plugin = ondocs(context, {
      endpoint: 'https://api.example.com/ask',
      dialog: { shortcut: false },
    });
    const setGlobalData = vi.fn();
    plugin.contentLoaded({ actions: { setGlobalData } });
    expect(setGlobalData).toHaveBeenCalledWith({
      endpoint: 'https://api.example.com/ask',
      dialog: { shortcut: false, title: 'Ask Acme Docs' },
    });
    // Root renders Ondocs, which a site can also render from its own swizzled Root.
    for (const component of ['Root.tsx', 'Ondocs.tsx', 'OndocsMcp.tsx']) {
      expect(existsSync(join(plugin.getThemePath(), component))).toBe(true);
    }
    expect(existsSync(plugin.getClientModules()[1]!)).toBe(true);
  });
});
