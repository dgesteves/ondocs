/**
 * ondocs/vitepress: a VitePress plugin. Wrap the site's config in `withOndocs`, and after
 * `vitepress build` it indexes the pages VitePress wrote into `ask-index.json` in the build output
 * (one per locale), at the URLs VitePress serves them from, writes `llms.txt`, `llms-full.txt`
 * and a Markdown copy of each page, and adds the ask dialog to every page, opened from a floating
 * button or ⌘/Ctrl+I.
 *
 * The answers come from an endpoint you deploy next to the site (a function running
 * `createAskHandler` from `ondocs/server`, which `npx ondocs init` writes); see the docs.
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import {
  buildEmbedding,
  checkIndexOptions,
  consoleLogger,
  dialogEndpoint,
  excluder,
  hintDevEndpoint,
  indexCache,
  LAUNCHER_STYLESHEETS,
  launcherScript,
  llmsOutputs,
  loadBuiltPage,
  quietUseClient,
  readBuiltHtml,
  resolveMcp,
  warnMissingDialogPeers,
  writeLlmsFiles,
  writeSiteIndex,
  type IndexOptions,
  type LlmsOutput,
  type LlmsPage,
  type LlmsTxtOption,
  type LocaleDialogOptions,
  type Logger,
  type McpOption,
  type OndocsDialogOptions as DialogOptions,
  type OndocsTheme,
  type SourceDocument,
} from '../integration';

/** What the dialog shows in one locale, over the dialog's own options. */
export type OndocsLocaleDialogOptions = LocaleDialogOptions;

/** What the dialog shows; passed to `mountAskDialog` from `ondocs/embed`. */
export interface OndocsDialogOptions extends DialogOptions {
  /** The dialog's accessible name. Default "Ask {site title}", in each locale its own. */
  title?: string;
  /** Default `auto`: VitePress's light or dark mode, as its appearance switch sets it. */
  theme?: OndocsTheme;
  /**
   * Options for each locale, by its key in VitePress's `locales` (`fr`, `pt`), over these: the
   * labels, the title and the suggestions in that language. The dialog sends the locale with
   * each question, so the endpoint answers from that locale's index.
   */
  locales?: Record<string, OndocsLocaleDialogOptions>;
}

export interface OndocsOptions extends IndexOptions {
  /**
   * URL the dialog posts questions to. Default `/api/ask`. The `ASK_ENDPOINT` environment
   * variable, when it is set as the site builds or starts, takes precedence over it:
   * `ASK_ENDPOINT=http://localhost:8787/api/ask` points the dialog at `ondocs dev`.
   */
  endpoint?: string;
  /**
   * The part of each page to index, as a selector: a tag name, `#id`, `.class` or `[attribute]`,
   * combined as in `div.prose` or listed as in `main, .post`. Default `.vp-doc`, the default
   * theme's container of the page's Markdown, without the navigation, sidebar, outline or doc
   * footer. A page where it matches nothing is not indexed.
   */
  content?: string;
  /**
   * Elements to leave out of `content`, as a selector like it, e.g. `.toc, .comments`, besides
   * the heading anchors and code blocks' language labels, which are always left out.
   */
  ignore?: string;
  /** Where the index is written in the build output, and served from. Default `ask-index.json`. */
  indexFile?: string;
  /**
   * Paths to leave out, relative to `base` and the locale, e.g. `['/changelog']` (a prefix
   * matches its subpages too). With `base: '/docs/'`, `/changelog` leaves out `/docs/changelog`
   * and, in French, `/docs/fr/changelog`. Pages with `search: false` in their frontmatter are
   * left out too, as VitePress's local search leaves them out.
   */
  exclude?: string[];
  dialog?: OndocsDialogOptions;
  /**
   * The site's URL, such as `https://docs.acme.dev`, for absolute links in `llms.txt` and to
   * resolve `mcp` when it is a path. Default: `sitemap.hostname`.
   */
  siteUrl?: string;
  /**
   * The site's MCP endpoint (`createMcpHandler` from `ondocs/server`), as an absolute URL or a
   * path on the site such as `/api/mcp` (then `siteUrl` or `sitemap.hostname` must be set), and
   * optionally the name clients list it under (default: from the site title). `llms.txt` points
   * agents at it.
   */
  mcp?: McpOption;
  /**
   * After the build, also write `llms.txt`, `llms-full.txt` and a Markdown copy of each indexed
   * page at its URL plus `.md` (`/guide/setup.md`), into the build output, per locale as the
   * index is, and link each page to its copy with `<link rel="alternate" type="text/markdown">`.
   * On by default; `false` turns all three off, and `{ index: false }`,
   * `{ full: false }` or `{ markdown: false }` one of them. A file the build already has (from
   * `public/` or another plugin) is left as it is, and what vitepress-plugin-llms writes is left
   * to it.
   */
  llmsTxt?: LlmsTxtOption;
}

