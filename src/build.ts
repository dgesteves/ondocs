import { embedMany, type EmbeddingModel } from 'ai';

import { CHUNKER_VERSION, chunkDocument, chunkSearchText, resolveChunking } from './chunk';
import { sha256 } from './hash';
import { INDEX_FORMAT, type AskIndexFile, type IndexChunk } from './index-file';
import { encodeVector } from './quantize';
import type { Chunk, ChunkingOptions, SourceDocument } from './types';

/** Provider-specific embedding options, e.g. `{ openai: { dimensions: 512 } }`. */
export type EmbeddingProviderOptions = NonNullable<
  Parameters<typeof embedMany>[0]['providerOptions']
>;

export interface BuildIndexOptions {
  documents: readonly SourceDocument[];
  /**
   * Any AI SDK embedding model, e.g. `openai.embedding('text-embedding-3-small')`, or a gateway
   * model id string. Omit it (or pass `null`) for a keyword-only index.
   */
  embeddingModel?: EmbeddingModel | null;
  /** Passed to `embedMany`. Use the same value at query time. */
  embeddingProviderOptions?: EmbeddingProviderOptions;
  chunking?: ChunkingOptions;
  /**
   * The index this build replaces. Chunks whose embedded text is unchanged reuse its vectors,
   * so an edit to one page re-embeds a handful of chunks, not the whole site.
   */
  previous?: AskIndexFile | null;
  /** Embedding requests in flight at once. Default 4. */
  maxParallelCalls?: number;
  abortSignal?: AbortSignal;
  /** Called after each embedding batch. */
  onProgress?: (progress: { embedded: number; total: number }) => void;
}

export interface BuildIndexResult {
  index: AskIndexFile;
  stats: {
    documents: number;
    chunks: number;
    /** Chunks sent to the embedding model in this build. */
    embedded: number;
    /** Chunks whose vectors were carried over from `previous`. */
    reused: number;
  };
}

const EMBED_BATCH = 256;

/** The model id an index records and a query embedding is checked against. */
export function embeddingModelId(model: EmbeddingModel): string {
  return typeof model === 'string' ? model : model.modelId;
}

/**
 * Compares model ids. A gateway id (`openai/text-embedding-3-small`) matches the provider's bare
 * id (`text-embedding-3-small`), but two ids that both name a provider must match exactly, so
 * `orgA/bge-base` and `orgB/bge-base` are different models.
 */
export function sameEmbeddingModel(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes('/') && b.includes('/')) return false;
  const bare = (id: string): string => id.slice(id.lastIndexOf('/') + 1);
  return bare(a) === bare(b);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/**
 * A short fingerprint of embedding provider options, recorded in the index. Options such as
 * `{ openai: { dimensions: 512 } }` change the vectors a model returns, so vectors are only reused
 * when the fingerprint matches. `undefined` when there are no options.
 */
export async function embeddingSettingsKey(
  options: EmbeddingProviderOptions | undefined,
): Promise<string | undefined> {
  if (!options || Object.keys(options).length === 0) return undefined;
  return (await sha256(stableStringify(options))).slice(0, 16);
}

/**
 * Whether a document URL is safe to cite: a relative reference (`/docs/a`, `a/b`) or an http(s)
 * URL. `javascript:`, `data:` and any other scheme are not, nor is anything a browser could read
 * as another host (`//evil.example`, backslashes) or a scheme (a colon before the first `/`), nor
 * control characters. The dialog drops such links too; this keeps them out of the index, so a
 * frontmatter `url` cannot put one in front of visitors. Nor is a path with a `.` or `..`
 * segment, as written or percent-encoded (`/%2e%2e/`): a page's `.md` copy is written at its
 * URL's path, which would lead out of the folder, as `url: /../../AGENTS` to `AGENTS.md`.
 */
export function isCitableUrl(url: string): boolean {
  const value = url.trim();
  // eslint-disable-next-line no-control-regex
  if (!value || /[\\\u0000-\u001f\u007f]/.test(value) || value.startsWith('//')) return false;
  if (hasDotSegment(value)) return false;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1];
  if (scheme !== undefined) return /^https?$/i.test(scheme) && URL.canParse(value);
  return !(/^[^/?#]*/.exec(value)?.[0] ?? '').includes(':');
}

/** Whether the path of `url` has a `.` or `..` segment once decoded, as a file is named. */
function hasDotSegment(url: string): boolean {
  let path = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0] ?? '';
  try {
    path = decodeURI(path);
  } catch {
    // Named as written when it does not decode.
  }
  return /(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path);
}

