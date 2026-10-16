/**
 * ondocs/server: the ask endpoint and the MCP endpoint, as Web-standard request handlers.
 */

export { createOndocs } from './ondocs';
export type { OndocsHandlers, OndocsOptions } from './ondocs';
export type { AllowedOrigins } from './shared';
export { createAskHandler } from './handler';
export type {
  AskFeedbackEvent,
  AskFinishEvent,
  AskHandlerOptions,
  GenerationOptions,
  IndexSource,
} from './handler';
export type { FollowUpOptions } from './follow-up';
export { turnstile } from './challenge';
export type { ChallengeResult, ChallengeVerifier, TurnstileOptions } from './challenge';
export type {
  AskRetrievalOptions,
  RetrievalHookContext,
  RetrievalHooks,
  RetrievalQuery,
} from './retrieval';
export { createMcpHandler, MCP_PROTOCOL_VERSIONS } from './mcp';
export type { McpHandlerOptions, McpToolCallEvent } from './mcp';
export type { McpSearchResult } from './mcp-tools';
export { memoryBudgetStore, upstashBudgetStore } from './budget';
export type {
  BudgetOptions,
  BudgetStore,
  MemoryBudgetStoreOptions,
  UpstashRedisCounterLike,
} from './budget';
export { memoryAnswerCache, normalizeQuestion, upstashAnswerCache } from './cache';
export type {
  AnswerCacheOptions,
  AnswerCacheStore,
  CachedAnswer,
  MemoryAnswerCacheOptions,
  UpstashRedisCacheLike,
} from './cache';
export { buildSources, defaultInstructions, formatPrompt } from './prompt';
export { remoteIndex } from './remote-index';
export type { RemoteIndex, RemoteIndexOptions } from './remote-index';
export type { PromptSource } from './prompt';
export { clientKey, memoryRateLimit, upstashRateLimit } from './rate-limit';
export type {
  ClientKeyOptions,
  MemoryRateLimitOptions,
  RateLimiter,
  RateLimitResult,
  UpstashRateLimitOptions,
  UpstashRatelimitLike,
} from './rate-limit';
export { SOURCE_METADATA_KEY } from '../protocol';
export type {
  AskErrorBody,
  AskFeedbackBody,
  AskMetadata,
  AskRequestBody,
  AskSource,
} from '../protocol';
