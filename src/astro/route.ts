// The ask and MCP endpoints that ondocs/astro serves itself on a site with an SSR adapter, so
// the site needs no route file: the integration injects `ask-route.ts` and `mcp-route.ts`, which
// call these. They answer from the index the build wrote, fetched from the site's own static files
// (through the ASSETS binding on Cloudflare) and checked again after a deploy.
import type { EmbeddingModel, LanguageModel } from 'ai';

import type { RetrievalOptions } from '../search/retrieve';
import { turnstile, type ChallengeVerifier } from '../server/challenge';
import { createAskHandler } from '../server/handler';
import { createMcpHandler } from '../server/mcp';
import { memoryRateLimit, type RateLimiter } from '../server/rate-limit';
import { remoteIndex, type RemoteIndex } from '../server/remote-index';

/** What the integration passes to the route, as JSON, through `virtual:ondocs/route`. */
export interface RouteSettings {
  siteName: string;
  /** The site's origin, from Astro's `site`, for the MCP results' links. */
  siteUrl?: string;
  /** The index's path on the site, with `base`: `/docs/ask-index.json`. */
  indexPath: string;
  /** Each locale's index's path, by the locale the dialog sends: `{ fr: '/docs/fr/ask-index.json' }`. */
  localeIndexPaths?: Record<string, string>;
  /** Questions a minute per client, or `false` for no limit. */
  rateLimit: { limit: number; windowMs: number } | false;
  /** Tool calls a minute per client, or `false` for no limit. */
  mcpRateLimit: { limit: number; windowMs: number } | false;
  budget: { requestsPerDay?: number; tokensPerDay?: number } | false;
  answerCache: boolean;
  /**
   * The dialog has `challenge.turnstile`: check each question's token with Turnstile, with the
   * secret in `TURNSTILE_SECRET_KEY`.
   */
  turnstile?: true;
}

/** The virtual module's exports: the settings, and the models, made where the site's packages are. */
export interface RouteModule {
  settings: RouteSettings;
  /** The model that answers. */
  chatModel: () => LanguageModel;
  /** An OpenAI embedding model by id, when @ai-sdk/openai is installed; else `null`. */
  openaiEmbedding: ((id: string) => EmbeddingModel) | null;
  /** A secret from the adapter's environment (`astro:env/server`'s `getSecret`). */
  secret: (name: string) => string | undefined;
  /** The Worker's ASSETS binding, with the Cloudflare adapter; else `undefined`. */
  assets: () => { fetch?: unknown } | undefined;
}

/** The part of Astro's `APIContext` the routes read. */
export interface RouteContext {
  request: Request;
  url: URL;
  clientAddress: string;
  locals: unknown;
}

type Handler = (request: Request) => Promise<Response>;

/** The client address Astro gave each request, for the rate limiters' keys. */
const clients = new WeakMap<Request, string>();
const byClient = (request: Request): string => clients.get(request) ?? 'anonymous';

interface Assets {
  fetch: (request: Request) => Promise<Response>;
}

/**
 * The Cloudflare adapter's ASSETS binding, when the route runs there: from `cloudflare:workers`
 * (Astro 6 and later, through the generated module), or from `locals.runtime.env` (Astro 5), whose
 * getter throws on later versions.
 */
function assetsFetcher(
  module: RouteModule,
  locals: unknown,
): ((request: Request) => Promise<Response>) | undefined {
  let assets = module.assets() as Partial<Assets> | undefined;
  if (!assets) {
    try {
      assets = (locals as { runtime?: { env?: { ASSETS?: Partial<Assets> } } } | undefined)?.runtime
        ?.env?.ASSETS;
    } catch {
      // Astro 6 and later: `locals.runtime.env` is gone.
    }
  }
  const fetchAsset = assets?.fetch;
  if (typeof fetchAsset !== 'function') return undefined;
  return (request) => fetchAsset.call(assets, request);
}

/**
 * The embedding model the index was built with, to embed questions the same way: OpenAI's own ids
 * (`text-embedding-3-small`) through @ai-sdk/openai, AI Gateway ids (`openai/…`) as they are, and
 * the mock model's offline. `undefined` means keyword-only search.
 */
