// The endpoints ondocs/astro serves itself on a site with an SSR adapter: when it injects
// them, the module it generates for them, and how they answer. scripts/deploy-recipes.mjs builds
// real sites with the Node, Vercel and Cloudflare adapters.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AstroIntegration } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ondocs from '../src/astro';
import { routeModuleCode } from '../src/astro/integration';
import {
  routeHandlers,
  serve,
  type RouteContext,
  type RouteModule,
  type RouteSettings,
} from '../src/astro/route';
import { buildIndex, serializeIndexFile } from '../src';
import { mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import starlightOndocs from '../src/starlight';
import { corpus } from './helpers';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-astro-route-'));
  await mkdir(join(root, 'src/pages'), { recursive: true });
  vi.stubEnv('ASK_ENDPOINT', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

interface Setup {
  injected: { pattern: string; entrypoint: string; prerender?: boolean }[];
  script: string;
  module: string | null;
  info: string[];
  warn: string[];
}

/** Runs `astro:config:setup` with an adapter (unless `adapter: null`), recording what it does. */
function setup(
  integration: AstroIntegration,
  {
    adapter = '@astrojs/node',
    base = '/',
    site,
    i18n,
  }: { adapter?: string | null; base?: string; site?: string; i18n?: unknown } = {},
): Setup {
  const result: Setup = { injected: [], script: '', module: null, info: [], warn: [] };
  const hook = integration.hooks['astro:config:setup'] as unknown as (options: unknown) => void;
  hook({
    config: {
      root: pathToFileURL(`${root}/`),
      srcDir: pathToFileURL(`${root}/src/`),
      base,
      ...(site ? { site } : {}),
      ...(adapter ? { adapter: { name: adapter, hooks: {} } } : {}),
      ...(i18n ? { i18n } : {}),
    },
    command: 'build',
    injectScript: (stage: string, content: string) => {
      if (stage === 'page') result.script = content;
    },
    injectRoute: (route: Setup['injected'][number]) => result.injected.push(route),
    updateConfig: ({
      vite,
    }: {
      vite: { plugins: { name: string; load?: (id: string) => unknown }[] };
    }) => {
      const plugin = vite.plugins.find((p) => p.name === 'ondocs:virtual-source');
      result.module = (plugin?.load?.('\0virtual:ondocs/route') as string | undefined) ?? null;
    },
    logger: {
      info: (message: string) => result.info.push(message),
      warn: (message: string) => result.warn.push(message),
    },
  });
  return result;
}

const integration = (options: Parameters<typeof ondocs>[0] = {}) =>
  ondocs({ embedding: 'mock', route: { model: 'mock' }, ...options });

describe('ondocs/astro with an SSR adapter', () => {
  it('serves the ask and MCP endpoints itself, so the site needs no route file', () => {
    const result = setup(integration());
    expect(result.injected).toEqual([
      { pattern: '/api/ask', entrypoint: 'ondocs/astro/ask-route', prerender: false },
      { pattern: '/api/mcp', entrypoint: 'ondocs/astro/mcp-route', prerender: false },
    ]);
    expect(result.info).toContain(
      'Serving /api/ask and /api/mcp with the adapter, answering with mock; route: false turns this off.',
    );
    expect(result.script).toContain('"endpoint":"/api/ask"');
  });

  it('serves them under base, and points the dialog there', () => {
    const result = setup(integration(), { base: '/docs/', site: 'https://acme.dev' });
    expect(result.injected.map((route) => route.pattern)).toEqual(['/api/ask', '/api/mcp']);
    expect(result.script).toContain('"endpoint":"/docs/api/ask"');
    expect(result.module).toContain('"indexPath":"/docs/ask-index.json"');
    expect(result.module).toContain('"siteUrl":"https://acme.dev"');
  });

  it('serves nothing with route: false, or without an adapter', () => {
    expect(setup(integration({ route: false })).injected).toEqual([]);
    expect(setup(integration(), { adapter: null }).injected).toEqual([]);
  });

  it('leaves a path to the route file the site has for it', async () => {
    await mkdir(join(root, 'src/pages/api'), { recursive: true });
    await writeFile(
      join(root, 'src/pages/api/ask.ts'),
      'export const POST = () => new Response();',
    );
    const result = setup(integration());
    expect(result.injected.map((route) => route.pattern)).toEqual(['/api/mcp']);
    expect(result.info).toContain(
      `${join('src', 'pages', 'api', 'ask.ts')} answers /api/ask, so the integration does not serve it.`,
    );
  });

  it('serves no ask endpoint where the dialog posts elsewhere, or outside base', () => {
    const elsewhere = setup(integration({ endpoint: 'https://ask.acme.dev/api/ask' }));
    expect(elsewhere.injected.map((route) => route.pattern)).toEqual(['/api/mcp']);
    const outside = setup(integration({ endpoint: '/api/ask' }), { base: '/docs' });
    expect(outside.injected.map((route) => route.pattern)).toEqual(['/api/mcp']);
    expect(outside.warn[0]).toContain("endpoint '/api/ask' is outside base '/docs'");
    const custom = setup(
      integration({ endpoint: '/docs/ask', route: { model: 'mock', mcp: false } }),
      {
        base: '/docs',
      },
    );
    expect(custom.injected).toEqual([
      { pattern: '/ask', entrypoint: 'ondocs/astro/ask-route', prerender: false },
    ]);
  });

  it('checks Turnstile tokens on the route it serves when the dialog solves them', () => {
    const challenge = { turnstile: '1x00000000000000000000BB' };
    const result = setup(integration({ dialog: { challenge } }));
    expect(result.module).toContain('"answerCache":true,"turnstile":true}');
    expect(result.script).toContain('"challenge":{"turnstile":"1x00000000000000000000BB"}');
    expect(setup(integration()).module).not.toContain('turnstile');
  });

  it('rejects a model it cannot make', () => {
    expect(() => ondocs({ route: { model: 'gpt-5' } })).toThrow(
      "route.model must be openai:<model>, an AI Gateway id <provider>/<model>, or mock (got 'gpt-5')",
    );
  });
});

describe('the module generated for the routes', () => {
  const settings = {
    siteName: 'Acme',
    indexPath: '/ask-index.json',
    rateLimit: { limit: 10, windowMs: 60_000 },
    mcpRateLimit: { limit: 60, windowMs: 60_000 },
    budget: { requestsPerDay: 500, tokensPerDay: 1_500_000 },
    answerCache: true,
  } as const;

  it('makes the OpenAI model with the key from the adapter’s environment', () => {
    expect(routeModuleCode(settings, 'openai:gpt-5.4-mini', true)).toMatchSnapshot();
  });

  it('names an AI Gateway model, and uses the Cloudflare adapter’s ASSETS binding', () => {
    const code = routeModuleCode(settings, 'anthropic/claude-haiku-4.5', false, true);
    expect(code).toContain('export const chatModel = () => "anthropic/claude-haiku-4.5";');
    expect(code).toContain("import { env } from 'cloudflare:workers';");
    expect(code).toContain('export const assets = () => env.ASSETS;');
    expect(code).toContain('export const openaiEmbedding = null;');
    expect(code).not.toContain('@ai-sdk/openai');
  });

  it('says to install @ai-sdk/openai for an openai: model without it', () => {
    expect(() => routeModuleCode(settings, 'openai:gpt-5.4-mini', false)).toThrow(
      'needs @ai-sdk/openai, which is not installed: npm i @ai-sdk/openai',
    );
  });
});

describe('the injected routes', () => {
  async function routes(limit = 10, overrides: Partial<RouteModule['settings']> = {}) {
    const { index } = await buildIndex({ documents: corpus, embeddingModel: mockEmbeddingModel() });
    const text = serializeIndexFile(index);
    const fetched: string[] = [];
    const module: RouteModule = {
      settings: {
        siteName: 'Acme',
        indexPath: '/docs/ask-index.json',
        rateLimit: { limit, windowMs: 60_000 },
        mcpRateLimit: false,
        budget: false,
        answerCache: false,
        ...overrides,
      },
      chatModel: () => mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      openaiEmbedding: null,
      secret: () => undefined,
      assets: () => ({
        fetch: (request: Request) => {
          fetched.push(request.url);
          return Promise.resolve(
            new URL(request.url).pathname === '/docs/ask-index.json'
              ? new Response(text)
              : new Response(null, { status: 404 }),
          );
        },
      }),
    };
    return { handlers: routeHandlers(module), fetched, module };
  }

  const context = (path: string, body: unknown, clientAddress = '203.0.113.1'): RouteContext => {
    const request = new Request(`https://acme.dev${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });
    return { request, url: new URL(request.url), clientAddress, locals: {} };
  };

  it('answer from the index the build wrote, embedded as it records', async () => {
    const { handlers, fetched } = await routes();
    const response = await serve(
      handlers,
      'ask',
      context('/docs/api/ask', { question: 'How do I rate limit with Upstash?' }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"url":"/docs/rate-limits#upstash"');
    expect(text).toContain('"retrieval":"hybrid"');

    const search = await serve(
      handlers,
      'mcp',
      context('/docs/api/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'quantization int8' } },
      }),
    );
    expect(await search.text()).toContain('/docs/quantization');
    // One copy of the index for both routes.
    expect(fetched).toEqual(['https://acme.dev/docs/ask-index.json']);
  });

  it('limit each visitor by the client address the adapter reports', async () => {
    const { handlers } = await routes(1);
    const ask = (address: string) =>
      serve(handlers, 'ask', context('/api/ask', { question: 'What does it cost?' }, address));
    expect((await ask('198.51.100.1')).status).toBe(200);
    expect((await ask('198.51.100.1')).status).toBe(429);
    expect((await ask('198.51.100.2')).status).toBe(200);
  });

  it('answer where every locale has a path prefix, from the default locale’s index', async () => {
    /** A page as the build wrote it, its content where both integrations read it. */
    const page = (lang: string, title: string, text: string) =>
      `<!DOCTYPE html><html lang="${lang}"><head><title>${title}</title></head><body><main data-pagefind-body><h1>${title}</h1><p>${text}</p></main></body></html>`;
    const pages = {
      'en/pricing': page('en', 'Pricing', 'The plan costs ten dollars a month.'),
      'fr/tarifs': page('fr', 'Tarifs', 'Le forfait coûte dix dollars par mois.'),
    };
    // Starlight's documented layout, which docs.astro.build has: no root locale, and a default
    // listed after another. And Astro's i18n with prefixDefaultLocale.
    const starlight = (): AstroIntegration => {
      let added: AstroIntegration | undefined;
      const plugin = starlightOndocs({ embedding: 'mock', route: { model: 'mock' } });
      (plugin.hooks['config:setup'] as unknown as (options: unknown) => void)({
        config: {
          title: 'Acme Docs',
          defaultLocale: 'en',
          locales: { fr: { label: 'Français' }, en: { label: 'English' } },
        },
        addIntegration: (integration: AstroIntegration) => (added = integration),
      });
      if (!added) throw new Error('the plugin added no integration');
      return added;
    };
    const i18n = {
      defaultLocale: 'en',
      locales: ['fr', 'en'],
      routing: { prefixDefaultLocale: true },
    };
    const sites: [string, AstroIntegration, unknown][] = [
      ['starlight', starlight(), undefined],
      ['astro', integration(), i18n],
    ];
    for (const [name, site, config] of sites) {
      const outDir = join(root, name, 'dist');
      const { module: code } = setup(site, { i18n: config });
      const settings = JSON.parse(
        /^export const settings = (.*);$/m.exec(code ?? '')?.[1] ?? 'null',
      ) as RouteSettings;
      for (const [path, html] of Object.entries(pages)) {
        await mkdir(join(outDir, path), { recursive: true });
        await writeFile(join(outDir, path, 'index.html'), html);
      }
      const hooks = site.hooks as Record<string, (options: unknown) => unknown>;
      const logger = { info: vi.fn(), warn: vi.fn() };
      await hooks['astro:config:done']?.({
        config: {
          root: pathToFileURL(`${root}/${name}/`),
          base: '/',
          trailingSlash: 'ignore',
          build: { format: 'directory' },
          integrations: [{ name: 'ondocs' }],
          ...(config ? { i18n: config } : {}),
        },
        logger,
      });
      await hooks['astro:build:done']?.({
        dir: pathToFileURL(`${outDir}/`),
        pages: Object.keys(pages).map((path) => ({ pathname: `${path}/` })),
        logger,
      });
      const handlers = routeHandlers({
        settings,
        chatModel: () => mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
        openaiEmbedding: null,
        secret: () => undefined,
        // The site's static files, as the adapter serves them.
        assets: () => ({
          fetch: async (request: Request) => {
            const file = join(outDir, new URL(request.url).pathname);
            return existsSync(file)
              ? new Response(await readFile(file, 'utf8'))
              : new Response(null, { status: 404 });
          },
        }),
      });
      const ask = async (body: object) => {
        const response = await serve(handlers, 'ask', context('/api/ask', body));
        return [response.status, await response.text()] as const;
      };
      const question = 'How much does the plan cost?';
      const [en, answer] = await ask({ question, locale: 'en' });
      expect([name, en, answer]).toEqual([name, 200, expect.stringContaining('"/en/pricing/"')]);
      const [fr, réponse] = await ask({ question: 'Combien coûte le forfait ?', locale: 'fr' });
      expect([name, fr, réponse]).toEqual([name, 200, expect.stringContaining('"/fr/tarifs/"')]);
      // A question from no locale, and agents, get the default locale's pages.
      const [none, fallback] = await ask({ question });
      expect([name, none, fallback]).toEqual([
        name,
        200,
        expect.stringContaining('"/en/pricing/"'),
      ]);
      const search = await serve(
        handlers,
        'mcp',
        context('/api/mcp', {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'plan cost' } },
        }),
      );
      expect([name, search.status, await search.text()]).toEqual([
        name,
        200,
        expect.stringContaining('/en/pricing/'),
      ]);
    }
  });

  it('answer 500 while there is no index, and try again on the next request', async () => {
    const { module } = await routes();
    let built = false;
    const real = module.assets();
    const handlers = routeHandlers({
      ...module,
      assets: () => ({
        fetch: (request: Request) =>
          built
            ? (real?.fetch as (r: Request) => Promise<Response>)(request)
            : Promise.resolve(new Response(null, { status: 404 })),
      }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = await serve(
      handlers,
      'ask',
      context('/api/ask', { question: 'What does it cost?' }),
    );
    expect(first.status).toBe(500);
    built = true;
    const second = await serve(
      handlers,
      'ask',
      context('/api/ask', { question: 'What does it cost?' }),
    );
    expect(second.status).toBe(200);
  });

  it('check the bot check’s token on questions, with TURNSTILE_SECRET_KEY, and not on MCP', async () => {
    const { module } = await routes(10, { turnstile: true });
    const secrets: string[] = [];
    const handlers = routeHandlers({
      ...module,
      secret: (name) => {
        secrets.push(name);
        return name === 'TURNSTILE_SECRET_KEY' ? '1x0000000000000000000000000000000AA' : undefined;
      },
    });
    // Turnstile's siteverify, as Cloudflare's always-pass test secret answers it.
    const siteverify = vi.fn((_url: string, init?: RequestInit) => {
      const { response } = JSON.parse(init?.body as string) as { response: string };
      return Promise.resolve(Response.json({ success: response === 'XXXX.DUMMY.TOKEN.XXXX' }));
    });
    vi.stubGlobal('fetch', siteverify);
    try {
      const ask = (body: object) => serve(handlers, 'ask', context('/docs/api/ask', body));
      const question = 'How do I rate limit with Upstash?';
      const refused = await ask({ question });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: 'challenge_required' } });
      const answered = await ask({ question, challenge: 'XXXX.DUMMY.TOKEN.XXXX' });
      expect(answered.status).toBe(200);
      expect(await answered.text()).toContain('"url":"/docs/rate-limits#upstash"');
      expect(secrets).toContain('TURNSTILE_SECRET_KEY');
      const search = await serve(
        handlers,
        'mcp',
        context('/docs/api/mcp', {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'quantization int8' } },
        }),
      );
      expect(await search.text()).toContain('/docs/quantization');
      expect(siteverify).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answer 503 to questions without TURNSTILE_SECRET_KEY, saying why, and MCP still', async () => {
    const { handlers } = await routes(10, { turnstile: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await serve(
      handlers,
      'ask',
      context('/api/ask', { question: 'What does it cost?', challenge: 'XXXX.DUMMY.TOKEN.XXXX' }),
    );
    expect(response.status).toBe(503);
    expect(String(error.mock.calls[0]?.[1])).toContain('needs the widget');
    const search = await serve(
      handlers,
      'mcp',
      context('/api/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_pages', arguments: {} },
      }),
    );
    expect(search.status).toBe(200);
  });
});
