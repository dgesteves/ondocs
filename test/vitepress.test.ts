// ondocs/vitepress: withOndocs, its hooks and its Vite plugin, and a real `vitepress build` of
// test/fixtures/vitepress-site, which moves pages with each setting VitePress has for it.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { defineConfig } from 'vitepress';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { parseIndexFile } from '../src/index-file';
import withOndocsDefault, {
  launcherModule,
  llmsOwners,
  navbarButtonModule,
  pageLocation,
  withNavbarButton,
  withOndocs,
  type VitePressSiteConfig,
} from '../src/vitepress';

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('ASK_ENDPOINT', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

interface Plugin {
  name: string;
  config?: () => unknown;
  configResolved?: (config: { vitepress?: VitePressSiteConfig }) => void;
  resolveId?: (id: string) => string | null;
  load?: (id: string) => string | null;
  transform?: (code: string, id: string, options?: { ssr?: boolean }) => { code: string } | null;
}

const pluginsOf = (config: { vite?: { plugins?: unknown[] } }) =>
  (config.vite?.plugins ?? []) as Plugin[];

const SITE: VitePressSiteConfig = {
  root: '/site',
  outDir: '/site/.vitepress/dist',
  pages: [],
  rewrites: { map: {} },
  site: {
    base: '/docs/',
    title: 'Acme',
    description: 'Docs for Acme.',
    locales: { root: { title: 'Acme' }, fr: { title: 'Acme FR' } },
  },
};

describe('pageLocation', () => {
  it.each([
    ['index.md', false, '/docs/', 'index.html'],
    ['guide/index.md', false, '/docs/guide/', 'guide/index.html'],
    ['guide/setup.md', false, '/docs/guide/setup.html', 'guide/setup.html'],
    ['guide/setup.md', true, '/docs/guide/setup', 'guide/setup.html'],
    ['fr/index.md', true, '/docs/fr/', 'fr/index.html'],
  ])('%s, with cleanUrls %s, is at %s, in %s', (file, cleanUrls, url, html) => {
    expect(pageLocation(file, { base: '/docs/', cleanUrls })).toMatchObject({ url, html });
  });
});

describe('withOndocs', () => {
  it('keeps the config’s type, its settings, its Vite plugins and its hooks', async () => {
    const own = { name: 'own-plugin' };
    const buildEnd = vi.fn();
    const transformHtml = vi.fn(() => '<html>own</html>');
    const config = defineConfig({
      title: 'Acme',
      cleanUrls: true,
      vite: { plugins: [own], logLevel: 'warn' },
      transformHtml,
      buildEnd,
    });
    const wrapped = withOndocs(config, { embedding: 'none' });
    expectTypeOf(wrapped).toEqualTypeOf<typeof config>();
    expect(withOndocsDefault).toBe(withOndocs);
    expect(wrapped).toMatchObject({ title: 'Acme', cleanUrls: true, vite: { logLevel: 'warn' } });
    expect(pluginsOf(wrapped).map((plugin) => plugin.name)).toEqual([
      'own-plugin',
      'ondocs',
      'ondocs:quiet-use-client',
    ]);
    const context = { page: 'index.md', title: 'Acme', pageData: { title: '' } };
    await expect(
      wrapped.transformHtml?.('<html></html>', 'index.html', context as never),
    ).resolves.toBe('<html>own</html>');
    expect(transformHtml).toHaveBeenCalledWith('<html></html>', 'index.html', context);
  });

  it('checks its options before anything is built', () => {
    expect(() => withOndocs({}, { embedding: 'mock', embeddingModel: null })).toThrow(
      /pass `embedding` or `embeddingModel`, not both/,
    );
    expect(() => withOndocs({}, { mcp: '/api/mcp' })).toThrow(
      /the site's URL is needed.*siteUrl option, or sitemap.hostname/,
    );
    expect(() =>
      withOndocs({ sitemap: { hostname: 'https://acme.dev' } }, { mcp: '/api/mcp' }),
    ).not.toThrow();
    expect(() =>
      withOndocs(
        { sitemap: { hostname: 'https://acme.dev' } },
        { mcp: 'https://<your-site>/api/mcp' },
      ),
    ).toThrow(/mcp: 'https:\/\/<your-site>\/api\/mcp' is not a valid URL/);
  });

  it('names the packages the dialog needs when the site lacks them', () => {
    // They are all here, in the repository's own dependencies.
    withOndocs({});
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('the launcher', () => {
  const plugin = (options = {}) => {
    const found = pluginsOf(withOndocs({}, options)).find(({ name }) => name === 'ondocs');
    if (!found) throw new Error('no ondocs plugin');
    return found;
  };
  const APP =
    '/site/node_modules/.pnpm/vitepress@1.6.4/node_modules/vitepress/dist/client/app/index.js';

  it('is imported by VitePress’s client entry, in the browser only, dynamically', () => {
    const { transform } = plugin();
    expect(transform?.('createApp();', APP)?.code).toBe(
      'createApp();\nimport("virtual:ondocs/launcher");\n',
    );
    // The SSR build renders the pages: there is no document to mount on.
    expect(transform?.('createApp();', APP, { ssr: true })).toBeNull();
    expect(
      transform?.('x', 'C:\\site\\node_modules\\vitepress\\dist\\client\\app\\index.js'),
    ).not.toBeNull();
    expect(transform?.('x', '/site/node_modules/vitepress/dist/client/app/router.js')).toBeNull();
    expect(transform?.('x', '/site/.vitepress/theme/index.js')).toBeNull();
  });

  it('serves the launcher module, made from the resolved site config', () => {
    const { resolveId, load, configResolved, config } = plugin({
      dialog: { suggestions: ['Why?'] },
    });
    expect(config?.()).toEqual({ optimizeDeps: { include: ['ondocs/embed'] } });
    const id = resolveId?.('virtual:ondocs/launcher');
    expect(id).toBe('\0virtual:ondocs/launcher');
    expect(resolveId?.('vue')).toBeNull();
    configResolved?.({ vitepress: SITE });
    const source = load?.(id ?? '') ?? '';
    expect(source).toBe(launcherModule('/api/ask', { dialog: { suggestions: ['Why?'] } }, SITE));
    expect(source).toContain('"title":"Ask Acme"');
    expect(source).toContain('"fr":{"title":"Ask Acme FR","locale":"fr"}');
    expect(source).toContain('location.pathname.slice(5)');
  });

  it('mounts with the stylesheets, follows VitePress’s dark mode, and remounts per locale', () => {
    const source = launcherModule('/api/ask', {}, SITE);
    expect(source.split('\n').slice(0, 3)).toEqual([
      'import "ondocs/react/styles.css";',
      'import "ondocs/embed/launcher.css";',
      'import "ondocs/vitepress/launcher.css";',
    ]);
    expect(source).toContain("root.classList.contains('dark') ? 'dark' : 'light'");
    expect(source).toContain("attributeFilter: ['lang']");
    // A theme of its own leaves the page's attributes alone.
    expect(launcherModule('/api/ask', { dialog: { theme: 'dark' } }, SITE)).not.toContain(
      'classList',
    );
  });
});

describe('the navbar button (dialog.navbar)', () => {
  const require = createRequire(import.meta.url);
  // VitePress's own files, and the Vue compiler it brings.
  const vitepress = dirname(dirname(dirname(require.resolve('vitepress'))));
  const fromVitePress = createRequire(join(vitepress, 'package.json'));
  const SEARCH = join(vitepress, 'dist/client/theme-default/components/VPNavBarSearch.vue');
  const navbarPlugin = (options = {}) =>
    pluginsOf(withOndocs({}, options)).find(({ name }) => name === 'ondocs:navbar');

  it('is added only with the option', () => {
    expect(navbarPlugin()).toBeUndefined();
    expect(navbarPlugin({ dialog: { navbar: true } })).toMatchObject({ enforce: 'pre' });
  });

  it('renders the button last in the default theme’s nav bar search, on the server and in the browser', () => {
    const plugin = navbarPlugin({ dialog: { navbar: true } });
    const sfc = readFileSync(SEARCH, 'utf8');
    const transformed = plugin?.transform?.(sfc, SEARCH)?.code ?? '';
    expect(transformed).toBe(withNavbarButton(sfc));
    // The same with ssr: VitePress renders the nav bar on the server too.
    expect(plugin?.transform?.(sfc, SEARCH, { ssr: true })?.code).toBe(transformed);
    expect(plugin?.transform?.(sfc, '/site/.vitepress/theme/VPNavBarSearch.vue')).toBeNull();
    // The compiler VitePress builds the theme with: the file must still be a valid component.
    const { parse } = fromVitePress('vue/compiler-sfc') as {
      parse: (source: string) => {
        descriptor: {
          scriptSetup: { content: string } | null;
          template: { content: string } | null;
        };
        errors: unknown[];
      };
    };
    const { descriptor, errors } = parse(transformed);
    expect(errors).toEqual([]);
    expect(descriptor.scriptSetup?.content).toContain(
      'import OndocsNavbarButton from "virtual:ondocs/navbar-button";',
    );
    expect(descriptor.template?.content.trim()).toMatch(
      /^<div class="VPNavBarSearch">[\s\S]*<OndocsNavbarButton \/><\/div>$/,
    );
  });

  it('warns once, and leaves the file, when the nav bar search is not as it knows it', () => {
    const warn = vi.mocked(console.warn);
    const plugin = navbarPlugin({ dialog: { navbar: true } });
    const odd = '<template><nav /></template>';
    expect(withNavbarButton(odd)).toBeNull();
    expect(plugin?.transform?.(odd, SEARCH)).toBeNull();
    expect(plugin?.transform?.(odd, SEARCH)).toBeNull();
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes('dialog.navbar')),
    ).toHaveLength(1);
  });

  it('serves the button: a label and Ctrl key per locale, and the shortcut', () => {
    const plugin = navbarPlugin({
      dialog: {
        navbar: true,
        shortcut: 'j',
        locales: { fr: { labels: { launcher: 'Demander', controlKey: 'Strg' } } },
      },
    });
    plugin?.configResolved?.({ vitepress: SITE });
    const id = plugin?.resolveId?.('virtual:ondocs/navbar-button') ?? '';
    expect(id).toBe('\0virtual:ondocs/navbar-button');
    const source = plugin?.load?.(id) ?? '';
    expect(source).toBe(
      navbarButtonModule(
        {
          navbar: true,
          shortcut: 'j',
          locales: { fr: { labels: { launcher: 'Demander', controlKey: 'Strg' } } },
        },
        ['fr'],
      ),
    );
    // Run in a stand-in Vue: the button the render function makes, in French.
    interface Node {
      tag: string;
      props: Record<string, unknown>;
      children: unknown;
    }
    const body = source
      .split('\n')
      .filter((line) => !line.startsWith('import'))
      .join('\n')
      .replace('export default', 'return');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function('defineComponent', 'h', 'useData', body) as (
      ...args: unknown[]
    ) => unknown;
    const component = run(
      (definition: unknown) => definition,
      (tag: string, props: Record<string, unknown>, children: unknown): Node => ({
        tag,
        props,
        children,
      }),
      () => ({ localeIndex: { value: 'fr' } }),
    ) as { setup: () => () => Node };
    const button = component.setup()();
    expect(button.tag).toBe('button');
    expect(button.props).toEqual({
      type: 'button',
      class: 'ondocs-button',
      'data-ondocs-open': '',
      'aria-haspopup': 'dialog',
      'aria-keyshortcuts': 'Meta+J Control+J',
    });
    expect(button.children).toEqual([
      { tag: 'span', props: { class: 'ondocs-button-label' }, children: 'Demander' },
      { tag: 'kbd', props: { 'aria-hidden': 'true', 'data-control': 'Strg' }, children: 'J' },
    ]);
  });

  it('takes the button’s look with it, and leaves the floating button off', () => {
    const source = launcherModule('/api/ask', { dialog: { navbar: 'Ask the docs' } }, SITE);
    expect(source.split('\n').slice(0, 4)).toEqual([
      'import "ondocs/react/styles.css";',
      'import "ondocs/embed/launcher.css";',
      'import "ondocs/embed/button.css";',
      'import "ondocs/vitepress/launcher.css";',
    ]);
    expect(source).toContain('"launcher":false');
    expect(source).not.toContain('navbar');
    expect(navbarButtonModule({ navbar: 'Ask the docs', shortcut: false }, [])).toContain(
      'const buttons = {"root":{"label":"Ask the docs","controlKey":"Ctrl"}};\nconst key = "";',
    );
  });
});

describe('llmsOwners', () => {
  it('leaves the llms files to vitepress-plugin-llms, which adds two Vite plugins', () => {
    const owners = llmsOwners([
      [{ name: 'vitepress-plugin-llms:llm-tags' }, { name: 'vitepress-plugin-llms' }],
      null,
    ]);
    expect([...owners]).toEqual([
      ['index', 'vitepress-plugin-llms'],
      ['full', 'vitepress-plugin-llms'],
      ['markdown', 'vitepress-plugin-llms'],
    ]);
    expect(llmsOwners([{ name: 'other' }]).size).toBe(0);
  });
});

describe('a VitePress build', () => {
  const fixture = join(import.meta.dirname, 'fixtures/vitepress-site');
  let outDir: string;
  const read = (path: string) => readFileSync(join(outDir, path), 'utf8');
  const index = (path = 'ask-index.json') => parseIndexFile(read(path));
  /** The built file a URL under /docs/ is served from, as VitePress writes it with cleanUrls. */
  const builtFile = (url: string) => {
    const path = url.replace(/^\/docs\//, '');
    return path === '' || path.endsWith('/') ? `${path}index.html` : `${path}.html`;
  };

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'ondocs-vitepress-'));
    // In a process of its own, as a site builds: Vitest runs tests with Node's `development`
    // condition, under which VitePress's server build cannot resolve vue/server-renderer.
    const script = `const { build } = await import('vitepress'); await build(${JSON.stringify(fixture)}, { outDir: ${JSON.stringify(outDir)} });`;
    const { OPENAI_API_KEY: _key, AI_GATEWAY_API_KEY: _gateway, ...env } = process.env;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...env, NODE_ENV: 'production' },
    });
  }, 180_000);
  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
    // The vectors the plugin keeps for the next build, under the repository's node_modules.
    for (const locale of ['root', 'fr']) {
      await rm(
        join(import.meta.dirname, `../node_modules/.cache/ondocs/vitepress-${locale}.json`),
        {
          force: true,
        },
      );
    }
  });

  it('indexes the pages at the URLs VitePress serves, each locale on its own', () => {
    // Rewritten from guide/ to manual/, under base, without .html; drafts/ is in srcExclude,
    // manual/old in `exclude`, about.md has search: false, and the home page has no Markdown.
    expect(index().documents.map(({ url, title }) => [url, title])).toEqual([
      ['/docs/manual/', 'Guide'],
      ['/docs/manual/faq', 'FAQ'],
      ['/docs/manual/setup', 'Setup'],
      ['/docs/packages/bar', 'Package bar'],
      ['/docs/packages/foo', 'Package foo'],
    ]);
    expect(index('fr/ask-index.json').documents.map(({ url, title }) => [url, title])).toEqual([
      ['/docs/fr/', 'Accueil'],
      ['/docs/fr/guide/setup', 'Installation'],
    ]);
    expect(index().embedding).toMatchObject({ dimensions: 32 });
  });

  it('indexes only URLs that are built pages', () => {
    for (const file of ['ask-index.json', 'fr/ask-index.json']) {
      for (const { url } of index(file).documents) {
        expect([url, existsSync(join(outDir, builtFile(url)))]).toEqual([url, true]);
      }
    }
  });

  it('reads the page’s Markdown, without the anchors and code labels VitePress adds', () => {
    const { documents, chunks } = index();
    const doc = documents.findIndex(({ url }) => url === '/docs/manual/setup');
    const setup = chunks.filter((chunk) => chunk.doc === doc);
    const text = setup.map((chunk) => chunk.text).join('\n');
    expect(text).toContain('Run the installer.');
    expect(text).toContain('npm i acme');
    expect(text).not.toMatch(/\u200b|Copy Code|^sh$/m);
    expect(setup.map((chunk) => chunk.anchor)).toContain('requirements');
  });

  it('writes llms.txt, llms-full.txt and the .md pages per locale, with the pages’ own descriptions', () => {
    const llms = read('llms.txt');
    expect(llms.split('\n').slice(0, 3)).toEqual(['# Acme', '', '> Docs for Acme.']);
    expect(llms).toContain('- [Setup](https://acme.dev/docs/manual/setup.md): Install Acme.');
    expect(llms).toContain('- [FAQ](https://acme.dev/docs/manual/faq.md)\n');
    expect(llms).toContain('https://acme.dev/api/mcp');
    expect(read('fr/llms.txt').split('\n').slice(0, 3)).toEqual([
      '# Acme FR',
      '',
      '> La doc d’Acme.',
    ]);
    for (const page of ['manual.md', 'manual/setup.md', 'packages/foo.md', 'fr/index.md']) {
      expect([page, existsSync(join(outDir, page))]).toEqual([page, true]);
    }
    expect(read('manual/setup.md')).toContain('# Setup\n\nRun the installer.');
    expect(existsSync(join(outDir, 'llms-full.txt'))).toBe(true);
    expect(existsSync(join(outDir, 'fr/llms-full.txt'))).toBe(true);
  });

  it('links each indexed page to its .md copy in its <head>, under base and per locale', () => {
    const links = (file: string) =>
      [...read(file).matchAll(/<link rel="alternate" type="text\/markdown" href="([^"]*)">/g)].map(
        (match) => match[1],
      );
    expect(links('manual/index.html')).toEqual(['/docs/manual.md']);
    expect(links('manual/setup.html')).toEqual(['/docs/manual/setup.md']);
    expect(links('packages/foo.html')).toEqual(['/docs/packages/foo.md']);
    expect(links('fr/index.html')).toEqual(['/docs/fr/index.md']);
    expect(links('fr/guide/setup.html')).toEqual(['/docs/fr/guide/setup.md']);
    expect(read('manual/setup.html')).toMatch(
      /<link rel="alternate" type="text\/markdown" href="\/docs\/manual\/setup\.md"><\/head>/,
    );
    // The home page has no Markdown, about.md has search: false, manual/old is excluded.
    for (const file of ['index.html', 'about.html', 'manual/old.html', '404.html']) {
      expect([file, links(file)]).toEqual([file, []]);
    }
  });

  it('adds the launcher to every page, preloaded, and loads the dialog only when it is wanted', () => {
    const chunks = readdirSync(join(outDir, 'assets/chunks'));
    const launcher = chunks.find((file) =>
      read(`assets/chunks/${file}`).includes('ondocs-launcher'),
    );
    const dialog = chunks.find((file) => read(`assets/chunks/${file}`).includes('ask-dialog'));
    expect(launcher).toBeDefined();
    expect(dialog).toBeDefined();
    expect(launcher).not.toBe(dialog);
    expect(read(`assets/chunks/${launcher ?? ''}`)).toContain('Ask Acme FR');
    for (const page of ['manual/setup.html', 'fr/index.html', 'index.html']) {
      const html = read(page);
      expect(html).toContain(
        `<link rel="modulepreload" href="/docs/assets/chunks/${launcher ?? ''}">`,
      );
      expect(html).not.toContain(dialog ?? '');
    }
    const css = readdirSync(join(outDir, 'assets')).find((file) => file.endsWith('.css')) ?? '';
    expect(read(`assets/${css}`)).toContain('.ondocs-launcher');
    expect(read(`assets/${css}`)).toContain(
      '#app:has(>.Layout)~.ondocs .ondocs-launcher{--ask-launcher-bg: var(--vp-c-bg-elv)',
    );
  });

  it('runs the site’s own hooks: transformHtml, and buildEnd before the index', () => {
    expect(read('manual/setup.html')).toContain('<!-- own transformHtml --></body>');
    expect(read('own-build-end.txt')).toBe('first');
  });
});
