import { chunkSearchText } from '../chunk';
import {
  AskIndexError,
  parseIndexFile,
  validateIndexFile,
  type AskIndexFile,
  type IndexDocument,
  type IndexEmbedding,
} from '../index-file';
import { decodeVector } from '../quantize';
import { tokenize } from '../text/tokenize';
import { Bm25Index } from './bm25';
import { reciprocalRankFusion } from './rrf';
import { VectorIndex } from './vectors';

/** A chunk as retrieval returns it: everything needed to cite it. */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  title: string;
  heading: string;
  /** The document URL plus the section anchor, ready to link to. */
  url: string;
  text: string;
}

/** An index ready to query: chunks, the BM25 inverted index and the int8 matrix, in memory. */
export interface LoadedIndex {
  /** The pages, sorted by id; a chunk's `documentId` names one. */
  readonly documents: readonly IndexDocument[];
  /** The chunks, page by page in `documents` order, each page's in reading order. */
  readonly chunks: readonly RetrievedChunk[];
  /** What the chunks were cut with: consecutive chunks of a section share up to `overlap` characters. */
  readonly chunking: AskIndexFile['chunking'];
  readonly embedding: IndexEmbedding | null;
  readonly contentHash: string;
  readonly bm25: Bm25Index;
  readonly vectors: VectorIndex | null;
}

export interface RetrievalOptions {
  /** Chunks to return at most. Default 6. */
  topK?: number;
  /** Candidates taken from each retriever before fusion. Default 40. */
  candidates?: number;
  /** RRF constant. Default 60. */
  rrfK?: number;
  /**
   * Minimum cosine similarity for a chunk to count as relevant on meaning alone. Default 0.25,
   * chosen for OpenAI `text-embedding-3-small`, and 0.65 for an index embedded with Workers AI's
   * `@cf/baai/bge-small-en-v1.5`; other models need their own value.
   */
  minSimilarity?: number;
  /**
   * Minimum share of the query's IDF mass a chunk must contain to count as relevant on keywords
   * alone. Default 0.5 for an index with embeddings, whose similarity side catches what the
   * keywords miss, and 0.4 for a keyword-only index: a question word found on no page carries the
   * most IDF, and every extra word adds to what a chunk has to cover, so a plain question can
   * fall under 0.5 with no other signal to catch it.
   */
  minKeywordCoverage?: number;
  /**
   * Whether a chunk that clears `minSimilarity` must also share a word with the question to
   * count. Default: `true` for an index built with `mockEmbeddingModel`, whose similarity comes
   * from shared words, so without one it is a hash collision; `false` otherwise, since real
   * embeddings match meaning without shared words.
   */
  similarityNeedsKeyword?: boolean;
  /**
   * Whether copies of a section count once. A chunk with the same title, heading and text as
   * another, such as the same section in two versions of versioned docs, or a page a site serves
   * at two paths, scores the same on every query, so its copies would fill the results. Default
   * `true`: only the copy at the shortest URL is searched, in the fewest path segments, so
   * `/docs/intro` over `/docs/next/intro` and `/docs/1.0/intro`. `false` searches every copy,
   * for a retriever that picks a version itself.
   */
  collapseCopies?: boolean;
}

export interface RetrievalHit {
  chunk: RetrievedChunk;
  /** Fused RRF score. Only meaningful relative to other hits for the same query. */
  score: number;
  /** Cosine similarity, or `null` when the query was keyword-only. */
  similarity: number | null;
  keywordScore: number;
  keywordCoverage: number;
}

export interface RetrievalResult {
  hits: RetrievalHit[];
  /**
   * `false` when no chunk passed either relevance threshold. The handler then answers
   * "I don't know" without calling the language model.
   */
  answerable: boolean;
  mode: 'hybrid' | 'keyword';
  /** The best raw signals seen, useful for tuning thresholds. */
  best: { similarity: number | null; keywordCoverage: number };
}

