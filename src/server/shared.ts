// What the ask handler and the MCP handler share: the request guard (method, content type, rate
// limit, a capped body, JSON, the daily budget), CORS for the origins they allow, loading the
// index once, embedding a query as the index was embedded, and the default rate limit. Web APIs
// only.
import { embed, type EmbeddingModel } from 'ai';

import { embeddingModelId, sameEmbeddingModel, type EmbeddingProviderOptions } from '../build';
import { loadIndex, type LoadedIndex } from '../search/retrieve';
import { memoryRateLimit, type RateLimiter, type RateLimitResult } from './rate-limit';
import { isLiveIndex } from './remote-index';

/**
 * The index in any form `loadIndex` accepts: the parsed JSON (`import index from
 * './ask-index.json'`), its text, or an already loaded index.
 */
export type IndexSource = object | string;

/** Status for a request the client abandoned (nginx's convention); nobody reads the body. */
export const CLIENT_CLOSED = 499;

/**
 * Reads the body as UTF-8, giving up as soon as it exceeds `limit` bytes. `Content-Length` is
 * advisory (chunked requests have none), so the bytes are counted as they arrive.
 */
export async function readBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** `application/json`, with any parameters (`; charset=utf-8`). */
export const isJson = (contentType: string | null): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

/** The rate-limit headers of a 429: `Retry-After` and the `RateLimit-*` fields the limiter gave. */
export function rateLimitHeaders(limit: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {};
  if (limit.reset !== undefined) {
    const seconds = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    headers['retry-after'] = String(seconds);
    headers['ratelimit-reset'] = String(seconds);
  }
  if (limit.limit !== undefined) headers['ratelimit-limit'] = String(limit.limit);
  if (limit.remaining !== undefined) headers['ratelimit-remaining'] = String(limit.remaining);
  return headers;
}

/** Why the request guard turned a request away. */
export type RefusalReason =
  /** Not a POST: a 405, with `Allow`. */
  | 'method'
  /** Not `application/json`: a 415. */
  | 'media_type'
  /** Over `maxBodyBytes`, by its `Content-Length` or while it was read: a 413. */
  | 'too_large'
  /** The body could not be read: a 400. */
  | 'unreadable'
  /** The body is not JSON: a 400. */
  | 'not_json'
  /** Over the rate limit: a 429, with `Retry-After` when the limiter says when. */
  | 'rate_limited'
  /** The day's budget is spent: a 429, with `Retry-After`. */
  | 'budget'
  /** The rate limiter or the budget store failed, and fails closed: a 503. */
  | 'unavailable';

/**
 * A request the guard turned away, before the handler did any work on it. Each handler words it
 * in its own format: the ask endpoint as `{ error: { code, message } }`, the MCP endpoint as a
 * JSON-RPC error.
 */
export interface Refusal {
  reason: RefusalReason;
  status: number;
  headers?: Record<string, string>;
}

const REFUSAL_STATUS: Record<RefusalReason, number> = {
  method: 405,
  media_type: 415,
  too_large: 413,
  unreadable: 400,
  not_json: 400,
  rate_limited: 429,
  budget: 429,
  unavailable: 503,
};

const refuse = (reason: RefusalReason, headers?: Record<string, string>): Refusal => ({
  reason,
  status: REFUSAL_STATUS[reason],
  ...(headers ? { headers } : {}),
});

export interface RequestGuardOptions {
  /** The limiter, or `null` for none. */
  rateLimit: RateLimiter | null;
  /**
   * When the limiter or the budget store fails: `"closed"` (the default) turns the request away
   * with a 503, and `"open"` lets it through. Either way the error is reported.
   */
  failure: 'closed' | 'open' | undefined;
  maxBodyBytes: number;
  report: (error: unknown) => void;
  /** The budget's clock, for when a spent budget resets. Default `Date.now`. */
  now?: (() => number) | undefined;
}

/** The checks both handlers run on a request, each in its own order. */
export interface RequestGuard {
  /**
   * What a request must be before a handler reads it, in this order: a POST, with an
   * `application/json` body (which a browser on another site cannot send without a CORS
   * preflight), within the rate limit unless `limit` is `false`, no larger than `maxBodyBytes`,
   * and JSON. `{ body }` is the parsed body.
   */
  read(
    request: Request,
    options?: { limit?: boolean },
  ): Promise<{ body: unknown } | { refusal: Refusal }>;
  /** The rate limit alone, for a handler that counts only some requests: `null` lets it through. */
  limit(request: Request): Promise<Refusal | null>;
  /**
   * A budget check: `{ result }` lets the request through (`result` is `null` when the store
   * failed and `failure` is `"open"`); `{ refusal }` turns it away, once the day's budget is spent
   * or when the store fails.
   */
  admit<T extends { allowed: boolean; resetAt?: number }>(
    check: () => Promise<T>,
  ): Promise<{ refusal: Refusal } | { result: T | null }>;
}