/** A hook of VitePress's config, typed loosely so that any config's hooks fit. */
type Hook = (...args: never[]) => unknown;

/** The parts of a VitePress config, as `defineConfig` takes it, that `withOndocs` reads or adds to. */
export interface VitePressConfig {
  title?: string;
  vite?: { plugins?: unknown[] };
  sitemap?: { hostname?: string };
  transformHtml?: Hook;
  buildEnd?: Hook;
}

/** A locale of VitePress's resolved site data. */
interface LocaleData {
  title?: string;
  description?: string;
}

/** The parts of VitePress's resolved site config that `buildEnd` and the Vite plugin read. */
export interface VitePressSiteConfig {
  root: string;
  outDir: string;
  /** The Markdown files that are pages, relative to `srcDir`, before `rewrites`. */
  pages: string[];
  rewrites: { map: Record<string, string | undefined> };
  cleanUrls?: boolean;
  mpa?: boolean;
  sitemap?: { hostname?: string };
  site: {
    /** With a leading and a trailing slash: `/`, `/docs/`. */
    base: string;
    title: string;
    description: string;
    locales: Record<string, LocaleData | undefined>;
  };
}

/** What `transformHtml` hands each page with: its path after `rewrites`, and its data. */
interface PageContext {
  page: string;
  /** The page's `<title>`: its own title, then the site's, as `titleTemplate` has it. */
  title: string;
  pageData: { title?: string; description?: string; frontmatter?: Record<string, unknown> };
}

/** What the plugin keeps of each page as VitePress renders it, for the index. */
interface PageInfo {
  /** What `<title>` adds to the page's own title: ` | Acme Docs`. */
  titleSuffix?: string;
  /** The page's own description: VitePress's meta tag falls back to the site's. */
  description?: string;
  /** `false` with `search: false` in the frontmatter. */
  search: boolean;
}

/** VitePress's heading anchors (`#`, a zero-width space) and code blocks' language labels. */
const ALWAYS_IGNORED = '.header-anchor, span.lang';

/** VitePress's client entry, which every page loads, in VitePress 1 and 2. */
const APP_ENTRY = /[\\/]vitepress[\\/]dist[\\/]client[\\/]app[\\/]index\.js$/;
const LAUNCHER_MODULE = 'virtual:ondocs/launcher';

/**
 * ```ts
 * // .vitepress/config.mts
 * import { defineConfig } from 'vitepress';
 * import { withOndocs } from 'ondocs/vitepress';
 *
 * export default withOndocs(defineConfig({ title: 'Acme Docs' }));
 * ```
 *
 * The config, with a Vite plugin that adds the launcher to every page, and `transformHtml` and
 * `buildEnd` hooks that index the built pages. The config's own hooks still run: `buildEnd` first,
 * then the indexing.
 */