async function queryModel(
  module: RouteModule,
  model: string | undefined,
): Promise<{ embeddingModel?: EmbeddingModel; retrieval?: RetrievalOptions }> {
  if (!model) return {};
  const mock = /^mock-hash-(\d+)$/.exec(model);
  if (mock) {
    const { MOCK_MIN_SIMILARITY, mockEmbeddingModel } = await import('../mock');
    return {
      embeddingModel: mockEmbeddingModel({ dimensions: Number(mock[1]) }),
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    };
  }
  if (model.includes('/')) return { embeddingModel: model };
  return module.openaiEmbedding ? { embeddingModel: module.openaiEmbedding(model) } : {};
}

interface Handlers {
  ask: Handler;
  mcp: Handler;
}

/**
 * The ask route's bot check, for a dialog with `challenge.turnstile`: Turnstile, with the secret
 * from the adapter's environment. Without the secret, every question gets a 503 and the log says
 * why; the MCP route, which is not checked, answers as before.
 */
function turnstileChallenge(module: RouteModule): ChallengeVerifier {
  const secretKey = module.secret('TURNSTILE_SECRET_KEY');
  if (secretKey) return turnstile({ secretKey });
  return () =>
    Promise.reject(
      new Error(
        "ondocs: the dialog has challenge.turnstile, so the ask route checks a Turnstile token with each question, and needs the widget's secret key in TURNSTILE_SECRET_KEY.",
      ),
    );
}

/**
 * The two handlers, made on the first request, once the index has been fetched, so questions are
 * embedded with the model it records. Shared by both routes, so they share one copy of the index.
 */
export function routeHandlers(module: RouteModule): (context: RouteContext) => Promise<Handlers> {
  let handlers: Promise<Handlers> | null = null;
  const limiter = (limit: RouteSettings['rateLimit']): RateLimiter | false =>
    limit ? memoryRateLimit({ ...limit, key: byClient }) : false;
  const askLimit = limiter(module.settings.rateLimit);
  const mcpLimit = limiter(module.settings.mcpRateLimit);

  const create = async ({ url, locals }: RouteContext): Promise<Handlers> => {
    const { settings } = module;
    // A Vercel preview behind Deployment Protection lets the endpoint read its own files with the
    // automation bypass secret, when the project has one.
    const bypass = module.secret('VERCEL_AUTOMATION_BYPASS_SECRET');
    const fetchAsset = assetsFetcher(module, locals);
    const fetchOptions = {
      ...(fetchAsset ? { fetch: fetchAsset } : {}),
      ...(bypass ? { headers: { 'x-vercel-protection-bypass': bypass } } : {}),
    };
    const index: RemoteIndex = remoteIndex(new URL(settings.indexPath, url), fetchOptions);
    const indexes = Object.fromEntries(
      Object.entries(settings.localeIndexPaths ?? {}).map(([locale, path]) => [
        locale,
        remoteIndex(new URL(path, url), fetchOptions),
      ]),
    );
    const loaded = await index();
    const query = await queryModel(module, loaded.embedding?.model);
    return {
      ask: createAskHandler({
        index,
        ...(Object.keys(indexes).length > 0 ? { indexes } : {}),
        model: module.chatModel(),
        ...query,
        siteName: settings.siteName,
        rateLimit: askLimit,
        ...(settings.budget ? { budget: settings.budget } : {}),
        answerCache: settings.answerCache,
        ...(settings.turnstile ? { challenge: turnstileChallenge(module) } : {}),
      }),
      mcp: createMcpHandler({
        index,
        // Keyword-only, so agents' searches call no model.
        siteName: settings.siteName,
        ...(settings.siteUrl ? { siteUrl: settings.siteUrl } : {}),
        rateLimit: mcpLimit,
      }),
    };
  };

  return (context) => {
    handlers ??= create(context).catch((error: unknown) => {
      handlers = null;
      throw error;
    });
    return handlers;
  };
}

/** Answers `context.request` with one of the handlers, or a 500 when the index cannot load. */
export async function serve(
  handlers: (context: RouteContext) => Promise<Handlers>,
  which: keyof Handlers,
  context: RouteContext,
): Promise<Response> {
  let address: string | undefined;
  try {
    address = context.clientAddress;
  } catch {
    // An adapter that cannot tell; the limiter keys these together.
  }
  if (address) clients.set(context.request, address);
  let ready: Handlers;
  try {
    ready = await handlers(context);
  } catch (error) {
    console.error('[ondocs]', error);
    return Response.json(
      { error: { code: 'internal_error', message: 'The ask endpoint is misconfigured.' } },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
  return ready[which](context.request);
}
