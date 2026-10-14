// The Astro integration behind ondocs/astro and ondocs/starlight. Node.js only.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroConfig, AstroIntegration } from 'astro';

import {
  buildEmbedding,
  checkIndexOptions,
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
  type McpOption,
  type OndocsDialogOptions as DialogOptions,
  type OndocsTheme,
  type SourceDocument,
} from '../integration';
import type { RouteSettings } from './route';

/** What the dialog shows in one locale, over the dialog's own options. */
export type OndocsLocaleDialogOptions = LocaleDialogOptions;

/** What the dialog shows; passed to `mountAskDialog` from `ondocs/embed`. */
export interface OndocsDialogOptions extends DialogOptions {
  /**
   * The dialog's accessible name. Default "Ask this site", or "Ask {site title}" in Starlight, or
   * `labels.title`.
   */
  title?: string;
  /** Default `auto`: the `data-theme` on `<html>` when the site sets one, else the system's. */
  theme?: OndocsTheme;
  /**
   * Options for each locale, by its path prefix (`fr`, `pt-br`), over these: the labels, the
   * title and the suggestions in that language. The dialog picks its locale from the page's
   * path, uses its options, and sends the locale with each question, so the endpoint answers
   * from that locale's index.
   */
  locales?: Record<string, OndocsLocaleDialogOptions>;
}

/**
 * The endpoints the integration serves itself on a site with an SSR adapter: the ask endpoint at
 * `endpoint`, and an MCP endpoint, answering from the index the build writes.
 */
export interface OndocsRouteOptions {
  /**
   * The model that answers: `openai:<model>` (with @ai-sdk/openai installed and `OPENAI_API_KEY`
   * set where the site runs), an AI Gateway id such as `openai/gpt-5.4-mini`
   * (`AI_GATEWAY_API_KEY`), or `mock`, which answers by quoting the sources, for a demo without a
   * key. Default `openai:gpt-5.4-mini`. Questions are embedded with the model the index records.
   */
  model?: string;
  /** Questions a minute per visitor, by the client address the adapter reports. Default 10; `false` for no limit. */
  rateLimit?: number | false;
  /** Tool calls a minute per client on the MCP endpoint. Default 60; `false` for no limit. */
  mcpRateLimit?: number | false;
  /**
   * A daily cap for the endpoint, counted per server instance. Default
   * `{ requestsPerDay: 500, tokensPerDay: 1_500_000 }`; `false` for none. Set a spend limit with
   * your model provider as well: it is the only hard cap.
   */
  budget?: { requestsPerDay?: number; tokensPerDay?: number } | false;
  /** Answer a question asked again from memory, without a model call. Default `true`. */
  answerCache?: boolean;
  /** The MCP endpoint's path, under `base`. Default `/api/mcp`; `false` serves none. */
  mcp?: string | false;
  /** Names the site in the model's instructions. Default: the site's title. */
  siteName?: string;
}