export const DEFAULT_RETRIEVAL = {
  topK: 6,
  candidates: 40,
  rrfK: 60,
  minSimilarity: 0.25,
  minKeywordCoverage: 0.5,
} as const satisfies Required<Omit<RetrievalOptions, 'similarityNeedsKeyword' | 'collapseCopies'>>;

/** The model id `mockEmbeddingModel` records in an index. */
const MOCK_EMBEDDING = /^mock-hash-\d+$/;

/**
 * `minSimilarity` for embedding models whose similarity scale differs from OpenAI's, as measured:
 * on docusaurus.io's docs and the 22 in-scope and 6 off-topic questions of the 2026-10-10 audit,
 * the lowest value at which no off-topic question passes the gate. BGE-small (with Workers AI's
 * default mean pooling) scored the off-topic questions 0.46 to 0.63 against their closest chunk,
 * so the 0.25 set for OpenAI's models would let every question through. Other models get it.
 */
const MODEL_MIN_SIMILARITY: Readonly<Record<string, number>> = {
  '@cf/baai/bge-small-en-v1.5': 0.65,
};

/** The `minSimilarity` an index's embedding model gets when the options set none. */
export function defaultMinSimilarity(model: string | undefined): number {
  return (
    (model === undefined ? undefined : MODEL_MIN_SIMILARITY[model]) ??
    DEFAULT_RETRIEVAL.minSimilarity
  );
}

/**
 * `minKeywordCoverage` for an index without embeddings, where keywords are the only signal. On
 * real questions about Docusaurus, Astro and Vitest (Stack Overflow and GitHub issue titles whose
 * answers link the docs), 0.5 refused 26 to 39% of the answerable ones and 0.4 refuses 13 to 17%,
 * letting one or two more of 15 off-topic questions reach the model. On docusaurus.io's docs and
 * the audit's 22 questions and 6 off-topic ones, it answers one more, and still refuses all 6.
 */
const KEYWORD_ONLY_MIN_KEYWORD_COVERAGE = 0.4;

/**
 * Builds the in-memory search structures from an index file, its JSON text, or the parsed JSON
 * (for example a static `import index from './ask-index.json'`).
 *
 * Do this once per process or isolate and reuse the result; `createAskHandler` does.
 */
export function loadIndex(input: unknown): LoadedIndex {
  const file = typeof input === 'string' ? parseIndexFile(input) : validateIndexFile(input);
  const chunks: RetrievedChunk[] = file.chunks.map((chunk) => {
    const document = file.documents[chunk.doc];
    if (!document) throw new AskIndexError(`Chunk ${chunk.id} points at a missing document.`);
    return {
      id: chunk.id,
      documentId: document.id,
      title: document.title,
      heading: chunk.heading,
      url: chunk.anchor ? `${document.url}#${chunk.anchor}` : document.url,
      text: chunk.text,
    };
  });

  const bm25 = new Bm25Index(chunks.map((chunk) => tokenize(chunkSearchText(chunk))));

  let vectors: VectorIndex | null = null;
  if (file.embedding) {
    const { dimensions } = file.embedding;
    const matrix = new Int8Array(file.chunks.length * dimensions);
    file.chunks.forEach((chunk, i) => {
      let vector: Int8Array;
      try {
        vector = decodeVector(chunk.vector ?? '', dimensions);
      } catch (error) {
        throw new AskIndexError(
          `Invalid ondocs index: chunks[${String(i)}].vector: ${(error as Error).message}`,
        );
      }
      matrix.set(vector, i * dimensions);
    });
    vectors = new VectorIndex(matrix, dimensions);
  }

  const loaded: LoadedIndex = {
    documents: file.documents.map(({ id, url, title }) => ({ id, url, title })),
    chunks,
    chunking: { maxChars: file.chunking.maxChars, overlap: file.chunking.overlap },
    embedding: file.embedding,
    contentHash: file.contentHash,
    bm25,
    vectors,
  };
  const copies = findCopies(file.chunks, chunks);
  if (copies) copiesByIndex.set(loaded, copies);
  return loaded;
}

