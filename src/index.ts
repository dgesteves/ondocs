/**
 * ondocs core. Runtime-neutral: no Node built-ins, safe to import from edge functions,
 * workers and browsers.
 *
 * - Loaders turn Markdown/MDX, HTML or plain records into `SourceDocument`s.
 * - `buildIndex` chunks, embeds and quantizes them into a static `AskIndexFile`.
 * - `loadIndex` + `retrieve` run hybrid search over that file in memory.
 *
 * File-system helpers live in `ondocs/node`, the HTTP handler in `ondocs/server`, the
 * UI in `ondocs/react`.
 */

export type { Chunk, ChunkingOptions, SourceDocument } from './types';

export { fromMarkdown, parseFrontmatter } from './loaders/markdown';
export type { Frontmatter, MarkdownMeta } from './loaders/markdown';
export { decodeEntities, fromHtml } from './loaders/html';
export type { HtmlMeta } from './loaders/html';
export { fromDocuments } from './loaders/documents';

export { CHUNKER_VERSION, DEFAULT_CHUNKING, chunkDocument, chunkSearchText } from './chunk';
export { createSlugger, slugify } from './text/slug';
export { tokenize } from './text/tokenize';

export {
  buildIndex,
  checkIndex,
  embeddingModelId,
  embeddingSettingsKey,
  sameEmbeddingModel,
} from './build';
export type {
  BuildIndexOptions,
  BuildIndexResult,
  CheckIndexOptions,
  CheckIndexResult,
  EmbeddingProviderOptions,
} from './build';

export {
  AskIndexError,
  INDEX_FORMAT,
  parseIndexFile,
  serializeIndexFile,
  validateIndexFile,
} from './index-file';
export type { AskIndexFile, IndexChunk, IndexDocument, IndexEmbedding } from './index-file';

export {
  cosineSimilarity,
  decodeBase64,
  decodeVector,
  encodeBase64,
  encodeVector,
  quantizeInt8,
} from './quantize';

export { Bm25Index } from './search/bm25';
export type { Bm25Options, Bm25Result } from './search/bm25';
export { VectorIndex } from './search/vectors';
export { reciprocalRankFusion } from './search/rrf';
export type { FusedResult } from './search/rrf';
export {
  DEFAULT_RETRIEVAL,
  defaultMinSimilarity,
  gateHits,
  loadIndex,
  retrieve,
} from './search/retrieve';
export { buildLlmsFiles, markdownPath } from './llms';
export type { LlmsFile, LlmsOutputs, LlmsPage, LlmsSite } from './llms';
export { mcpInstallLinks, mcpServerName } from './mcp-install';
export type { McpInstallLinks, McpInstallOptions } from './mcp-install';
export type {
  LoadedIndex,
  RetrievalHit,
  RetrievalOptions,
  RetrievalResult,
  RetrievedChunk,
} from './search/retrieve';