export interface OndocsOptions extends IndexOptions {
  /**
   * URL the dialog posts questions to. Default `/api/ask` (under `base` when the integration
   * serves it). The `ASK_ENDPOINT` environment variable, when it is set as the site builds or
   * starts, takes precedence over it: `ASK_ENDPOINT=http://localhost:8787/api/ask` points the
   * dialog at `ondocs dev`.
   */
  endpoint?: string;
  /**
   * On a site with an SSR adapter (Node, Vercel, Netlify, Cloudflare), the integration serves the
   * ask endpoint at `endpoint` and an MCP endpoint at `/api/mcp` itself, so there is no route
   * file to write. An object sets the model and the limits; `false` turns it off, for a route of
   * your own. A route file the site already has at either path is left to answer instead. With
   * `dialog.challenge.turnstile`, the ask endpoint checks each question's Turnstile token, with
   * the secret in `TURNSTILE_SECRET_KEY`.
   */
  route?: OndocsRouteOptions | false;
  /**
   * The part of each page to index, as a selector: a tag name, `#id`, `.class` or `[attribute]`,
   * combined as in `div.prose` or listed as in `main, .post`. Default `main` (then the page's
   * `<article>`s, then its `<body>`). With any other selector, a page where it matches nothing is
   * not indexed.
   */
  content?: string;
  /** Elements to leave out of `content`, as a selector like it, e.g. `.toc, .comments`. */
  ignore?: string;
  /** Where the index is written in the build output, and served from. Default `ask-index.json`. */
  indexFile?: string;
  /**
   * Paths to leave out, relative to `base` and the locale, e.g. `['/changelog']` (a prefix
   * matches its subpages too). With `base: '/docs'`, `/changelog` leaves out `/docs/changelog`
   * and, in French, `/docs/fr/changelog`; `/fr` leaves out the French pages.
   */
  exclude?: string[];
  dialog?: OndocsDialogOptions;
  /**
   * The site's MCP endpoint (`createMcpHandler` from `ondocs/server`), as an absolute URL or a
   * path on the site such as `/api/mcp` (then `site` must be set), and optionally the name clients
   * list it under (default: from the site title). `McpInstall` from
   * `ondocs/astro/McpInstall.astro` then shows how to add it to Cursor, VS Code, Claude and
   * ChatGPT.
   */
  mcp?: McpOption;
  /**
   * After the build, also write `llms.txt`, `llms-full.txt` and a Markdown copy of each indexed
   * page at its URL plus `.md` (`/guides/setup.md`), into the build output, per locale as the
   * index is, and link each page to its copy with `<link rel="alternate" type="text/markdown">`.
   * On by default; `false` turns all three off, and `{ index: false }`,
   * `{ full: false }` or `{ markdown: false }` one of them. A file the build already has (from
   * `public/` or another integration) is left as it is, and what starlight-llms-txt,
   * starlight-page-actions or starlight-llm-actions writes is left to them.
   */
  llmsTxt?: LlmsTxtOption;
}

/** The module `McpInstall.astro` reads the `mcp` option from. */
const MCP_MODULE = 'virtual:ondocs/mcp';
/** The module the injected routes read their settings and models from (see route.ts). */
const ROUTE_MODULE = 'virtual:ondocs/route';

const DEFAULT_PATH = '/api/ask';
const DEFAULT_MCP_PATH = '/api/mcp';
const DEFAULT_ROUTE_MODEL = 'openai:gpt-5.4-mini';
const ROUTE_MODEL = /^(?:mock|openai:.+|[\w-]+\/.+)$/;
/** About 500 answers a day, at some 3,000 tokens each. */
const DEFAULT_ROUTE_BUDGET = { requestsPerDay: 500, tokensPerDay: 1_500_000 };

/**
 * The header button of a framework built on Astro (Starlight's `dialog.navbar`), which its own
 * component renders from `virtual:ondocs/starlight/navbar`.
 */
export interface NavbarButtons {
  /** The module of the search component the button goes after, rendered first. */
  search: string;
  /** Whether to render that search component. */
  renderSearch: boolean;
  /** The shortcut's key, upper case, or `''` with none. */
  shortcut: string;
  /** The button's label and the Ctrl key's, by locale path prefix (`''` for the root locale). */
  buttons: Record<string, { label: string; controlKey: string }>;
}

/** The module the Starlight plugin's `Search.astro` reads the navbar button from. */
const NAVBAR_MODULE = 'virtual:ondocs/starlight/navbar';

/** The source of `virtual:ondocs/starlight/navbar`: the search component, and the button's data. */
export function navbarModuleCode({
  search,
  renderSearch,
  shortcut,
  buttons,
}: NavbarButtons): string {
  return [
    `export { default } from ${JSON.stringify(search)};`,
    `export const renderSearch = ${JSON.stringify(renderSearch)};`,
    `export const shortcut = ${JSON.stringify(shortcut)};`,
    `export const buttons = ${JSON.stringify(buttons)};`,
    '',
  ].join('\n');
}