/** Each loaded index's copies, when it has any: 1 for a chunk that another one stands for. */
const copiesByIndex = new WeakMap<LoadedIndex, Uint8Array>();

/**
 * Which chunks are copies of another, by their `hash`, of their title, heading and text: of each
 * set of copies, the one at the shortest URL stands for the rest, which are marked 1. `null`
 * when no two chunks are the same.
 */
function findCopies(
  indexChunks: readonly { hash: string }[],
  chunks: readonly RetrievedChunk[],
): Uint8Array | null {
  const kept = new Map<string, number>();
  let copies: Uint8Array | null = null;
  for (let i = 0; i < indexChunks.length; i += 1) {
    const hash = indexChunks[i]?.hash ?? '';
    if (hash === '') continue;
    const other = kept.get(hash);
    if (other === undefined) {
      kept.set(hash, i);
      continue;
    }
    copies ??= new Uint8Array(chunks.length);
    const keep = citedBefore(chunks[i]?.url ?? '', chunks[other]?.url ?? '') ? i : other;
    copies[keep === i ? other : i] = 1;
    kept.set(hash, keep);
  }
  return copies;
}

/** Path segments before the anchor: 2 for `/docs/intro`, 3 for `/docs/next/intro`. */
function depth(url: string): number {
  return (url.split('#', 1)[0] ?? '').replace(/\/+$/, '').split('/').length;
}

/** Whether a copy at `url` is cited over one at `other`: fewer path segments, then shorter. */
function citedBefore(url: string, other: string): boolean {
  return (depth(url) - depth(other) || url.length - other.length) < 0;
}

/** What a query scores on every chunk, and the relevance gate those scores decide. */
function measure(
  index: LoadedIndex,
  query: { text: string; vector?: ArrayLike<number> | null },
  options: RetrievalOptions,
) {
  const opts = {
    ...DEFAULT_RETRIEVAL,
    minSimilarity: defaultMinSimilarity(index.embedding?.model),
    minKeywordCoverage: index.vectors
      ? DEFAULT_RETRIEVAL.minKeywordCoverage
      : KEYWORD_ONLY_MIN_KEYWORD_COVERAGE,
    ...stripUndefined(options),
  };
  const keyword = index.bm25.search(tokenize(query.text));
  const similarities =
    index.vectors && query.vector ? index.vectors.similarities(query.vector) : null;

  const needsKeyword =
    opts.similarityNeedsKeyword ?? MOCK_EMBEDDING.test(index.embedding?.model ?? '');
  const relevant = (i: number): boolean =>
    (similarities !== null &&
      (similarities[i] ?? 0) >= opts.minSimilarity &&
      (!needsKeyword || (keyword.coverage[i] ?? 0) > 0)) ||
    (keyword.coverage[i] ?? 0) >= opts.minKeywordCoverage;

  let bestCoverage = 0;
  for (const i of keyword.ranked) bestCoverage = Math.max(bestCoverage, keyword.coverage[i] ?? 0);

  /** The hit for chunk `i`, with its signals, at `score`. */
  const hitAt = (i: number, score: number): RetrievalHit | null => {
    const chunk = index.chunks[i];
    if (!chunk) return null;
    return {
      chunk,
      score,
      similarity: similarities ? (similarities[i] ?? 0) : null,
      keywordScore: keyword.scores[i] ?? 0,
      keywordCoverage: keyword.coverage[i] ?? 0,
    };
  };

  return { opts, keyword, similarities, relevant, bestCoverage, hitAt };
}

/**
 * Hybrid retrieval: BM25 and cosine similarity, fused with reciprocal rank fusion, behind a
 * relevance gate.
 *
 * A chunk is a candidate only if it clears `minSimilarity` or `minKeywordCoverage`. If none does,
 * the result is not `answerable` and has no hits, which is how the agent says "I don't know"
 * instead of answering from unrelated context.
 *
 * Pass `vector: null` (or use a keyword-only index) to retrieve with BM25 alone, e.g. when the
 * embedding provider is down.
 */
