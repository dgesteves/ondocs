// createOndocs: the ask endpoint and the MCP endpoint from one set of options, so the docs people
// ask and the docs agents search are the same docs, searched the same way.
import type { RetrievalOptions } from '../search/retrieve';
import { createAskHandler, type AskHandlerOptions } from './handler';
import { createMcpHandler, type McpHandlerOptions } from './mcp';
import type { RetrievalHooks } from './retrieval';
import { sharedIndexSource } from './shared';

/** The options `createOndocs` gives both endpoints, which neither takes on its own. */
type SharedOption =
  'index' | 'indexes' | 'embeddingModel' | 'embeddingProviderOptions' | 'siteName';

export interface OndocsOptions extends Pick<
  AskHandlerOptions,
  SharedOption | 'headers' | 'failureMode' | 'rateLimitFailure' | 'maxBodyBytes' | 'onError'
> {
  /**
   * Retrieval for both: the relevance gate's settings, such as the `minSimilarity` of your
   * embedding model, and the `rerank` and `retrieve` hooks. Each endpoint's own `retrieval` goes
   * over it, as `ask: { retrieval: { topK: 4 } }`; the MCP endpoint's search keeps its looser
   * keyword gate unless one is set here or in `mcp.retrieval`.
   */
  retrieval?: RetrievalOptions & RetrievalHooks;
  /**
   * The ask endpoint's own options: `model`, and any of `createAskHandler`'s but the shared ones,
   * `allowedOrigins` among them.
   */
  ask: Omit<AskHandlerOptions, SharedOption>;
  /**
   * The MCP endpoint's own options: any of `createMcpHandler`'s but the shared ones. With an
   * `embeddingModel`, each search embeds its query, as each question does; `embeddingModel:
   * false` keeps the MCP search keyword-only, so agents' searches cost no model call. Its
   * `allowedOrigins` is its own, as it turns away every other origin with a 403, hosted clients
   * such as claude.ai included, whose servers send one.
   */
  mcp?: Omit<McpHandlerOptions, SharedOption> & { embeddingModel?: false };
}

export interface OndocsHandlers {
  /** The ask endpoint, as `createAskHandler` makes it, for `/api/ask`. */
  ask: (request: Request) => Promise<Response>;
  /** The MCP endpoint, as `createMcpHandler` makes it, for `/api/mcp`. */
  mcp: (request: Request) => Promise<Response>;
}

/**
 * Creates the ask endpoint and the MCP endpoint from one set of options: the same index, and the
 * same index for each locale, loaded once for both; the same embedding model, retrieval settings
 * and hooks, so agents get the results the dialog answers from; and the same site name.
 * `headers`, `failureMode` (or its old name, `rateLimitFailure`), `maxBodyBytes` and `onError`
 * are shared too, under each endpoint's own. The rate limit, the budget and `allowedOrigins` are
 * each endpoint's own, with its own defaults: 10 questions and 60 tool calls a minute per client
 * IP.
 *
 * ```ts
 * const { ask, mcp } = createOndocs({
 *   index,
 *   embeddingModel: openai.embedding('text-embedding-3-small'),
 *   siteName: 'the Acme docs',
 *   ask: { model: openai('gpt-5.4-mini') },
 * });
 * ```
 */
export function createOndocs(options: OndocsOptions): OndocsHandlers {
  const { ask, mcp = {}, retrieval, headers, index, indexes, ...shared } = options;
  const { embeddingModel: mcpEmbedding, ...mcpOwn } = mcp;
  const sources = {
    index: sharedIndexSource(index),
    ...(indexes
      ? {
          indexes: Object.fromEntries(
            Object.entries(indexes).map(([locale, source]) => [locale, sharedIndexSource(source)]),
          ),
        }
      : {}),
  };
  return {
    ask: createAskHandler({
      ...shared,
      ...sources,
      ...ask,
      retrieval: retrieval || ask.retrieval ? { ...retrieval, ...ask.retrieval } : undefined,
      headers: { ...headers, ...ask.headers },
    }),
    mcp: createMcpHandler({
      ...shared,
      ...sources,
      ...mcpOwn,
      ...(mcpEmbedding === false ? { embeddingModel: undefined } : {}),
      retrieval: retrieval || mcp.retrieval ? { ...retrieval, ...mcp.retrieval } : undefined,
      headers: { ...headers, ...mcp.headers },
    }),
  };
}