export function withOndocs<Config extends VitePressConfig>(
  config: Config,
  options: OndocsOptions = {},
): Config {
  checkIndexOptions(options);
  const log = consoleLogger();
  warnMissingDialogPeers(log);
  const siteUrl = options.siteUrl ?? config.sitemap?.hostname;
  const mcp = resolveMcp(
    options.mcp,
    siteUrl,
    config.title ?? 'docs',
    "withOndocs's siteUrl option, or sitemap.hostname",
  );
  const endpoint = dialogEndpoint(options.endpoint);
  const ownTransformHtml = config.transformHtml as
    ((code: string, id: string, context: PageContext) => unknown) | undefined;
  const ownBuildEnd = config.buildEnd as ((siteConfig: VitePressSiteConfig) => unknown) | undefined;
  // Each page as VitePress rendered it, by its path after rewrites.
  const pages = new Map<string, PageInfo>();
  const plugins = config.vite?.plugins ?? [];

  return {
    ...config,
    vite: {
      ...config.vite,
      plugins: [...plugins, launcherPlugin(endpoint, options, log), quietUseClient()],
    },
    async transformHtml(code: string, id: string, context: PageContext) {
      const transformed = await ownTransformHtml?.(code, id, context);
      const { title, description, frontmatter } = context.pageData;
      const full = context.title;
      pages.set(context.page, {
        ...(title && full.startsWith(title) && full.length > title.length
          ? { titleSuffix: full.slice(title.length) }
          : {}),
        ...(description ? { description } : {}),
        search: frontmatter?.search !== false,
      });
      return transformed;
    },
    async buildEnd(siteConfig: VitePressSiteConfig) {
      await ownBuildEnd?.(siteConfig);
      await indexSite(siteConfig, {
        options,
        pages,
        siteUrl: options.siteUrl ?? siteConfig.sitemap?.hostname,
        mcp,
        owners: llmsOwners(plugins),
        log,
      });
    },
  };
}

export default withOndocs;

/**
 * The Vite plugin that adds the launcher to every page: VitePress's client entry imports a module
 * that mounts it, so Vite bundles it with the site, the dialog in a chunk of its own that loads
 * the first time it is wanted.
 */
function launcherPlugin(endpoint: string, options: OndocsOptions, log: Logger) {
  let site: VitePressSiteConfig | undefined;
  return {
    name: 'ondocs',
    // Vite's dev server does not see the module this plugin adds when it scans for dependencies
    // to prebundle, and would find the dialog's on the first page load, then reload it.
    config: () => ({ optimizeDeps: { include: ['ondocs/embed'] } }),
    configResolved(resolved: { vitepress?: VitePressSiteConfig }) {
      site = resolved.vitepress;
    },
    configureServer() {
      hintDevEndpoint(endpoint, 'vitepress dev', log);
    },
    resolveId: (id: string) => (id === LAUNCHER_MODULE ? `\0${LAUNCHER_MODULE}` : null),
    load: (id: string) =>
      id === `\0${LAUNCHER_MODULE}` ? launcherModule(endpoint, options, site) : null,
    transform(code: string, id: string, transform?: { ssr?: boolean }) {
      if (transform?.ssr || !APP_ENTRY.test(id.split('?')[0] ?? id)) return null;
      // Imported dynamically: VitePress preloads the chunks the client entry imports, the dynamic
      // ones too, on every page, and so would load the dialog with the launcher if the entry
      // imported the launcher. The launcher's chunk is preloaded, not the dialog's. Added at the
      // end, so no line moves.
      return { code: `${code}\nimport(${JSON.stringify(LAUNCHER_MODULE)});\n`, map: null };
    },
  };
}

/** The locales' keys in the site's `locales`, but `root`: the path prefixes of their pages. */
function localeKeys(site: VitePressSiteConfig['site'] | undefined): string[] {
  return Object.keys(site?.locales ?? {}).filter((key) => key !== 'root');
}

/** The title of the site in a locale (`root` for the default one), as VitePress resolves it. */
function localeTitle(
  site: VitePressSiteConfig['site'] | undefined,
  key: string,
): string | undefined {
  return site?.locales[key]?.title ?? site?.title;
}

/**
 * The module every page imports: the stylesheets, the launcher, and with the default `auto`
 * theme, VitePress's dark mode (a `dark` class on `<html>`) as the `data-theme` the launcher and
 * the dialog follow.
 */