/**
 * The request guard behind both handlers, so a fix to one check reaches both. The rate limit and
 * the budget fail closed by default: they stand between the endpoint and an unbounded bill, and
 * their outage can be provoked (a flood can exhaust a Redis plan's request quota), so an error
 * should not quietly switch them off.
 */
export function requestGuard(options: RequestGuardOptions): RequestGuard {
  const { rateLimit, maxBodyBytes, report } = options;
  const failOpen = options.failure === 'open';

  const limit = async (request: Request): Promise<Refusal | null> => {
    if (!rateLimit) return null;
    let result: RateLimitResult;
    try {
      result = await rateLimit(request);
    } catch (error) {
      report(error);
      if (!failOpen) return refuse('unavailable');
      return null;
    }
    return result.success ? null : refuse('rate_limited', rateLimitHeaders(result));
  };

  return {
    limit,
    async read(request, { limit: limited = true } = {}) {
      if (request.method !== 'POST')
        return { refusal: refuse('method', { allow: 'POST, OPTIONS' }) };
      if (!isJson(request.headers.get('content-type'))) return { refusal: refuse('media_type') };
      if (limited) {
        const refusal = await limit(request);
        if (refusal) return { refusal };
      }
      if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) {
        return { refusal: refuse('too_large') };
      }
      let raw: string | null;
      try {
        raw = await readBody(request, maxBodyBytes);
      } catch {
        return { refusal: refuse('unreadable') };
      }
      if (raw === null) return { refusal: refuse('too_large') };
      try {
        return { body: JSON.parse(raw) as unknown };
      } catch {
        return { refusal: refuse('not_json') };
      }
    },
    async admit(check) {
      let result;
      try {
        result = await check();
      } catch (error) {
        report(error);
        return failOpen ? { result: null } : { refusal: refuse('unavailable') };
      }
      if (result.allowed) return { result };
      const now = options.now ?? Date.now;
      const seconds = Math.max(1, Math.ceil(((result.resetAt ?? 0) - now()) / 1000));
      return { refusal: refuse('budget', { 'retry-after': String(seconds) }) };
    },
  };
}

/** The origins a handler sends CORS headers to: a list, or `'*'` for any. */
export type AllowedOrigins = readonly string[] | '*';

export interface CorsPolicy {
  /**
   * Whether a request from `origin` may be answered: any without a list, the endpoint's own
   * origin, and the listed ones.
   */
  allows(origin: string, request: Request): boolean;
  /**
   * The CORS headers of the response to `request`: for an allowed origin other than the
   * endpoint's own, and none without a list.
   */
  headers(request: Request): Record<string, string>;
  /** The CORS headers of a preflight's 204: `headers`, and what the request may send. */
  preflight(request: Request): Record<string, string>;
}