interface PreparedCorpus {
  documents: SourceDocument[];
  chunks: Chunk[];
  chunking: Required<ChunkingOptions>;
  contentHash: string;
}

async function prepare(
  input: readonly SourceDocument[],
  chunkingOptions?: ChunkingOptions,
): Promise<PreparedCorpus> {
  const chunking = resolveChunking(chunkingOptions);
  const seen = new Set<string>();
  for (const document of input) {
    if (seen.has(document.id)) throw new Error(`Duplicate document id "${document.id}".`);
    seen.add(document.id);
    if (!isCitableUrl(document.url)) {
      throw new Error(
        `Document "${document.id}" has the URL ${JSON.stringify(document.url)}, which a citation ` +
          'cannot link to. Use a path, such as /docs/page, or an http(s) URL, with no . or .. ' +
          'segment.',
      );
    }
  }
  const documents = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const chunks = documents.flatMap((document) => chunkDocument(document, chunking));
  const contentHash = await sha256(
    JSON.stringify({
      format: INDEX_FORMAT,
      chunker: CHUNKER_VERSION,
      chunking,
      chunks: chunks.map((c) => [c.id, c.url, c.title, c.heading, c.anchor ?? '', c.text]),
    }),
  );
  return { documents, chunks, chunking, contentHash };
}

/**
 * Chunks documents, embeds the chunks and returns a serializable index.
 *
 * Deterministic for a given input and model: documents are sorted by id and no timestamps are
 * written, so rebuilding unchanged content produces the same file.
 */