export function launcherModule(
  endpoint: string,
  options: OndocsOptions,
  site: VitePressSiteConfig | undefined,
): string {
  const locales = localeKeys(site?.site);
  const rootTitle = localeTitle(site?.site, 'root');
  const localeTitles = Object.fromEntries(
    locales.flatMap((key) => {
      const title = localeTitle(site?.site, key);
      return title ? [[key, `Ask ${title}`]] : [];
    }),
  );
  const theme = options.dialog?.theme ?? 'auto';
  return [
    ...[...LAUNCHER_STYLESHEETS, 'ondocs/vitepress/launcher.css'].map(
      (stylesheet) => `import ${JSON.stringify(stylesheet)};`,
    ),
    ...(theme === 'auto'
      ? [
          'const root = document.documentElement;',
          "const scheme = () => { root.dataset.theme = root.classList.contains('dark') ? 'dark' : 'light'; };",
          'scheme();',
          "new MutationObserver(scheme).observe(root, { attributes: true, attributeFilter: ['class'] });",
        ]
      : []),
    launcherScript({
      endpoint,
      dialog: options.dialog,
      title: rootTitle ? `Ask ${rootTitle}` : undefined,
      locales,
      localeTitles,
      base: site?.site.base ?? '/',
      // VitePress moves between pages without loading them, and sets <html lang> for each.
      spa: true,
    }),
  ].join('\n');
}

/**
 * Where a page is served and written: `guide/index.md` (its path after `rewrites`) is at
 * `/guide/` and in `guide/index.html`; `guide/setup.md` is at `/guide/setup.html`, or
 * `/guide/setup` with `cleanUrls`, and in `guide/setup.html`. The same URLs as VitePress's
 * sitemap, under `base`.
 */
export function pageLocation(
  file: string,
  { base, cleanUrls = false }: { base: string; cleanUrls?: boolean },
): { url: string; path: string; html: string } {
  const path = file.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, cleanUrls ? '' : '.html');
  return { url: `${base}${path}`, path, html: file.replace(/\.md$/, '.html') };
}

/** The directory of the nearest package.json at or above `dir`, where node_modules is. */
function projectRoot(dir: string): string {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, 'package.json'))) return current;
    if (dirname(current) === current) return dir;
  }
}

/**
 * The llms outputs another plugin of the site writes: vitepress-plugin-llms writes all three
 * unless told otherwise, as a Vite plugin of that name.
 */
export function llmsOwners(plugins: readonly unknown[]): Map<LlmsOutput, string> {
  const owners = new Map<LlmsOutput, string>();
  const names = (plugins as unknown[])
    .flat(Infinity)
    .map((plugin) =>
      typeof plugin === 'object' && plugin !== null && 'name' in plugin ? plugin.name : undefined,
    );
  if (names.includes('vitepress-plugin-llms')) {
    for (const output of ['index', 'full', 'markdown'] as const) {
      owners.set(output, 'vitepress-plugin-llms');
    }
  }
  return owners;
}

/**
 * Indexes the pages VitePress built, grouped by locale, into `ask-index.json` in the build output
 * (`fr/ask-index.json` for a locale), and writes the llms files beside each index.
 */