/** An origin as a browser sends it in `Origin`: a scheme and a host, with a port or not. */
const ORIGIN = /^[a-z][a-z\d+.-]*:\/\/[^/?#\s]+$/;

/**
 * `allowed`, checked as the handler is made: `'*'`, or a list of origins as a browser sends them,
 * which is what each request's `Origin` is compared with. An entry with a trailing slash, a path,
 * capitals or a default port matches no request, and a string other than `'*'` would be searched
 * as text, so each fails here with what to write instead.
 */
function originList(allowed: AllowedOrigins | undefined): AllowedOrigins | undefined {
  if (allowed === undefined || allowed === '*') return allowed;
  const entries: unknown = allowed;
  if (!Array.isArray(entries)) {
    throw new TypeError(
      `allowedOrigins takes '*' or a list of origins, such as ['https://blog.example.com'] (got ${JSON.stringify(allowed)}).`,
    );
  }
  for (const entry of entries as unknown[]) {
    if (entry === '*') {
      throw new TypeError(
        "allowedOrigins lists '*': pass allowedOrigins: '*' to allow any origin.",
      );
    }
    // `new URL` writes an http(s) origin as browsers do: lowercase, without the default port.
    const parsed = typeof entry === 'string' && URL.canParse(entry) ? new URL(entry) : null;
    const web = parsed?.protocol === 'http:' || parsed?.protocol === 'https:';
    if (typeof entry === 'string' && ORIGIN.test(entry) && (!web || parsed.origin === entry)) {
      continue;
    }
    const fix = web ? `; use ${JSON.stringify(parsed.origin)}` : '';
    throw new TypeError(
      `allowedOrigins takes origins as browsers send them, such as "https://blog.example.com", with no path or trailing slash (got ${JSON.stringify(entry)}${fix}).`,
    );
  }
  return allowed;
}

/**
 * CORS for the `allowed` origins: each gets `Access-Control-Allow-Origin` with its own origin
 * (and `Vary: Origin`), or `*` for `'*'`, and may read `exposeHeaders`; a preflight from one is
 * told it may send `methods` and `allowHeaders`, for a day. Any other origin gets no CORS
 * headers, so a browser on it can neither read the answer nor get past the preflight.
 */
export function corsPolicy(
  given: AllowedOrigins | undefined,
  cors: { methods: string; allowHeaders: string; exposeHeaders: string },
): CorsPolicy {
  const allowed = originList(given);
  const ownOrigin = (request: Request): string => new URL(request.url).origin;
  const allows = (origin: string, request: Request): boolean =>
    allowed === undefined ||
    allowed === '*' ||
    allowed.includes(origin) ||
    origin === ownOrigin(request);
  const headers = (request: Request): Record<string, string> => {
    const origin = request.headers.get('origin');
    if (!origin || allowed === undefined || origin === ownOrigin(request)) return {};
    if (!allows(origin, request)) return {};
    return {
      'access-control-allow-origin': allowed === '*' ? '*' : origin,
      'access-control-expose-headers': cors.exposeHeaders,
      ...(allowed === '*' ? {} : { vary: 'origin' }),
    };
  };
  return {
    allows,
    headers,
    preflight(request) {
      const given = headers(request);
      if (!('access-control-allow-origin' in given)) return {};
      return {
        ...given,
        'access-control-allow-methods': cors.methods,
        'access-control-allow-headers': cors.allowHeaders,
        'access-control-max-age': '86400',
      };
    },
  };
}

/**
 * Indexes already loaded, by the object they were loaded from, so two handlers given the same
 * imported JSON (an ask endpoint and an MCP endpoint in one app) hold one copy in memory.
 */
const loaded = new WeakMap<object, LoadedIndex>();

/** `import('./ask-index.json')` resolves to a module namespace with the JSON as `default`. */
function unwrapModule(value: unknown): unknown {
  if (value && typeof value === 'object' && !('format' in value) && 'default' in value) {
    return value.default;
  }
  return value;
}

function isLoadedIndex(value: unknown): value is LoadedIndex {
  return typeof value === 'object' && value !== null && 'bm25' in value && 'chunks' in value;
}

/** Loads `source` into memory, or returns the copy already loaded from the same object. */
function load(source: unknown): LoadedIndex {
  if (isLoadedIndex(source)) return source;
  const value = unwrapModule(source);
  if (typeof value !== 'object' || value === null) return loadIndex(value);
  let index = loaded.get(value);
  if (!index) {
    index = loadIndex(value);
    loaded.set(value, index);
  }
  return index;
}

/**
 * The index a handler serves, loaded on first use and then kept: `source` as given, or what a
 * function returns. A failed load (a network blip fetching the file) is retried on the next call
 * instead of poisoning every later request. A `remoteIndex` is asked on every call instead,
 * as it follows the site's deploys. Throws when `embeddingModel` is not the model the index was
 * embedded with.
 */
export function indexLoader(
  source: IndexSource | (() => IndexSource | Promise<IndexSource>),
  embeddingModel: EmbeddingModel | undefined,
): () => Promise<LoadedIndex> {
  const resolve = async (): Promise<LoadedIndex> => {
    const index = load(typeof source === 'function' ? await source() : source);
    checkModel(index);
    return index;
  };
  const checkModel = (index: LoadedIndex): void => {
    if (
      index.embedding &&
      embeddingModel &&
      !sameEmbeddingModel(index.embedding.model, embeddingModelId(embeddingModel))
    ) {
      throw new Error(
        `The index was embedded with "${index.embedding.model}" but the handler embeds queries with ` +
          `"${embeddingModelId(embeddingModel)}". Rebuild the index or pass the same embeddingModel.`,
      );
    }
  };
  // A remote index changes with the site, and keeps its own copy: ask it every time.
  if (isLiveIndex(source)) {
    return async () => {
      const index = await source();
      checkModel(index);
      return index;
    };
  }
  let promise: Promise<LoadedIndex> | null = null;
  return () => {
    promise ??= resolve().catch((error: unknown) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}

/**
 * `source`, for two handlers to load once between them: an object already is (by the cache
 * above), and a function is called once, and what it returns loaded once, until a load fails. A
 * `remoteIndex` is passed on as it is, as the handlers ask it on every request.
 */
export function sharedIndexSource(
  source: IndexSource | (() => IndexSource | Promise<IndexSource>),
): IndexSource | (() => IndexSource | Promise<IndexSource>) {
  if (typeof source !== 'function' || isLiveIndex(source)) return source;
  let loading: Promise<LoadedIndex> | null = null;
  return () => {
    loading ??= (async () => load(await source()))().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
}

/**
 * The provider options a query is embedded with: `given`, plus, for OpenAI's `text-embedding-3`
 * models (whose size is an option), the size the index was built at, unless `given` sets one. So
 * an index built at 512 dimensions, or at the model's full 1,536, is queried at its own size
 * without the endpoint repeating it.
 */
function queryProviderOptions(
  embedding: NonNullable<LoadedIndex['embedding']>,
  given: EmbeddingProviderOptions | undefined,
): EmbeddingProviderOptions | undefined {
  if (!/(?:^|\/)text-embedding-3-/.test(embedding.model)) return given;
  if (given?.openai && 'dimensions' in given.openai) return given;
  return { ...given, openai: { dimensions: embedding.dimensions, ...given?.openai } };
}

/**
 * Embeds `text` for a search of `index`: `null` without a model or vectors (keyword-only), and
 * `null` when the provider fails, which is reported and degrades the search to keywords. Throws
 * when the request was aborted, or when the vector's size does not match the index.
 */
export async function embedQuery(
  text: string,
  index: LoadedIndex,
  options: {
    embeddingModel?: EmbeddingModel | undefined;
    embeddingProviderOptions?: EmbeddingProviderOptions | undefined;
  },
  abortSignal: AbortSignal,
  reportError: (error: unknown) => void,
): Promise<number[] | null> {
  if (!options.embeddingModel || !index.vectors || !index.embedding) return null;
  const providerOptions = queryProviderOptions(index.embedding, options.embeddingProviderOptions);
  let embedding: number[];
  try {
    ({ embedding } = await embed({
      model: options.embeddingModel,
      value: text,
      maxRetries: 1,
      abortSignal,
      ...(providerOptions ? { providerOptions } : {}),
    }));
  } catch (error) {
    if (abortSignal.aborted) throw error;
    // Degrade to keyword retrieval rather than failing the request.
    reportError(error);
    return null;
  }
  if (embedding.length !== index.embedding.dimensions) {
    throw new Error(
      `Query embeddings have ${String(embedding.length)} dimensions but the index has ` +
        `${String(index.embedding.dimensions)}. Pass the same embeddingProviderOptions used to ` +
        'build it, e.g. { openai: { dimensions: 512 } }.',
    );
  }
  return embedding;
}

/**
 * The limiter a handler uses when it is given none: `limit` requests a minute per client IP, per
 * instance. A request without an `X-Forwarded-For` header has no client IP to key on, so all
 * such requests share one bucket: on a platform that does not set the header, that is one limit
 * for every client, which errs on the safe side rather than letting them through unlimited. The
 * first one is reported, with the fix.
 */
export function defaultRateLimit(
  limit: number,
  what: string,
  report: (error: unknown) => void,
): RateLimiter {
  const limiter = memoryRateLimit({ limit, windowMs: 60_000 });
  let reported = false;
  return (request) => {
    if (!reported && !request.headers.get('x-forwarded-for')?.trim()) {
      reported = true;
      report(
        new Error(
          'The default rate limit found no X-Forwarded-For header, so every request without one ' +
            `shares a single bucket of ${String(limit)} ${what} a minute. ` +
            "Pass rateLimit: memoryRateLimit({ trustedHeader: '<the client IP header your " +
            "platform sets>' }), or rateLimit: false if something else limits this endpoint.",
        ),
      );
    }
    return limiter(request);
  };
}
