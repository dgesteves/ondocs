// The MCP endpoint: the index as `search`, `fetch` and `list_pages` tools for agents, over MCP's
// Streamable HTTP transport, as a Web-standard `(request: Request) => Promise<Response>`. It never
// calls a language model: the agent brings its own.
import type { EmbeddingModel } from 'ai';

import { version } from '../../package.json' with { type: 'json' };
import type { EmbeddingProviderOptions } from '../build';
import type { LoadedIndex, RetrievalOptions } from '../search/retrieve';
import { createBudget, type BudgetOptions } from './budget';
import {
  fetchPage,
  listPages,
  mcpTools,
  searchResult,
  searchSections,
  toolError,
  type McpTool,
  type McpToolResult,
} from './mcp-tools';
import type { RateLimiter, RateLimitResult } from './rate-limit';
import {
  CLIENT_CLOSED,
  defaultRateLimit,
  embedQuery,
  indexLoader,
  isJson,
  rateLimitHeaders,
  readBody,
  type IndexSource,
} from './shared';

/**
 * The revisions that start with `initialize` and keep their state for the session, which this
 * endpoint answers statelessly: Cursor, VS Code and most clients speak these today.
 */
const LEGACY_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;
/**
 * The stateless revisions: every request names its version and the client's capabilities in
 * `_meta`, with no `initialize` and no session. Claude Code's newer runtime asks for these first.
 */
const MODERN_VERSIONS = ['2026-07-28'] as const;

/** The protocol revisions the endpoint speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [
  ...MODERN_VERSIONS,
  ...[...LEGACY_VERSIONS].reverse(),
];

const LATEST_LEGACY_VERSION = '2025-11-25';

/** The keys of a 2026-07-28 request's and result's `_meta`. */
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

/** How long a client may reuse `server/discover` and `tools/list`: the tools change on deploy. */
const LIST_TTL_MS = 3_600_000;

export interface McpHandlerOptions {
  /**
   * The index: `import index from './ask-index.json'`, its JSON text, the result of `loadIndex`,
   * or a (possibly async) function returning any of those, called once on the first request. The
   * same imported object given to `createAskHandler` too is loaded once and shared.
   */
  index: IndexSource | (() => IndexSource | Promise<IndexSource>);
  /**
   * The model the index was embedded with, to embed each search query (one embedding call per
   * search, at the provider's embedding price). Without it, search is keyword-only and the
   * endpoint makes no model call at all.
   */
  embeddingModel?: EmbeddingModel;
  /** As `createAskHandler`'s: must match what the index was built with. */
  embeddingProviderOptions?: EmbeddingProviderOptions;
  /** Names the docs in the tools' descriptions, e.g. `"the Acme docs"`. Default `"this site"`. */
  siteName?: string;
  /**
   * The site's origin, such as `https://docs.example.com`, to make the index's URLs absolute in
   * results. Default: the origin the request came to, right when the endpoint runs on the site's
   * own host. `false` keeps the URLs as the index has them.
   */
  siteUrl?: string | false;
  /** The server's name in `initialize`, which clients show. Default `"ondocs"`. */
  name?: string;
  /**
   * The server's version beside its `name`, such as your docs' or your product's. Default: the
   * version of ondocs that serves it, which suits the name `ondocs` and not one of your own.
   */
  version?: string;
  /** Instructions for the agent, sent on `initialize`. Default: how to use the tools. */
  instructions?: string;
  /** Retrieval settings for `search`, over its defaults: `{ minKeywordCoverage: 0.3 }`. */
  retrieval?: RetrievalOptions;
  /** Longest accepted search query, in characters. Default 500. */
  maxQueryLength?: number;
  /** Largest accepted request body, in bytes, enforced while reading. Default 64 KiB. */
  maxBodyBytes?: number;
  /**
   * Limits how often one client may call a tool. Default `memoryRateLimit({ limit: 60 })`: 60
   * calls a minute per client IP, from the last `X-Forwarded-For` entry, per server instance. As
   * for `createAskHandler`, pass your own (with your platform's `trustedHeader`), or `false`.
   * Hosted clients (ChatGPT, claude.ai) call from their own servers, so their users share IPs.
   */
  rateLimit?: RateLimiter | false;
  /** As `createAskHandler`'s: `"closed"` (default) answers 503 when the limiter or budget store fails. */
  rateLimitFailure?: 'closed' | 'open';
  /**
   * A daily cap on tool calls for the whole endpoint, counted in `store` (memory, per instance,
   * by default; its keys start `ask-my-site:mcp-budget:`). There is no token budget: no model
   * generates anything here.
   */
  budget?: Omit<BudgetOptions, 'tokensPerDay'>;
  /**
   * Which `Origin`s may call the endpoint, as `['https://app.example.com']`, or `'*'` for any,
   * with the CORS headers a page on them needs. With a list, a request from any other origin gets
   * a 403 (MCP's check against DNS rebinding); include the origins of hosted clients you use, as
   * claude.ai's servers send one. By default every origin is answered but none gets CORS headers,
   * so a page on another site cannot read the answers, while hosted clients and those outside a
   * browser work: the docs are public, and a server on the public internet gains nothing from
   * the check.
   */
  allowedOrigins?: readonly string[] | '*';
  /** Extra headers on every response. */
  headers?: Record<string, string>;
  /** Called after each tool call, e.g. to count agent traffic. Errors in it are reported, not raised. */
  onToolCall?: (event: McpToolCallEvent) => void | Promise<void>;
  /** Called with errors that were handled. Default `console.error`. */
  onError?: (error: unknown) => void;
}

