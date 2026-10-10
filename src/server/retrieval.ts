// The ask endpoint's retrieval, with the hooks a site can put around it: a retriever of its own,
// and a reranker. The relevance gate decides last, whatever the hooks return.
import {
  DEFAULT_RETRIEVAL,
  gateHits,
  retrieve,
  type LoadedIndex,
  type RetrievalHit,
  type RetrievalOptions,
  type RetrievalResult,
} from '../search/retrieve';

/** What the hooks get besides the question: the index searched, and the request's signal. */
export interface RetrievalHookContext {
  /** The index the question is answered from (the locale's, with `indexes`). */
  index: LoadedIndex;
  /** Aborts when the visitor goes away: pass it on to a model call, as `abortSignal`. */
  signal: AbortSignal;
}

/** The question as retrieval sees it: its text, standalone, and its vector, if it was embedded. */
export interface RetrievalQuery {
  text: string;
  /** `null` for a keyword-only index, or when embedding the question failed. */
  vector: readonly number[] | null;
}

export interface RetrievalHooks {
  /**
   * Finds the candidate chunks instead of the built-in retrieval, or around it. `search` runs the
   * built-in one (BM25 and vectors, fused, behind the relevance gate) with any options over the
   * handler's, and returns up to `candidates` hits. Return the hits to answer from, best first,
   * on chunks of `context.index`, such as `search()`'s, filtered or merged with your own.
   */
  retrieve?: (
    query: RetrievalQuery,
    search: (options?: RetrievalOptions) => RetrievalHit[],
    context: RetrievalHookContext,
  ) => RetrievalHit[] | Promise<RetrievalHit[]>;
  /**
   * Puts the candidates in a new order, best first, before the first `topK` are kept: with the AI
   * SDK's `rerank()` and a reranking model, or to boost some sections. It gets up to `candidates`
   * hits (default 40), from the built-in retrieval or `retrieve`, and may drop some.
   */
  rerank?: (
    question: string,
    hits: RetrievalHit[],
    context: RetrievalHookContext,
  ) => RetrievalHit[] | Promise<RetrievalHit[]>;
}

/** `createAskHandler`'s `retrieval` option: the retrieval settings, and the hooks. */
export type AskRetrievalOptions = RetrievalOptions & RetrievalHooks;

/**
 * Retrieves the sources for a question. Without hooks, this is `retrieve` itself. With them, the
 * hooks get the candidates, and the relevance gate checks what they return against the index
 * (`gateHits`), so a reranker or a retriever cannot make an off-topic chunk count. A hook that
 * throws is reported, and the request goes on with what it had before that hook.
 */
export async function retrieveWithHooks(
  index: LoadedIndex,
  query: RetrievalQuery,
  options: AskRetrievalOptions | undefined,
  { signal, report }: { signal: AbortSignal; report: (error: unknown) => void },
): Promise<RetrievalResult> {
  const { retrieve: find, rerank, ...settings } = options ?? {};
  if (!find && !rerank) return retrieve(index, query, settings);

  const topK = settings.topK ?? DEFAULT_RETRIEVAL.topK;
  const pool = Math.max(topK, settings.candidates ?? DEFAULT_RETRIEVAL.candidates);
  const search = (overrides: RetrievalOptions = {}): RetrievalHit[] =>
    retrieve(index, query, { ...settings, topK: pool, ...overrides }).hits;
  const context: RetrievalHookContext = { index, signal };
  // A hook that fails while the visitor is still waiting is a bug or an outage to report; one
  // that fails because the visitor left is neither.
  const failed = (error: unknown): void => {
    if (!signal.aborted) report(error);
  };

  let hits: RetrievalHit[];
  if (find) {
    try {
      hits = await find({ text: query.text, vector: query.vector }, search, context);
    } catch (error) {
      failed(error);
      hits = search();
    }
  } else {
    hits = search();
  }
  if (rerank) {
    try {
      hits = await rerank(query.text, hits, context);
    } catch (error) {
      failed(error);
    }
  }
  return gateHits(index, query, Array.isArray(hits) ? hits : [], settings);
}