export function retrieve(
  index: LoadedIndex,
  query: { text: string; vector?: ArrayLike<number> | null },
  options: RetrievalOptions = {},
): RetrievalResult {
  const { opts, keyword, similarities, relevant, bestCoverage, hitAt } = measure(
    index,
    query,
    options,
  );

  // Copies are left out before the candidates are taken, so they take none of their places.
  const copies = opts.collapseCopies === false ? undefined : copiesByIndex.get(index);
  const ranked = copies ? keyword.ranked.filter((i) => copies[i] !== 1) : keyword.ranked;
  const keywordList = ranked.slice(0, opts.candidates).filter(relevant);
  const lists: number[][] = [keywordList];
  let bestSimilarity: number | null = null;
  if (similarities) {
    const order = topIndices(similarities, opts.candidates, copies);
    bestSimilarity = order.length > 0 ? (similarities[order[0] ?? 0] ?? 0) : 0;
    lists.push(order.filter(relevant));
  }

  const hits = reciprocalRankFusion(lists, opts.rrfK)
    .slice(0, opts.topK)
    .flatMap(({ item, score }) => hitAt(item, score) ?? []);

  return {
    hits,
    answerable: hits.length > 0,
    mode: similarities ? 'hybrid' : 'keyword',
    best: { similarity: bestSimilarity, keywordCoverage: bestCoverage },
  };
}

/** Each loaded index's chunk positions, by chunk id. */
const positions = new WeakMap<LoadedIndex, Map<string, number>>();

/**
 * The relevance gate, applied to hits that came from anywhere: a reranker, a retriever of your
 * own. Each hit's chunk is looked up in the index by its id and its signals are measured again for
 * the query, so a hit counts only if its chunk clears `minSimilarity` or `minKeywordCoverage`,
 * whatever the hit says. Hits whose chunk is not in the index, and repeats, are dropped; the rest
 * keep their order and scores, up to `topK`. `createAskHandler` applies it after its retrieval
 * hooks.
 */
export function gateHits(
  index: LoadedIndex,
  query: { text: string; vector?: ArrayLike<number> | null },
  hits: readonly RetrievalHit[],
  options: RetrievalOptions = {},
): RetrievalResult {
  const { opts, similarities, relevant, bestCoverage, hitAt } = measure(index, query, options);
  let byId = positions.get(index);
  if (!byId) {
    byId = new Map(index.chunks.map((chunk, i) => [chunk.id, i]));
    positions.set(index, byId);
  }
  const seen = new Set<number>();
  const gated: RetrievalHit[] = [];
  for (const hit of hits) {
    const i = byId.get(hit.chunk.id);
    if (i === undefined || seen.has(i) || !relevant(i)) continue;
    seen.add(i);
    const measured = hitAt(i, hit.score);
    if (measured) gated.push(measured);
    if (gated.length >= opts.topK) break;
  }
  let bestSimilarity: number | null = null;
  if (similarities) {
    // As `retrieve` reports it: the closest chunk's similarity, which can be below zero.
    bestSimilarity = similarities.length > 0 ? -Infinity : 0;
    for (const similarity of similarities) bestSimilarity = Math.max(bestSimilarity, similarity);
  }
  return {
    hits: gated,
    answerable: gated.length > 0,
    mode: similarities ? 'hybrid' : 'keyword',
    best: { similarity: bestSimilarity, keywordCoverage: bestCoverage },
  };
}

/** Indices of the `k` largest values, largest first, without those `skip` marks 1. */
function topIndices(values: Float32Array, k: number, skip?: Uint8Array): number[] {
  if (k <= 0) return [];
  const top: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    if (skip?.[i] === 1) continue;
    const value = values[i] ?? 0;
    if (top.length === k && value <= (values[top[k - 1] ?? 0] ?? 0)) continue;
    let position = top.length < k ? top.length : k - 1;
    while (position > 0 && (values[top[position - 1] ?? 0] ?? 0) < value) position -= 1;
    top.splice(position, 0, i);
    if (top.length > k) top.pop();
  }
  return top;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