export interface McpToolCallEvent {
  tool: string;
  arguments: Record<string, unknown>;
  /** Whether the tool answered with an error the agent reads (no such page, a bad argument). */
  isError: boolean;
  /** For `search`, the ids it returned, best first. */
  results?: string[];
  /** For `search`, whether the query was embedded (`hybrid`) or matched on keywords. */
  retrieval?: 'hybrid' | 'keyword';
  durationMs: number;
}

type JsonRpcId = string | number;

/** Answers with a JSON-RPC error, at an HTTP status. */
type RpcError = (
  status: number,
  id: JsonRpcId | null,
  code: number,
  message: string,
  extra?: { data?: unknown; headers?: Record<string, string> },
) => Response;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC's error codes, and MCP's. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** Implementation-defined server errors are -32000 to -32019. */
const SERVER_ERROR = -32000;
/** 2026-07-28: an `MCP-Protocol-Version`, `Mcp-Method` or `Mcp-Name` header missing or not matching the body. */
const HEADER_MISMATCH = -32020;
/** 2026-07-28: a protocol version the server does not speak. */
const UNSUPPORTED_VERSION = -32022;

const DEFAULT_RATE_LIMIT = 60;

/** What a browser client may send: 2026-07-28's routing headers, and 2025's session ones. */
const CORS_HEADERS =
  'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id';

/**
 * Creates the MCP endpoint: a Web-standard `(request: Request) => Promise<Response>` that serves
 * the index to agents over MCP's Streamable HTTP transport, statelessly, with three read-only
 * tools: `search` (ranked sections with snippets), `fetch` (a page or section as Markdown) and
 * `list_pages`. Mount it on POST (and GET, OPTIONS and DELETE, which it answers too) at a path
 * such as `/api/mcp`.
 *
 * It speaks MCP 2026-07-28 (`server/discover`, no session) and, for the clients that still start
 * with `initialize`, 2025-11-25 and the revisions before it, answered without a session.
 *
 * It never calls a language model. Given an `embeddingModel`, each search embeds its query once;
 * without one, search is keyword-only and the endpoint calls no model at all.
 */