export async function buildIndex(options: BuildIndexOptions): Promise<BuildIndexResult> {
  const { documents, chunks, chunking, contentHash } = await prepare(
    options.documents,
    options.chunking,
  );
  const docIndex = new Map(documents.map((d, i) => [d.id, i]));
  const searchTexts = chunks.map(chunkSearchText);
  const hashes = await Promise.all(searchTexts.map(async (t) => (await sha256(t)).slice(0, 16)));

  const model = options.embeddingModel ?? null;
  const settings = await embeddingSettingsKey(options.embeddingProviderOptions);
  const vectors: (string | undefined)[] = Array.from({ length: chunks.length });
  let dimensions: number | null = null;
  let embedded = 0;
  let reused = 0;

  if (model !== null) {
    const modelId = embeddingModelId(model);
    const previous = options.previous;
    const reusable = new Map<string, string>();
    const compatible =
      previous?.embedding &&
      sameEmbeddingModel(previous.embedding.model, modelId) &&
      previous.embedding.settings === settings;
    if (compatible) {
      for (const chunk of previous.chunks) if (chunk.vector) reusable.set(chunk.hash, chunk.vector);
      dimensions = previous.embedding?.dimensions ?? null;
    }

    const missing: number[] = [];
    hashes.forEach((hash, i) => {
      const vector = reusable.get(hash);
      if (vector === undefined) missing.push(i);
      else vectors[i] = vector;
    });
    reused = chunks.length - missing.length;

    for (let start = 0; start < missing.length; start += EMBED_BATCH) {
      const batch = missing.slice(start, start + EMBED_BATCH);
      const { embeddings } = await embedMany({
        model,
        values: batch.map((i) => searchTexts[i] ?? ''),
        maxParallelCalls: options.maxParallelCalls ?? 4,
        ...(options.embeddingProviderOptions
          ? { providerOptions: options.embeddingProviderOptions }
          : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      });
      batch.forEach((chunkIndex, j) => {
        const embedding = embeddings[j];
        if (!embedding)
          throw new Error(`Embedding model returned no vector for chunk ${String(chunkIndex)}.`);
        dimensions ??= embedding.length;
        if (embedding.length !== dimensions) {
          throw new Error(
            `Embedding model returned ${String(embedding.length)} dimensions, expected ` +
              `${String(dimensions)}. If you changed dimensions, delete the old index and rebuild.`,
          );
        }
        vectors[chunkIndex] = encodeVector(embedding);
      });
      embedded += batch.length;
      options.onProgress?.({ embedded, total: missing.length });
    }
    // An empty corpus still records which model it was built for.
    if (compatible) dimensions ??= previous.embedding?.dimensions ?? null;
  }

  const indexChunks: IndexChunk[] = chunks.map((chunk, i) => ({
    id: chunk.id,
    doc: docIndex.get(chunk.documentId) ?? 0,
    heading: chunk.heading,
    ...(chunk.anchor ? { anchor: chunk.anchor } : {}),
    text: chunk.text,
    hash: hashes[i] ?? '',
    ...(vectors[i] ? { vector: vectors[i] } : {}),
  }));

  return {
    index: {
      format: INDEX_FORMAT,
      contentHash,
      chunking,
      embedding:
        model !== null && dimensions !== null
          ? { model: embeddingModelId(model), dimensions, ...(settings ? { settings } : {}) }
          : null,
      documents: documents.map(({ id, url, title }) => ({ id, url, title })),
      chunks: indexChunks,
    },
    stats: { documents: documents.length, chunks: chunks.length, embedded, reused },
  };
}

export interface CheckIndexOptions {
  documents: readonly SourceDocument[];
  index: AskIndexFile;
  chunking?: ChunkingOptions;
  /**
   * When given, the check also fails if the index was built with a different model. A model id
   * string is enough: nothing is called. `null` expects a keyword-only index.
   */
  embeddingModel?: EmbeddingModel | null;
  /** When given, the check also fails if the index vectors have a different size. */
  embeddingDimensions?: number;
  /** When given, the check also fails if the index was embedded with different provider options. */
  embeddingProviderOptions?: EmbeddingProviderOptions;
}

export interface CheckIndexResult {
  upToDate: boolean;
  /** Human-readable reasons, empty when up to date. */
  problems: string[];
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * Compares documents against an existing index without calling any model.
 *
 * Re-chunks the documents, recomputes the content hash and compares. When the hash differs, it
 * lists which chunks were added, removed or changed, so a CI failure says what to look at.
 */
export async function checkIndex(options: CheckIndexOptions): Promise<CheckIndexResult> {
  const { index } = options;
  const { chunks, contentHash } = await prepare(options.documents, options.chunking);
  const problems: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  if (contentHash !== index.contentHash) {
    const before = new Map(index.chunks.map((c) => [c.id, c]));
    const after = new Set<string>();
    for (const chunk of chunks) {
      after.add(chunk.id);
      const old = before.get(chunk.id);
      const oldDoc = old ? index.documents[old.doc] : undefined;
      if (!old) added.push(chunk.id);
      else if (
        old.text !== chunk.text ||
        old.heading !== chunk.heading ||
        (old.anchor ?? '') !== (chunk.anchor ?? '') ||
        oldDoc?.url !== chunk.url ||
        oldDoc.title !== chunk.title
      ) {
        changed.push(chunk.id);
      }
    }
    for (const id of before.keys()) if (!after.has(id)) removed.push(id);
    problems.push(
      added.length + removed.length + changed.length > 0
        ? `Content changed: ${String(added.length)} added, ${String(changed.length)} changed, ` +
            `${String(removed.length)} removed chunks.`
        : 'Chunking options or format changed.',
    );
  }

  const model = options.embeddingModel;
  if (model) {
    const expected = embeddingModelId(model);
    if (!index.embedding) problems.push(`Index has no embeddings; expected model "${expected}".`);
    else if (!sameEmbeddingModel(index.embedding.model, expected)) {
      problems.push(`Index was embedded with "${index.embedding.model}", expected "${expected}".`);
    }
  } else if (model === null && index.embedding) {
    problems.push(`Index has embeddings from "${index.embedding.model}"; expected keyword-only.`);
  }
  if (options.embeddingProviderOptions !== undefined && index.embedding) {
    const expected = await embeddingSettingsKey(options.embeddingProviderOptions);
    if (index.embedding.settings !== expected) {
      problems.push('Index was embedded with different provider options (e.g. dimensions).');
    }
  }
  const dimensions = options.embeddingDimensions;
  if (dimensions && index.embedding && index.embedding.dimensions !== dimensions) {
    problems.push(
      `Index vectors have ${String(index.embedding.dimensions)} dimensions, expected ${String(dimensions)}.`,
    );
  }

  return { upToDate: problems.length === 0, problems, added, removed, changed };
}