/** What a framework built on Astro, such as Starlight, sets on top of the site's options. */
export interface IntegrationPreset {
  /** A button in the header, which the framework's own component renders. */
  navbar?: NavbarButtons;
  /** The selector of each page's content, instead of `content`. */
  content?: string;
  /** The selector of what to leave out, instead of `ignore`. */
  ignore?: string;
  /** Locale path prefixes that get an index of their own. Default: from Astro's `i18n`. */
  locales?: string[];
  /**
   * The default locale's path prefix, whose files are copied to the root when it has no pages.
   * Default: from Astro's `i18n`.
   */
  defaultLocale?: string;
  /** The dialog's title unless the site sets one. */
  title?: string;
  /** The site's title, which names the MCP server in clients and heads `llms.txt`. */
  siteTitle?: string;
  /** The dialog's title in each locale, by path prefix, unless the site sets one. */
  localeTitles?: Record<string, string>;
  /** The site's description, for `llms.txt`. */
  siteDescription?: string;
  /** Plugins of the framework that write llms files, by name, e.g. Starlight plugins. */
  plugins?: readonly string[];
  /** Stylesheets for the dialog, after its own and the launcher's. */
  stylesheets?: string[];
}

export function createIntegration(
  options: OndocsOptions,
  preset: IntegrationPreset,
): AstroIntegration {
  checkIndexOptions(options);
  const routeOptions = options.route === false ? null : (options.route ?? {});
  const model = routeOptions?.model ?? DEFAULT_ROUTE_MODEL;
  if (!ROUTE_MODEL.test(model)) {
    throw new Error(
      `ondocs: route.model must be openai:<model>, an AI Gateway id <provider>/<model>, or mock (got '${model}').`,
    );
  }
  let endpoint = dialogEndpoint(options.endpoint);
  let config: AstroConfig | undefined;
  // The routes the integration serves, when it serves them: their paths under `base`.
  let injected: { ask?: string; mcp?: string; indexPath: string } | null = null;
  let mcpUrl: string | undefined;
  // Whether this is `astro dev`, and whether a route of the site answers the endpoint.
  let dev = false;
  let served = false;
  return {
    name: 'ondocs',
    hooks: {
      'astro:config:setup': ({
        config: astro,
        injectScript,
        injectRoute,
        updateConfig,
        logger,
        command,
      }) => {
        dev = command === 'dev';
        const routes =
          routeOptions && astro.adapter
            ? routesToInject(options, astro, routeOptions, logger)
            : null;
        let routeModule: string | null = null;
        if (routes) {
          const base = astro.base.replace(/\/+$/, '');
          endpoint = dialogEndpoint(options.endpoint ?? `${base}${routes.ask ?? DEFAULT_PATH}`);
          const indexFile = (options.indexFile ?? 'ask-index.json').replace(/^\/+/, '');
          injected = { ...routes, indexPath: `${base}/${indexFile}` };
          routeModule = routeModuleCode(
            {
              siteName:
                routeOptions?.siteName ??
                preset.siteTitle ??
                (astro.site ? new URL(astro.site).host : 'this site'),
              ...(astro.site ? { siteUrl: new URL(astro.site).origin } : {}),
              indexPath: injected.indexPath,
              // Each locale's index, which the dialog asks for on that locale's pages.
              localeIndexPaths: Object.fromEntries(
                (preset.locales ?? astroLocales(astro)).map((locale) => [
                  locale,
                  `${base}/${locale}/${indexFile}`,
                ]),
              ),
              rateLimit: perMinute(routeOptions?.rateLimit, 10),
              mcpRateLimit: perMinute(routeOptions?.mcpRateLimit, 60),
              budget: routeOptions?.budget ?? DEFAULT_ROUTE_BUDGET,
              answerCache: routeOptions?.answerCache ?? true,
              // The dialog solves a Turnstile challenge: the route checks it.
              ...(options.dialog?.challenge?.turnstile ? { turnstile: true as const } : {}),
            },
            model,
            hasPackage('@ai-sdk/openai', astro.root),
            astro.adapter?.name === '@astrojs/cloudflare',
          );
          for (const [which, pattern] of Object.entries(routes)) {
            injectRoute({
              pattern,
              entrypoint: `ondocs/astro/${which === 'ask' ? 'ask' : 'mcp'}-route`,
              prerender: false,
            });
          }
          const served = Object.values(routes).map((path) => `${base}${path}`);
          logger.info(
            `Serving ${served.join(' and ')} with the adapter, answering with ${model}; route: false turns this off.`,
          );
        }
        const mcp = resolveMcp(
          options.mcp,
          astro.site,
          preset.siteTitle ?? 'docs',
          "astro.config's site",
        );
        mcpUrl = mcp?.url;
        warnMissingDialogPeers(logger);
        // The stylesheets go into every page's CSS: a `page` script's CSS is built but not linked.
        injectScript(
          'page-ssr',
          [...LAUNCHER_STYLESHEETS, ...(preset.stylesheets ?? [])]
            .map((stylesheet) => `import ${JSON.stringify(stylesheet)};`)
            .join('\n'),
        );
        // Bundled by Vite with each page's scripts, so React is the site's own copy, if it has one.
        injectScript(
          'page',
          launcherScript({
            endpoint,
            dialog: options.dialog,
            title: preset.title,
            locales: preset.locales ?? astroLocales(astro),
            localeTitles: preset.localeTitles,
            // A test's partial config may have no base.
            base: astro.base || '/',
          }),
        );
        updateConfig({
          vite: {
            plugins: [
              quietUseClient(),
              virtualModule(MCP_MODULE, mcp ?? null),
              ...(routeModule ? [virtualSource(ROUTE_MODULE, routeModule)] : []),
              ...(preset.navbar
                ? [virtualSource(NAVBAR_MODULE, navbarModuleCode(preset.navbar))]
                : []),
            ],
            // Vite's dev server does not see injected scripts when it scans for dependencies to
            // prebundle, and would find the dialog's on the first page load, then reload it.
            optimizeDeps: { include: ['ondocs/embed'] },
          },
        });
      },
      'astro:config:done': ({ config: resolved }) => {
        config = resolved;
      },
      'astro:routes:resolved': ({ routes }) => {
        // An endpoint route, as a page cannot answer a POST: Starlight's `[...slug]` matches any
        // path.
        const path = endpoint.split(/[?#]/)[0] ?? endpoint;
        served = routes.some((route) => route.type === 'endpoint' && route.patternRegex.test(path));
      },
      'astro:server:setup': ({ server, logger }) => {
        // `astro dev` has no build output: the injected endpoint reads the index the last build
        // wrote, served at its path here.
        if (injected && config) serveBuiltIndex(server, injected.indexPath, config, logger);
      },
      'astro:server:start': ({ logger }) => {
        if (dev && !served) hintDevEndpoint(endpoint, 'astro dev', logger);
      },
      'astro:build:done': async ({ dir, pages, logger }) => {
        if (!config) throw new Error('ondocs: astro:config:done did not run');
        const indexFile = (options.indexFile ?? 'ask-index.json').replace(/^\/+/, '');
        const outDir = fileURLToPath(dir);
        const outputs = llmsOutputs(options.llmsTxt);
        const llms = outputs.index || outputs.full || outputs.markdown;
        const { groups, copies } = await loadBuiltPages(
          outDir,
          pages,
          config,
          options,
          preset,
          llms,
        );
        const total = [...groups.values()].reduce((sum, documents) => sum + documents.length, 0);
        if (total === 0) {
          logger.warn(
            `None of the ${String(pages.length)} pages Astro built has content to index in ${preset.content ?? options.content ?? 'main'}, so there is no ${indexFile}.`,
          );
          return;
        }
        const embedding = await buildEmbedding(options, logger);
        const owners = llmsOwners([
          ...(preset.plugins ?? []),
          ...config.integrations.map((integration) => integration.name),
        ]);
        for (const [locale, documents] of groups) {
          // A site whose every locale has a path prefix has no pages of its own at the root.
          if (documents.length === 0) continue;
          const name = locale ? `${locale}/${indexFile}` : indexFile;
          await writeSiteIndex({
            documents,
            embeddingModel: embedding.model,
            embeddingProviderOptions: embedding.providerOptions,
            options,
            file: join(outDir, name),
            // One file per locale.
            cache: indexCache(fileURLToPath(config.root), `astro-${locale || 'root'}.json`),
            // With an adapter, Astro serves static files from `dist/client/`: say so.
            name: relative(fileURLToPath(config.root), join(outDir, name)) || name,
            log: logger,
          });
          if (!llms) continue;
          const named = typeof options.llmsTxt === 'object' ? options.llmsTxt : {};
          const description = named.description ?? preset.siteDescription;
          const base = `${config.base.replace(/\/+$/, '')}/${locale ? `${locale}/` : ''}`;
          await writeLlmsFiles({
            pages: copies.get(locale) ?? [],
            site: {
              title:
                named.title ??
                preset.siteTitle ??
                (config.site ? new URL(config.site).host : 'Docs'),
              ...(description ? { description } : {}),
              ...(config.site ? { url: config.site } : {}),
              base,
              ...(mcpUrl ? { mcp: mcpUrl } : {}),
            },
            outputs,
            owners,
            dir: join(outDir, locale),
            label: relative(fileURLToPath(config.root), join(outDir, locale)) || 'dist',
            log: logger,
            linkPages: config.build.format === 'file' ? 'file' : 'directory',
          });
        }
        // The injected routes, the MCP endpoint `ondocs init` writes and agents read the index and
        // llms.txt at the root: a site with no pages there, every locale under its own path, gets
        // the default locale's.
        const fallback = [
          preset.defaultLocale ?? astroDefaultLocale(config),
          ...groups.keys(),
        ].find((locale) => locale && (groups.get(locale)?.length ?? 0) > 0);
        if (groups.get('')?.length === 0 && fallback) {
          await mkdir(dirname(join(outDir, indexFile)), { recursive: true });
          await copyFile(join(outDir, fallback, indexFile), join(outDir, indexFile));
          const copied = [indexFile];
          for (const [output, file] of [
            ['index', 'llms.txt'],
            ['full', 'llms-full.txt'],
          ] as const) {
            const from = join(outDir, fallback, file);
            const to = join(outDir, file);
            // Never one the site has there, or one another plugin writes.
            if (!outputs[output] || owners.has(output) || !existsSync(from) || existsSync(to)) {
              continue;
            }
            await copyFile(from, to);
            copied.push(file);
          }
          logger.info(
            `Copied ${fallback}'s ${copied.join(', ')} → ${relative(fileURLToPath(config.root), outDir) || 'dist'}, which has no pages of its own, for the endpoints and agents that read them there.`,
          );
        }
      },
    },
  };
}

/**
 * The routes to inject, as paths under `base` (`{ ask: '/api/ask', mcp: '/api/mcp' }`), or `null`
 * when the dialog posts somewhere the site does not serve. A path the site already has a route
 * file for is left to it.
 */
function routesToInject(
  options: OndocsOptions,
  astro: AstroConfig,
  route: OndocsRouteOptions,
  logger: { info: (message: string) => void; warn: (message: string) => void },
): { ask?: string; mcp?: string } | null {
  const base = astro.base.replace(/\/+$/, '');
  const routes: { ask?: string; mcp?: string } = {};
  const given = options.endpoint;
  if (given === undefined) routes.ask = DEFAULT_PATH;
  else if (given.startsWith('/') && !given.startsWith('//')) {
    const path = given.split(/[?#]/)[0] ?? given;
    if (!base || path.startsWith(`${base}/`)) routes.ask = path.slice(base.length);
    else {
      logger.warn(
        `endpoint '${given}' is outside base '${astro.base}', where the site cannot serve it, so the integration serves no ask endpoint.`,
      );
    }
  }
  if (route.mcp !== false) routes.mcp = route.mcp ?? DEFAULT_MCP_PATH;
  const served: { ask?: string; mcp?: string } = {};
  for (const [which, pattern] of Object.entries(routes) as ['ask' | 'mcp', string][]) {
    const file = routeFile(fileURLToPath(astro.srcDir), pattern);
    if (file)
      logger.info(`${file} answers ${base}${pattern}, so the integration does not serve it.`);
    else served[which] = pattern;
  }
  return served.ask || served.mcp ? served : null;
}

/** A route file under `src/pages` that answers `pattern`, if the site has one. */
function routeFile(srcDir: string, pattern: string): string | undefined {
  const path = pattern.replace(/^\/+|\/+$/g, '');
  for (const name of [path, `${path}/index`]) {
    for (const extension of ['ts', 'js', 'mts', 'mjs']) {
      const file = join(srcDir, 'pages', `${name}.${extension}`);
      if (existsSync(file)) return relative(join(srcDir, '..'), file);
    }
  }
  return undefined;
}

const perMinute = (
  value: number | false | undefined,
  fallback: number,
): RouteSettings['rateLimit'] =>
  value === false ? false : { limit: value ?? fallback, windowMs: 60_000 };

/** Whether `name` resolves from the site's root. */
function hasPackage(name: string, root: URL): boolean {
  try {
    createRequire(new URL('package.json', root)).resolve(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * The source of `virtual:ondocs/route`: the settings, and the model, imported from the
 * site's own packages, which is why it is generated rather than shipped.
 */
export function routeModuleCode(
  settings: RouteSettings,
  model: string,
  openai: boolean,
  cloudflare = false,
): string {
  const id = model.replace(/^openai:/, '');
  if (model.startsWith('openai:') && !openai) {
    throw new Error(
      `ondocs: route.model '${model}' needs @ai-sdk/openai, which is not installed: npm i @ai-sdk/openai`,
    );
  }
  const chat =
    model === 'mock'
      ? '() => mockLanguageModel()'
      : model.startsWith('openai:')
        ? `() => openai()(${JSON.stringify(id)})`
        : `() => ${JSON.stringify(model)}`;
  return [
    "import { getSecret } from 'astro:env/server';",
    ...(openai ? ["import { createOpenAI } from '@ai-sdk/openai';"] : []),
    ...(model === 'mock' ? ["import { mockLanguageModel } from 'ondocs/mock';"] : []),
    // The Cloudflare adapter's bindings, where the route reads the index through ASSETS.
    ...(cloudflare ? ["import { env } from 'cloudflare:workers';"] : []),
    ...(openai
      ? [
          'let provider;',
          "const openai = () => (provider ??= createOpenAI({ apiKey: getSecret('OPENAI_API_KEY') }));",
        ]
      : []),
    `export const settings = ${JSON.stringify(settings)};`,
    `export const chatModel = ${chat};`,
    `export const openaiEmbedding = ${openai ? '(id) => openai().embedding(id)' : 'null'};`,
    'export const secret = (name) => getSecret(name);',
    `export const assets = ${cloudflare ? '() => env.ASSETS' : '() => undefined'};`,
    '',
  ].join('\n');
}

/** A Vite plugin serving `id` as a module with the given source. */
function virtualSource(id: string, source: string) {
  const resolved = `\0${id}`;
  return {
    name: 'ondocs:virtual-source',
    resolveId: (module: string) => (module === id ? resolved : null),
    load: (module: string) => (module === resolved ? source : null),
  };
}

interface DevServer {
  middlewares: {
    use: (
      handler: (
        request: { url?: string; method?: string },
        response: {
          statusCode: number;
          setHeader: (name: string, value: string) => void;
          end: (body?: string | Buffer) => void;
        },
        next: () => void,
      ) => void,
    ) => void;
  };
}

/**
 * Serves the index the last `astro build` wrote at `path` on the dev server, for the injected
 * endpoint to fetch: `dist/client/ask-index.json` with an adapter.
 */
function serveBuiltIndex(
  server: DevServer,
  path: string,
  config: AstroConfig,
  logger: { warn: (message: string) => void },
): void {
  const name = path.slice(config.base.replace(/\/+$/, '').length + 1);
  const files = [new URL(name, config.build.client), new URL(name, config.outDir)].map((url) =>
    fileURLToPath(url),
  );
  let warned = false;
  server.middlewares.use((request, response, next) => {
    if ((request.url ?? '').split('?')[0] !== path) {
      next();
      return;
    }
    const file = files.find((candidate) => existsSync(candidate));
    if (!file) {
      if (!warned) {
        warned = true;
        logger.warn(
          `No index yet for the ask endpoint: run astro build once, and it answers from ${relative(fileURLToPath(config.root), files[0] ?? '')}.`,
        );
      }
      response.statusCode = 404;
      response.end();
      return;
    }
    readFile(file).then(
      (body) => {
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-cache');
        response.end(body);
      },
      () => {
        response.statusCode = 500;
        response.end();
      },
    );
  });
}

/** A Vite plugin serving `id` as a module whose default export is `value`. */
function virtualModule(id: string, value: unknown) {
  const resolved = `\0${id}`;
  return {
    name: 'ondocs:virtual-module',
    resolveId: (source: string) => (source === id ? resolved : null),
    load: (module: string) =>
      module === resolved ? `export default ${JSON.stringify(value)};` : null,
  };
}

/**
 * The locale path prefixes in Astro's `i18n` config: every locale's path, except the default
 * locale's unless `prefixDefaultLocale` is set.
 */
function astroLocales(config: AstroConfig): string[] {
  const { i18n } = config;
  if (!i18n) return [];
  const prefixDefault = typeof i18n.routing === 'object' && i18n.routing.prefixDefaultLocale;
  const defaultPath = astroDefaultLocale(config);
  return i18n.locales
    .map((locale) => (typeof locale === 'string' ? locale : locale.path))
    .filter((path) => prefixDefault || path !== defaultPath);
}

/** The default locale's path in Astro's `i18n` config. */
function astroDefaultLocale({ i18n }: AstroConfig): string | undefined {
  return i18n?.locales
    .map((locale) => (typeof locale === 'string' ? { path: locale, codes: [locale] } : locale))
    .find(({ path, codes }) => path === i18n.defaultLocale || codes.includes(i18n.defaultLocale))
    ?.path;
}

/**
 * The pages Astro built, as documents grouped by locale path prefix (`''` for the rest): each
 * page's content at the URL Astro serves it from, under `base`, with the trailing slash that
 * `trailingSlash` and `build.format` give it (the same URLs as Astro's sitemap). The 404 and 500
 * pages, excluded paths and pages without content are skipped. Redirects and i18n fallbacks are
 * not pages to Astro, so they never come up.
 */
async function loadBuiltPages(
  outDir: string,
  pages: readonly { pathname: string }[],
  config: AstroConfig,
  options: OndocsOptions,
  preset: IntegrationPreset,
  markdown: boolean,
): Promise<{ groups: Map<string, SourceDocument[]>; copies: Map<string, LlmsPage[]> }> {
  const locales = preset.locales ?? astroLocales(config);
  const groups = new Map<string, SourceDocument[]>([['', []]]);
  const copies = new Map<string, LlmsPage[]>([['', []]]);
  for (const locale of locales) {
    groups.set(locale, []);
    copies.set(locale, []);
  }
  const excluded = excluder(options.exclude ?? []);
  const base = config.base.replace(/\/+$/, '');
  const root = preset.content ?? options.content ?? 'main';
  const ignore = preset.ignore ?? options.ignore;

  for (const pathname of pages.map((page) => page.pathname.replace(/^\/+/, '')).sort()) {
    const path = pathname.replace(/\/+$/, '');
    if (path === '404' || path === '500') continue;
    const locale = locales.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? '';
    if (excluded(path) || (locale && excluded(path.slice(locale.length)))) continue;
    const html = await readBuiltHtml(
      outDir,
      path,
      config.build.format === 'file' ? 'file' : 'directory',
    );
    if (html === undefined) continue;
    const url =
      pathname === ''
        ? base && config.trailingSlash === 'never'
          ? base
          : `${base}/`
        : `${base}/${pathname}`;
    const built = loadBuiltPage(html, { url, root, ignore, markdown });
    if (!built) continue;
    groups.get(locale)?.push(built.document);
    if (built.page) copies.get(locale)?.push(built.page);
  }
  return { groups, copies };
}

/**
 * The llms outputs the site's other plugins and integrations write, by name: starlight-llms-txt
 * (llms.txt and llms-full.txt), starlight-page-actions and starlight-llm-actions (the pages' .md
 * copies). Whatever else they write is caught by the file being there already.
 */
function llmsOwners(names: readonly string[]): Map<LlmsOutput, string> {
  const owners = new Map<LlmsOutput, string>();
  for (const name of names) {
    if (name === 'starlight-llms-txt') {
      owners.set('index', name);
      owners.set('full', name);
    } else if (
      name === 'starlight-page-actions' ||
      name === 'starlight-page-actions-integration' ||
      name === 'starlight-llm-actions'
    ) {
      owners.set('markdown', name.replace(/-integration$/, ''));
    }
  }
  return owners;
}
