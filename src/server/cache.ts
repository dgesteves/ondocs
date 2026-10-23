/**
 * An answer cache: a question asked again, about the same index, is answered from the store
 * without embedding it or calling the model. Pluggable like the rate limiter: memory built in,
 * Upstash through a zero-dependency adapter.
 */
import { z } from 'zod';

import type { AskSource } from '../protocol';

/** What the cache keeps for one question: everything needed to stream the answer again. */
export interface CachedAnswer {
  answer: string;
  sources: AskSource[];
  refused: boolean;
  retrieval: 'hybrid' | 'keyword';
  /** The best retrieval signals the original answer saw, for `onFinish`. */
  best: { similarity: number | null; keywordCoverage: number };
}

export interface AnswerCacheStore {
  get(key: string): unknown;
  set(key: string, value: CachedAnswer, ttlSeconds: number): unknown;
}

export interface AnswerCacheOptions {
  /**
   * Where answers are kept. Default {@link memoryAnswerCache}, per instance; use
   * {@link upstashAnswerCache} for one cache shared by every instance.
   */
  store?: AnswerCacheStore;
  /** How long an answer is kept, in seconds. Default 86 400 (a day). */
  ttlSeconds?: number;
  /**
   * Prepended to the store's keys. Default `"ask-my-site:answer:"`, the name from before ondocs,
   * so a shared cache keeps its answers across the upgrade.
   */
  prefix?: string;
}

/** What the end of a question may have that the cache ignores, once whitespace is one space. */
const TRAILING = ' ?!.。？！';

/**
 * The form of a question the cache compares: Unicode-normalized, lowercased, with runs of
 * whitespace collapsed and trailing punctuation dropped, so "How do I install it?" and
 * "how do i install it" share an answer.
 */
export function normalizeQuestion(question: string): string {
  const text = question.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  // Trimmed in a loop: `/[\s?!.。？！]+$/` started a match at each character of a long run of
  // them that does not end the question, and each failed at the run's end.
  let end = text.length;
  while (end > 0 && TRAILING.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end).trim();
}

const cachedAnswerSchema = z.object({
  answer: z.string(),
  sources: z.array(
    z.object({ id: z.number(), url: z.string(), title: z.string(), heading: z.string() }),
  ),
  refused: z.boolean(),
  retrieval: z.enum(['hybrid', 'keyword']),
  best: z.object({ similarity: z.number().nullable(), keywordCoverage: z.number() }),
});

/** A stored value, or `null` when it is missing or not a cached answer (corrupt, or foreign). */
export function parseCachedAnswer(value: unknown): CachedAnswer | null {
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = cachedAnswerSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export interface MemoryAnswerCacheOptions {
  /** Answers kept before the least recently used is evicted. Default 1 000. */
  maxEntries?: number;
  /** Clock, for tests. */
  now?: () => number;
}

/** Answers in the memory of one process or isolate, least recently used evicted first. */
export function memoryAnswerCache(options: MemoryAnswerCacheOptions = {}): AnswerCacheStore {
  const maxEntries = options.maxEntries ?? 1000;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError(
      `memoryAnswerCache: maxEntries must be a positive integer (got ${String(maxEntries)}).`,
    );
  }
  const entries = new Map<string, { value: CachedAnswer; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      if (entry.expiresAt <= now()) return null;
      // Re-inserting keeps the map in least-recently-used order.
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, ttlSeconds) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}

/** The part of `@upstash/redis`'s `Redis` that {@link upstashAnswerCache} uses. */
export interface UpstashRedisCacheLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
}

/**
 * An answer cache in Redis through `@upstash/redis`, shared by every instance of your app.
 * ondocs does not depend on Upstash; you pass in the client you configured.
 *
 * ```ts
 * answerCache: { store: upstashAnswerCache(Redis.fromEnv()) }
 * ```
 */
export function upstashAnswerCache(redis: UpstashRedisCacheLike): AnswerCacheStore {
  return {
    // `@upstash/redis` parses JSON values itself; other clients return the string.
    get: (key) => redis.get(key),
    set: (key, value, ttlSeconds) => redis.set(key, JSON.stringify(value), { ex: ttlSeconds }),
  };
}