export function createMcpHandler(
  options: McpHandlerOptions,
): (request: Request) => Promise<Response> {
  const siteName = options.siteName ?? 'this site';
  const maxQueryLength = options.maxQueryLength ?? 500;
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const reportError =
    options.onError ??
    ((error: unknown) => {
      console.error('[ondocs]', error);
    });
  const rateLimit =
    options.rateLimit === undefined
      ? defaultRateLimit(DEFAULT_RATE_LIMIT, 'tool calls', reportError)
      : options.rateLimit || null;
  const budget = options.budget
    ? createBudget({ prefix: 'ask-my-site:mcp-budget:', ...options.budget })
    : null;
  if (typeof options.siteUrl === 'string' && !URL.canParse(options.siteUrl)) {
    throw new TypeError(
      `siteUrl must be an absolute URL (got ${JSON.stringify(options.siteUrl)}).`,
    );
  }
  const getIndex = indexLoader(options.index, options.embeddingModel);
  const tools = mcpTools(siteName, maxQueryLength);
  const serverInfo = {
    name: options.name ?? 'ondocs',
    title: siteName === 'this site' ? 'Docs search' : `Search ${siteName}`,
    version: options.version ?? version,
  };
  const instructions =
    options.instructions ??
    `Use these tools to answer from ${siteName}: search for the sections that match, then fetch ` +
      'the ones you need to read in full. Cite the URLs you used.';
  const capabilities = { tools: { listChanged: false } };

  const allowed = options.allowedOrigins;
  const ownOrigin = (request: Request): string => new URL(request.url).origin;
  const originAllowed = (origin: string, request: Request): boolean =>
    allowed === undefined ||
    allowed === '*' ||
    allowed.includes(origin) ||
    origin === ownOrigin(request);
  /** CORS headers for an allowed cross-origin caller; none by default. */
  const corsFor = (request: Request): Record<string, string> => {
    const origin = request.headers.get('origin');
    if (!origin || allowed === undefined || origin === ownOrigin(request)) return {};
    if (!originAllowed(origin, request)) return {};
    return {
      'access-control-allow-origin': allowed === '*' ? '*' : origin,
      'access-control-expose-headers': 'mcp-protocol-version',
      ...(allowed === '*' ? {} : { vary: 'origin' }),
    };
  };

  return async function handleMcp(request: Request): Promise<Response> {
    const baseHeaders = { 'cache-control': 'no-store', ...options.headers, ...corsFor(request) };
    const reply = (status: number, body: unknown, headers?: Record<string, string>): Response =>
      body === null
        ? new Response(null, { status, headers: { ...baseHeaders, ...headers } })
        : Response.json(body, { status, headers: { ...baseHeaders, ...headers } });
    const rpcError: RpcError = (status, id, code, message, extra) =>
      reply(
        status,
        {
          jsonrpc: '2.0',
          id,
          error: { code, message, ...(extra?.data === undefined ? {} : { data: extra.data }) },
        },
        extra?.headers,
      );

    // MCP has HTTP servers check `Origin`, so a page on another site cannot reach a private
    // server through a name that resolves to it (DNS rebinding); see `allowedOrigins`.
    const origin = request.headers.get('origin');
    if (origin !== null && !originAllowed(origin, request)) {
      return rpcError(403, null, SERVER_ERROR, `Origin ${origin} is not allowed.`);
    }

    if (request.method === 'OPTIONS') {
      const cors = corsFor(request);
      return reply(204, null, {
        allow: 'POST, OPTIONS',
        ...('access-control-allow-origin' in cors
          ? {
              'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
              'access-control-allow-headers': CORS_HEADERS,
              'access-control-max-age': '86400',
            }
          : {}),
      });
    }
    // Stateless: no stream to open with GET, and no session to end with DELETE.
    if (request.method !== 'POST') {
      return rpcError(405, null, SERVER_ERROR, 'Method not allowed: send JSON-RPC with POST.', {
        headers: { allow: 'POST, OPTIONS' },
      });
    }
    if (!isJson(request.headers.get('content-type'))) {
      return rpcError(415, null, SERVER_ERROR, 'Send the body as application/json.');
    }
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) {
      return rpcError(413, null, INVALID_REQUEST, 'Request body too large.');
    }
    let raw: string | null;
    try {
      raw = await readBody(request, maxBodyBytes);
    } catch {
      return rpcError(400, null, PARSE_ERROR, 'Could not read the body.');
    }
    if (raw === null) return rpcError(413, null, INVALID_REQUEST, 'Request body too large.');
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return rpcError(400, null, PARSE_ERROR, 'Parse error: the body is not JSON.');
    }
    if (Array.isArray(message)) {
      return rpcError(400, null, INVALID_REQUEST, 'Batches are not supported: send one message.');
    }
    if (!isMessage(message)) {
      return rpcError(400, null, INVALID_REQUEST, 'Invalid JSON-RPC 2.0 message.');
    }

    const header = request.headers.get('mcp-protocol-version');
    const headerIsModern = header !== null && isModern(header);
    if (!('method' in message)) {
      // A response: 2026-07-28 has the server send no requests, so there is nothing to answer.
      if (headerIsModern) {
        return rpcError(400, null, INVALID_REQUEST, 'This server sends no requests to respond to.');
      }
      return reply(202, null);
    }
    // A notification: nothing to answer, in any revision.
    if (message.id === undefined) return reply(202, null);
    if (message.id === null) return rpcError(400, null, INVALID_REQUEST, 'A request needs an id.');
    const id = message.id;

    const meta = message.params?._meta;
    const claimed =
      typeof meta === 'object' && meta !== null && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)[META_VERSION]
        : undefined;
    if (claimed !== undefined) {
      return modern(
        request,
        message,
        id,
        meta as Record<string, unknown>,
        claimed,
        rpcError,
        reply,
      );
    }

    // 2025 and before: `initialize`, then requests that name their version in the header.
    if (message.method === 'initialize') {
      if (headerIsModern) {
        return rpcError(400, id, HEADER_MISMATCH, `initialize is not part of MCP ${header}.`);
      }
      const requested = message.params?.protocolVersion;
      return reply(200, {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion:
            typeof requested === 'string' && isLegacy(requested)
              ? requested
              : LATEST_LEGACY_VERSION,
          capabilities,
          serverInfo,
          instructions,
        },
      });
    }
    if (headerIsModern) {
      return rpcError(
        400,
        id,
        INVALID_PARAMS,
        `MCP ${header} requests carry _meta["${META_VERSION}"].`,
        {
          data: { supported: MCP_PROTOCOL_VERSIONS },
        },
      );
    }
    if (header !== null && !isLegacy(header)) {
      return rpcError(
        400,
        id,
        INVALID_REQUEST,
        `Unsupported MCP-Protocol-Version ${header}; supported: ${MCP_PROTOCOL_VERSIONS.join(', ')}.`,
        { data: { supported: MCP_PROTOCOL_VERSIONS, requested: header } },
      );
    }
    const ok = (result: unknown): Response => reply(200, { jsonrpc: '2.0', id, result });
    switch (message.method) {
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: tools satisfies McpTool[] });
      case 'tools/call':
        return callTool(request, message, id, ok, rpcError);
      default:
        return rpcError(200, id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  };

  /**
   * A 2026-07-28 request: its `_meta` names the version and the client's capabilities, its
   * headers repeat the version, the method and (for `tools/call`) the tool, and every result says
   * it is `complete`, who answered it, and for lists, how long it may be reused.
   */
  function modern(
    request: Request,
    message: JsonRpcRequest,
    id: JsonRpcId,
    meta: Record<string, unknown>,
    claimed: unknown,
    rpcError: RpcError,
    reply: (status: number, body: unknown, headers?: Record<string, string>) => Response,
  ): Response | Promise<Response> {
    const clientCapabilities = meta[META_CAPABILITIES];
    if (
      typeof claimed !== 'string' ||
      typeof clientCapabilities !== 'object' ||
      clientCapabilities === null ||
      Array.isArray(clientCapabilities)
    ) {
      return rpcError(
        400,
        id,
        INVALID_PARAMS,
        `_meta must carry "${META_VERSION}" (a string) and "${META_CAPABILITIES}" (an object).`,
      );
    }
    const headers = request.headers;
    if (headers.get('mcp-protocol-version') !== claimed) {
      return rpcError(
        400,
        id,
        HEADER_MISMATCH,
        'The MCP-Protocol-Version header must match _meta.',
      );
    }
    if (headers.get('mcp-method') !== message.method) {
      return rpcError(400, id, HEADER_MISMATCH, 'The Mcp-Method header must match the method.');
    }
    if (message.method === 'tools/call') {
      const name = decodeHeaderValue(headers.get('mcp-name'));
      if (name === null || name !== message.params?.name) {
        return rpcError(400, id, HEADER_MISMATCH, 'The Mcp-Name header must match params.name.');
      }
    }
    if (!isModern(claimed)) {
      // The versions `server/discover` offers: a 2025 client starts with `initialize` instead.
      return rpcError(400, id, UNSUPPORTED_VERSION, 'Unsupported protocol version', {
        data: { supported: [...MODERN_VERSIONS], requested: claimed },
      });
    }

    const complete = (result: Record<string, unknown>, cacheable = false): Response =>
      reply(200, {
        jsonrpc: '2.0',
        id,
        result: {
          resultType: 'complete',
          ...result,
          ...(cacheable ? { ttlMs: LIST_TTL_MS, cacheScope: 'public' } : {}),
          _meta: { [META_SERVER]: serverInfo },
        },
      });
    switch (message.method) {
      case 'server/discover':
        return complete(
          { supportedVersions: [...MODERN_VERSIONS], capabilities: { tools: {} }, instructions },
          true,
        );
      case 'tools/list':
        return complete({ tools }, true);
      case 'tools/call':
        return callTool(
          request,
          message,
          id,
          (result) => complete(result as Record<string, unknown>),
          rpcError,
        );
      default:
        return rpcError(404, id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  }

  async function callTool(
    request: Request,
    message: JsonRpcRequest,
    id: JsonRpcId,
    ok: (result: unknown) => Response,
    rpcError: RpcError,
  ): Promise<Response> {
    const name = message.params?.name;
    const args: unknown = message.params?.arguments ?? {};
    const tool = tools.find((candidate) => candidate.name === name);
    if (typeof name !== 'string' || !tool) {
      return rpcError(200, id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return ok(toolError('arguments must be an object.'));
    }

    if (rateLimit) {
      let limit: RateLimitResult;
      try {
        limit = await rateLimit(request);
      } catch (error) {
        reportError(error);
        if (options.rateLimitFailure !== 'open') return unavailable(id, rpcError);
        limit = { success: true };
      }
      if (!limit.success) {
        const headers = rateLimitHeaders(limit);
        return rpcError(
          429,
          id,
          SERVER_ERROR,
          `Too many requests. Try again in ${headers['retry-after'] ?? 'a few'} seconds.`,
          { headers },
        );
      }
    }
    if (budget) {
      let decision;
      try {
        decision = await budget.admit();
      } catch (error) {
        reportError(error);
        if (options.rateLimitFailure !== 'open') return unavailable(id, rpcError);
        decision = { allowed: true as const };
      }
      if (!decision.allowed) {
        const now = options.budget?.now ?? Date.now;
        const seconds = Math.max(1, Math.ceil((decision.resetAt - now()) / 1000));
        return rpcError(429, id, SERVER_ERROR, budget.message, {
          headers: { 'retry-after': String(seconds) },
        });
      }
    }

    let index: LoadedIndex;
    try {
      index = await getIndex();
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
      reportError(error);
      return rpcError(500, id, INTERNAL_ERROR, 'The MCP endpoint is misconfigured.');
    }

    const started = Date.now();
    const siteUrl =
      options.siteUrl === false ? undefined : (options.siteUrl ?? new URL(request.url).origin);
    const record = args as Record<string, unknown>;
    let result: McpToolResult;
    const event: Omit<McpToolCallEvent, 'isError' | 'durationMs'> = {
      tool: tool.name,
      arguments: record,
    };
    try {
      result = await run(tool.name, record, index, siteUrl, request, event);
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
      reportError(error);
      return rpcError(500, id, INTERNAL_ERROR, 'The tool failed. Try again.');
    }
    try {
      await options.onToolCall?.({
        ...event,
        isError: result.isError === true,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      reportError(error);
    }
    return ok(result);
  }

  async function run(
    tool: string,
    args: Record<string, unknown>,
    index: LoadedIndex,
    siteUrl: string | undefined,
    request: Request,
    event: Omit<McpToolCallEvent, 'isError' | 'durationMs'>,
  ): Promise<McpToolResult> {
    const string = (key: string, required: boolean): string | null | McpToolResult => {
      const value = args[key];
      if (value === undefined && !required) return null;
      if (typeof value !== 'string' || (required && !value.trim())) {
        return toolError(`${key} must be a ${required ? 'non-empty ' : ''}string.`);
      }
      return value;
    };
    switch (tool) {
      case 'search': {
        const query = string('query', true);
        if (typeof query !== 'string') return query ?? toolError('query is required.');
        if (query.length > maxQueryLength) {
          return toolError(`query is limited to ${String(maxQueryLength)} characters.`);
        }
        const vector = await embedQuery(query, index, options, request.signal, reportError);
        const results = searchSections(index, query, vector, {
          retrieval: options.retrieval,
          siteUrl,
        });
        event.results = results.map((entry) => entry.id);
        event.retrieval = vector ? 'hybrid' : 'keyword';
        return searchResult(results);
      }
      case 'fetch': {
        const reference = string('id', true);
        if (typeof reference !== 'string') return reference ?? toolError('id is required.');
        return fetchPage(index, reference, siteUrl);
      }
      case 'list_pages': {
        const prefix = string('prefix', false);
        if (prefix !== null && typeof prefix !== 'string') return prefix;
        return listPages(index, prefix ?? undefined, siteUrl);
      }
      default:
        return toolError(`Unknown tool: ${tool}`);
    }
  }
}

function unavailable(id: JsonRpcId, rpcError: RpcError): Response {
  return rpcError(503, id, SERVER_ERROR, 'The service is unavailable. Try again shortly.');
}

/** A JSON-RPC 2.0 request, notification or response. */
function isMessage(value: unknown): value is JsonRpcRequest | { jsonrpc: '2.0'; id: JsonRpcId } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') return false;
  if ('method' in record) {
    if (typeof record.method !== 'string') return false;
    if (
      record.params !== undefined &&
      (typeof record.params !== 'object' || record.params === null)
    ) {
      return false;
    }
    const id = record.id;
    return id === undefined || id === null || typeof id === 'string' || typeof id === 'number';
  }
  return 'result' in record || 'error' in record;
}

const isModern = (version: string): boolean =>
  (MODERN_VERSIONS as readonly string[]).includes(version);
const isLegacy = (version: string): boolean =>
  (LEGACY_VERSIONS as readonly string[]).includes(version);

/**
 * A header value as MCP 2026-07-28 writes it: as it is, or, for text that is not ASCII,
 * `=?base64?<UTF-8 bytes in base64>?=`. `null` when it is missing or does not decode.
 */
function decodeHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const encoded = /^=\?base64\?([A-Za-z\d+/]*={0,2})\?=$/i.exec(value)?.[1];
  if (encoded === undefined) return value;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