async function indexSite(
  siteConfig: VitePressSiteConfig,
  {
    options,
    pages,
    siteUrl,
    mcp,
    owners,
    log,
  }: {
    options: OndocsOptions;
    pages: ReadonlyMap<string, PageInfo>;
    siteUrl: string | undefined;
    mcp: { url: string; name: string } | undefined;
    owners: ReadonlyMap<LlmsOutput, string>;
    log: Logger;
  },
): Promise<void> {
  const { site, outDir } = siteConfig;
  const indexFile = (options.indexFile ?? 'ask-index.json').replace(/^\/+/, '');
  const outputs = llmsOutputs(options.llmsTxt);
  const markdown = outputs.index || outputs.full || outputs.markdown;
  const content = options.content ?? '.vp-doc';
  const ignore = [ALWAYS_IGNORED, options.ignore].filter(Boolean).join(', ');
  const excluded = excluder(options.exclude ?? []);
  const locales = localeKeys(site);
  const groups = new Map<string, { documents: SourceDocument[]; copies: LlmsPage[] }>(
    ['', ...locales].map((locale) => [locale, { documents: [], copies: [] }]),
  );
  if (siteConfig.mpa) {
    log.warn(
      'With mpa, VitePress ships no app script, so the pages have no launcher. Add the script tag to `head` instead; see the docs.',
    );
  }

  const files = [...new Set(siteConfig.pages.map((page) => siteConfig.rewrites.map[page] ?? page))];
  for (const file of files.sort()) {
    if (file === '404.md') continue;
    const info = pages.get(file);
    if (info && !info.search) continue;
    const location = pageLocation(file, {
      base: site.base,
      cleanUrls: siteConfig.cleanUrls ?? false,
    });
    const locale = locales.find((key) => file.startsWith(`${key}/`)) ?? '';
    if (excluded(location.path) || (locale && excluded(location.path.slice(locale.length)))) {
      continue;
    }
    // VitePress writes guide/setup.md to guide/setup.html, whatever cleanUrls says.
    const html = await readBuiltHtml(outDir, file.replace(/\.md$/, ''), 'file');
    if (html === undefined) continue;
    // The title is the page's <h1>, as rendered, else its <title> without the site's.
    const titleSuffix = info ? info.titleSuffix : ` | ${localeTitle(site, locale || 'root') ?? ''}`;
    const built = loadBuiltPage(html, {
      url: location.url,
      root: content,
      ignore,
      markdown,
      ...(titleSuffix ? { titleSuffix } : {}),
    });
    if (!built) continue;
    // The meta description falls back to the site's on every page: keep only the page's own.
    const description = info ? info.description : undefined;
    const { description: _site, ...document } = built.document;
    const group = groups.get(locale);
    group?.documents.push({ ...document, ...(description ? { description } : {}) });
    if (built.page) {
      const { description: _alsoSite, ...page } = built.page;
      group?.copies.push({ ...page, ...(description ? { description } : {}) });
    }
  }

  const total = [...groups.values()].reduce((sum, group) => sum + group.documents.length, 0);
  if (total === 0) {
    log.warn(
      `None of the ${String(files.length)} pages VitePress built has content in ${content}, so there is no ${indexFile}. With a custom theme, set \`content\` to the selector of the page's content.`,
    );
    return;
  }
  const embedding = await buildEmbedding(options, log);
  const root = projectRoot(siteConfig.root);
  for (const [locale, { documents, copies }] of groups) {
    // A site whose every locale has a key of its own has no pages at the root.
    if (documents.length === 0) continue;
    const dir = join(outDir, locale);
    const file = join(dir, indexFile);
    await writeSiteIndex({
      documents,
      embeddingModel: embedding.model,
      embeddingProviderOptions: embedding.providerOptions,
      options,
      file,
      // One file per locale.
      cache: indexCache(root, `vitepress-${locale || 'root'}.json`),
      name: relative(process.cwd(), file) || indexFile,
      log,
    });
    if (!markdown) continue;
    const named = typeof options.llmsTxt === 'object' ? options.llmsTxt : {};
    const own = locale ? site.locales[locale] : site.locales.root;
    const description = named.description ?? own?.description ?? site.description;
    await writeLlmsFiles({
      pages: copies,
      site: {
        title: named.title ?? localeTitle(site, locale || 'root') ?? 'Docs',
        ...(description ? { description } : {}),
        ...(siteUrl ? { url: siteUrl } : {}),
        base: `${site.base}${locale ? `${locale}/` : ''}`,
        ...(mcp ? { mcp: mcp.url } : {}),
      },
      outputs,
      owners,
      dir,
      label: relative(process.cwd(), dir) || '.',
      log,
      // VitePress writes guide/setup.md to guide/setup.html, whatever cleanUrls says.
      linkPages: 'file',
    });
  }
}
