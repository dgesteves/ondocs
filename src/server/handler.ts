import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  streamText,
  toUIMessageStream,
  type EmbeddingModel,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import { z } from 'zod';

import type { EmbeddingProviderOptions } from '../build';
import { warnDeprecated } from '../deprecation';
import { sha256 } from '../hash';
import {
  SOURCE_METADATA_KEY,
  type AskErrorBody,
  type AskMetadata,
  type AskSource,
} from '../protocol';
import type { LoadedIndex, RetrievalResult } from '../search/retrieve';
import { createBudget, type BudgetOptions } from './budget';
import type { ChallengeVerifier } from './challenge';
import { retrieveWithHooks, type AskRetrievalOptions } from './retrieval';
import {
  memoryAnswerCache,
  normalizeQuestion,
  parseCachedAnswer,
  type AnswerCacheOptions,
  type CachedAnswer,
} from './cache';
import {
  FOLLOW_UP_INSTRUCTIONS,
  FOLLOW_UP_MAX_TOKENS,
  FOLLOW_UP_TIMEOUT_MS,
  followUpPrompt,
  looksStandalone,
  standaloneQuestion,
  type ConversationTurn,
  type FollowUpOptions,
} from './follow-up';
import { buildSources, defaultInstructions, formatPrompt } from './prompt';
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

type StreamTextOptions = Parameters<typeof streamText>[0];

/** Model settings passed through to `streamText`. */
export type GenerationOptions = Pick<
  StreamTextOptions,
  | 'maxOutputTokens'
  | 'temperature'
  | 'topP'
  | 'seed'
  | 'providerOptions'
  | 'maxRetries'
  | 'timeout'
  | 'headers'
  | 'telemetry'
>;

export type { IndexSource } from './shared';

export interface AskHandlerOptions {
  /**
   * The index: `import index from './ask-index.json'`, its JSON text, the result of `loadIndex`,
   * or a (possibly async) function returning any of those, called once on the first request.
   */
  index: IndexSource | (() => IndexSource | Promise<IndexSource>);
  /**
   * The index of each other locale, by the locale the dialog sends (`fr`, `pt-br`): the plugins
   * build one per locale, and send the page's with each question. A question from a locale with
   * no index here is answered from `index`.
   */
  indexes?: Record<string, IndexSource | (() => IndexSource | Promise<IndexSource>)>;
  /** Any AI SDK language model, e.g. `openai('gpt-5.4-mini')`, or a gateway model id. */
  model: LanguageModel;
  /**
   * The model the index was embedded with. Without it, retrieval is keyword-only. If embedding a
   * query fails at runtime, that request falls back to keywords instead of failing.
   */
  embeddingModel?: EmbeddingModel;
  /**
   * Passed to the embedding model with each question; must match what the index was built with.
   * For OpenAI's `text-embedding-3` models (directly or through AI Gateway), the vector size comes
   * from the index, so only other options, or another provider's size option (such as Google's
   * `outputDimensionality`), need setting here.
   */
  embeddingProviderOptions?: EmbeddingProviderOptions;
  /** Used in the default instructions and the "I don't know" message. Default `"this site"`. */
  siteName?: string;
  /** Replace the system instructions, or extend the defaults: `(defaults) => defaults + '…'`. */
  instructions?: string | ((defaults: string) => string);
  /**
   * How retrieval runs: `topK`, `candidates`, the relevance gate's thresholds and
   * `maxContextChars`, and two hooks. `rerank` puts the candidates in a new order (with the AI
   * SDK's `rerank()`, or to boost sections), and `retrieve` finds them instead of the built-in
   * retrieval, or around it. The relevance gate checks what the hooks return, so they cannot make
   * an off-topic chunk count.
   */
  retrieval?: AskRetrievalOptions;
  /**
   * @deprecated Use `retrieval.maxContextChars`, next to `topK`. `maxContextChars` still works,
   * with a warning, until 1.0.
   */
  maxContextChars?: number;
  /** Longest accepted question, in characters. Default 500. */
  maxQuestionLength?: number;
  /**
   * Largest accepted request body, in bytes, enforced while reading. Default 64 KiB, which fits
   * the conversation history `useChat` sends for many turns.
   */
  maxBodyBytes?: number;
  /** Answer used when retrieval finds nothing relevant. The model is not called. */
  noAnswerMessage?: string;
  /**
   * Limits how often one client may ask, before any work is done. Default `memoryRateLimit()`:
   * 10 questions a minute per client IP, read from the last `X-Forwarded-For` entry (which Vercel
   * sets), counted per server instance. Pass your own limiter, such as
   * `memoryRateLimit({ trustedHeader: 'cf-connecting-ip' })` on Cloudflare or `upstashRateLimit`
   * for a limit shared by every instance, or `false` when something in front of the endpoint
   * already limits it. Requests that carry no `X-Forwarded-For` share one bucket under the default
   * limiter, and the first one is reported to `onError`.
   */
  rateLimit?: RateLimiter | false;
  /**
   * What to do when `rateLimit` throws or rejects, e.g. because Redis is unreachable. `"closed"`
   * (the default) answers 503 without calling the model; `"open"` answers as if the request were
   * allowed. Either way the error goes to `onError`. The `budget` store's failures are handled
   * the same way.
   */
  rateLimitFailure?: 'closed' | 'open';
  /**
   * A bot check on every question: `turnstile({ secretKey })` checks the Cloudflare Turnstile
   * token the dialog sends with each question (its `challenge: { turnstile: '<site key>' }`
   * option) before anything is spent on it. A question without a token gets a 403 with code
   * `challenge_required`, and one with a bad or used token a 403 with `challenge_failed`. When the
   * check cannot be made (Turnstile is down), the request is handled as `rateLimitFailure` says:
   * a 503 by default. Feedback posts are not checked. Off by default.
   */
  challenge?: ChallengeVerifier;
  /**
   * Passed to `streamText`. `maxOutputTokens` defaults to 800, and `timeout` to 30 seconds for
   * the model's first word and 90 for the whole answer, so a provider that stalls ends the answer
   * instead of holding it open; your own `timeout` replaces both.
   */
  generation?: GenerationOptions;
  /**
   * A daily cap on spend: `{ requestsPerDay, tokensPerDay }`, counted in `store` (memory, per
   * instance, by default). Once it is spent, questions get a 429 with code `budget_exceeded`
   * until the next UTC day, without a model call.
   */
  budget?: BudgetOptions;
  /**
   * Answers a question asked again from a cache, without embedding it or calling the model:
   * `true` for the memory store, or `{ store, ttlSeconds }`. Keyed by the index's content hash
   * and the normalized question, so a rebuilt index starts fresh.
   */
  answerCache?: boolean | AnswerCacheOptions;
  /** Extra headers on every response, e.g. for CORS. */
  headers?: Record<string, string>;
  /**
   * Follow-up questions. A request with the conversation (`{ messages }`, as the dialog and
   * `useChat` send it) whose last question does not stand on its own ("and on Netlify?") has it
   * rewritten into one that does, with one short call to `model` (or `followUps.model`), before
   * retrieval; a question that already stands on its own is not rewritten. The rewrite counts
   * against `budget`. `false` answers every question on its own, as before.
   */
  followUps?: false | FollowUpOptions;
  /** Called once per answered request, after the answer is complete. */
  onFinish?: (event: AskFinishEvent) => void | Promise<void>;
  /**
   * Called with a visitor's rating of an answer, posted to this endpoint as `{ feedback }`. With
   * it, the stream tells the dialog to offer thumbs up and down, and a comment; without it, the
   * dialog offers nothing and a posted rating gets a 400. Nothing is stored or sent anywhere but
   * here: log it, or send it on, as you choose. A comment arrives as a second call with the same
   * `id`. If it throws, the visitor is told the feedback could not be sent.
   */
  onFeedback?: (event: AskFeedbackEvent) => void | Promise<void>;
  /** Called with errors that were handled (embedding fallback, model errors). Default `console.error`. */
  onError?: (error: unknown) => void;
}

export interface AskFinishEvent {
  /** The answer's id, the stream's `messageId`; feedback on the answer carries it. */
  id: string;
  question: string;
  answer: string;
  sources: AskSource[];
  refused: boolean;
  /**
   * For an answer from `answerCache`, `hits` is empty (nothing was retrieved) and `best` is what
   * the original answer saw.
   */
  retrieval: RetrievalResult;
  usage?: LanguageModelUsage;
  /** True when the answer came from `answerCache`, so no model was called. */
  cached: boolean;
  /**
   * True when the model answered but cited none of its sources: it said the sources do not cover
   * the question, or it answered without them. With `refused`, the questions the docs do not
   * answer well: the content gaps to look at. A reply of only "I don't know" is one of these,
   * though the dialog shows it as a refusal.
   */
  lowConfidence: boolean;
  /**
   * For a follow-up that was rewritten: the standalone question retrieval and the answer used,
   * and the rewrite's token usage. `question` is the question as the visitor asked it.
   */
  followUp?: { question: string; usage?: LanguageModelUsage };
}

/** A visitor's rating of an answer, as `onFeedback` gets it. */
export interface AskFeedbackEvent {
  rating: 'up' | 'down';
  comment?: string;
  /** The answer's id, as `onFinish` got it, when the client sent it. */
  id?: string;
  /** The question and answer as the visitor's browser has them, not as the server kept them. */
  question: string;
  answer: string;
  sources: string[];
}

const MODEL_ERROR_MESSAGE = 'The answer could not be generated. Please try again.';

const feedbackSchema = z.object({
  feedback: z.object({
    rating: z.enum(['up', 'down']),
    comment: z.string().max(1000).optional(),
    id: z.string().max(200).optional(),
    question: z.string().min(1).max(2000),
    answer: z.string().max(10_000),
    sources: z.array(z.string().max(2000)).max(20).optional(),
  }),
});

/** Whether an answer cites one of the sources it was given, as `[n]`. */
function citesSources(text: string, sources: readonly AskSource[]): boolean {
  const ids = new Set(sources.map((source) => source.id));
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    if ((match[1] ?? '').split(',').some((id) => ids.has(Number(id.trim())))) return true;
  }
  return false;
}

/**
 * Whether the model's reply is only "I don't know", as the instructions ask for when the sources
 * do not answer: a refusal the model wrote, which the response marks as one.
 */
function saysOnlyIDontKnow(text: string): boolean {
  return /^i (?:do not|don['’]t) know[.!]?$/i.test(text.trim().replace(/\s+/g, ' '));
}

/** A locale as the dialog sends it: `fr`, `pt-br`, `zh-Hans`. Only the keys of `indexes` are used. */
const localeSchema = z.string().max(35).optional();

/** The bot check's token, from the dialog. Turnstile's are at most 2,048 characters. */
const challengeSchema = z.string().max(4096).optional();

const requestSchema = z.union([
  z.object({ question: z.string(), locale: localeSchema, challenge: challengeSchema }),
  // `useChat` from @ai-sdk/react posts the conversation; the latest user message is the question.
  z.object({
    messages: z
      .array(
        z.object({
          role: z.string(),
          content: z.string().optional(),
          parts: z
            .array(z.looseObject({ type: z.string(), text: z.unknown().optional() }))
            .optional(),
        }),
      )
      .min(1),
    locale: localeSchema,
    challenge: challengeSchema,
  }),
]);

/** The text of a message, from its text parts or its `content`. */
function messageText(message: {
  content?: string | undefined;
  parts?: { type: string; text?: unknown }[] | undefined;
}): string {
  const fromParts = (message.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n');
  return (fromParts || message.content || '').trim();
}

/** The question, and the conversation before it: the messages before the last user message. */
function conversationFrom(body: z.infer<typeof requestSchema>): {
  question: string;
  history: ConversationTurn[];
} {
  if ('question' in body) return { question: body.question.trim(), history: [] };
  const last = body.messages.findLastIndex((message) => message.role === 'user');
  if (last === -1) return { question: '', history: [] };
  const history = body.messages
    .slice(0, last)
    .filter(
      (message): message is typeof message & { role: 'user' | 'assistant' } =>
        message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({ role: message.role, text: messageText(message) }))
    .filter((turn) => turn.text);
  const lastMessage = body.messages[last];
  return { question: lastMessage ? messageText(lastMessage) : '', history };
}

/** Input plus output tokens, when the usage says. */
function totalTokens(usage: LanguageModelUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const { totalTokens: total, inputTokens, outputTokens } = usage;
  return (
    total ??
    (inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) + (outputTokens ?? 0))
  );
}

/**
 * Creates the ask endpoint: a Web-standard `(request: Request) => Promise<Response>`.
 *
 * Mount it anywhere that speaks `Request`/`Response`: a Next.js route handler
 * (`export const POST = createAskHandler(…)`), Hono, an edge function, `Bun.serve`, Deno.
 *
 * Per request: validate → rate-limit → embed the question → hybrid retrieval → if nothing is
 * relevant, stream the "I don't know" message without calling the model; otherwise stream a
 * grounded, cited answer as an AI SDK UI message stream.
 */
export function createAskHandler(
  options: AskHandlerOptions,
): (request: Request) => Promise<Response> {
  const siteName = options.siteName ?? 'this site';
  const maxQuestionLength = options.maxQuestionLength ?? 500;
  const { maxContextChars: contextChars, ...retrievalSettings } = options.retrieval ?? {};
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- its name before 0.9, still read
  const oldContextChars = options.maxContextChars;
  if (oldContextChars !== undefined) warnDeprecated('maxContextChars', 'retrieval.maxContextChars');
  const maxContextChars = contextChars ?? oldContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const noAnswerMessage =
    options.noAnswerMessage ?? `I don't know. I couldn't find anything about that on ${siteName}.`;
  const instructions =
    typeof options.instructions === 'function'
      ? options.instructions(defaultInstructions(siteName))
      : (options.instructions ?? defaultInstructions(siteName));
  const reportError =
    options.onError ??
    ((error: unknown) => {
      console.error('[ondocs]', error);
    });
  const rateLimit =
    options.rateLimit === undefined
      ? defaultRateLimit(DEFAULT_RATE_LIMIT, 'questions', reportError)
      : options.rateLimit || null;
  const baseHeaders = { 'cache-control': 'no-store', ...options.headers };
  // The answer has already streamed when `onFinish` runs, so its failure (an analytics write,
  // say) is reported, never turned into an error part the visitor sees.
  const finish = async (event: AskFinishEvent): Promise<void> => {
    try {
      await options.onFinish?.(event);
    } catch (error) {
      reportError(error);
    }
  };

  const getIndex = indexLoader(options.index, options.embeddingModel);
  const localeIndexes = new Map(
    Object.entries(options.indexes ?? {}).map(([locale, source]) => [
      locale,
      indexLoader(source, options.embeddingModel),
    ]),
  );

  const json = (status: number, body: AskErrorBody, headers?: Record<string, string>): Response =>
    Response.json(body, { status, headers: { ...baseHeaders, ...headers } });

  const followUps =
    options.followUps === false
      ? null
      : {
          model: options.followUps?.model ?? options.model,
          always: options.followUps?.always ?? false,
          maxTurns: options.followUps?.maxTurns ?? 3,
          instructions: options.followUps?.instructions ?? FOLLOW_UP_INSTRUCTIONS,
        };
  if (followUps && (!Number.isInteger(followUps.maxTurns) || followUps.maxTurns < 1)) {
    throw new RangeError(
      `followUps.maxTurns must be a positive integer (got ${String(followUps.maxTurns)}).`,
    );
  }

  const maxOutputTokens = options.generation?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const budget = options.budget ? createBudget(options.budget) : null;
  const cache = options.answerCache
    ? answerCache(options.answerCache, options, instructions, {
        // `retrieval` and `maxContextChars` as before 0.9 named them, so moving `maxContextChars`
        // into `retrieval` keeps the cache's keys.
        retrieval:
          options.retrieval === undefined ||
          (contextChars !== undefined && Object.keys(retrievalSettings).length === 0)
            ? null
            : retrievalSettings,
        maxContextChars: contextChars ?? oldContextChars ?? null,
      })
    : null;
  const unavailable = (): Response =>
    json(503, {
      error: {
        code: 'service_unavailable',
        message: 'The service is unavailable. Try again shortly.',
      },
    });
  /**
   * Runs a budget check: `{ response }` turns the request away, with a 429 once the day's budget
   * is spent or a 503 when the store fails; `{ result }` lets it through (`result` is `null` when
   * the store failed and `rateLimitFailure` is `"open"`).
   */
  const overBudget = async <T extends { allowed: boolean; resetAt?: number }>(
    check: () => Promise<T>,
  ): Promise<{ response: Response } | { result: T | null }> => {
    let result: T;
    try {
      result = await check();
    } catch (error) {
      reportError(error);
      return options.rateLimitFailure === 'open' ? { result: null } : { response: unavailable() };
    }
    if (result.allowed || !budget) return { result };
    const now = options.budget?.now ?? Date.now;
    const seconds = Math.max(1, Math.ceil(((result.resetAt ?? 0) - now()) / 1000));
    return {
      response: json(
        429,
        { error: { code: 'budget_exceeded', message: budget.message } },
        { 'retry-after': String(seconds) },
      ),
    };
  };

  /** A rating posted to the endpoint: handed to `onFeedback`, with nothing kept here. */
  const takeFeedback = async (body: object): Promise<Response> => {
    if (!options.onFeedback) {
      return json(400, {
        error: { code: 'invalid_request', message: 'This endpoint does not take feedback.' },
      });
    }
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'invalid_request',
          message: 'Send { "feedback": { "rating": "up" | "down", "question", "answer" } }.',
        },
      });
    }
    const { rating, comment, id, question, answer, sources } = parsed.data.feedback;
    try {
      await options.onFeedback({
        rating,
        ...(comment?.trim() ? { comment: comment.trim() } : {}),
        ...(id ? { id } : {}),
        question,
        answer,
        sources: sources ?? [],
      });
    } catch (error) {
      reportError(error);
      return unavailable();
    }
    return new Response(null, { status: 204, headers: baseHeaders });
  };

  return async function handleAsk(request: Request): Promise<Response> {
    // CORS preflight: `useAsk` posts JSON, so cross-origin requests are always preflighted.
    // Answer with the configured headers (put the access-control-* ones in `headers`).
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...baseHeaders, allow: 'POST, OPTIONS' },
      });
    }
    if (request.method !== 'POST') {
      return json(
        405,
        { error: { code: 'method_not_allowed', message: 'Use POST.' } },
        { allow: 'POST, OPTIONS' },
      );
    }

    // Browsers send a cross-origin POST without a CORS preflight only if its content type is
    // text/plain, a form encoding or absent. Requiring JSON forces the preflight, which fails
    // unless `headers` allows the origin, so other sites cannot spend your model budget through
    // their visitors' browsers.
    if (!isJson(request.headers.get('content-type'))) {
      return json(415, {
        error: { code: 'unsupported_media_type', message: 'Send the body as application/json.' },
      });
    }

    if (rateLimit) {
      let limit: RateLimitResult;
      try {
        limit = await rateLimit(request);
      } catch (error) {
        // Failing closed by default: the limiter is what stands between the endpoint and an
        // unbounded model bill, and its outage can be provoked (a flood can exhaust a Redis
        // plan's request quota), so an error should not quietly switch it off.
        reportError(error);
        if (options.rateLimitFailure !== 'open') {
          return json(503, {
            error: {
              code: 'service_unavailable',
              message: 'The service is unavailable. Try again shortly.',
            },
          });
        }
        limit = { success: true };
      }
      if (!limit.success) {
        return json(
          429,
          { error: { code: 'rate_limited', message: 'Too many questions. Try again shortly.' } },
          rateLimitHeaders(limit),
        );
      }
    }

    const tooLarge = (): Response =>
      json(413, { error: { code: 'payload_too_large', message: 'Request body too large.' } });
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return tooLarge();
    let raw: string | null;
    try {
      raw = await readBody(request, maxBodyBytes);
    } catch {
      return json(400, { error: { code: 'invalid_json', message: 'Could not read the body.' } });
    }
    if (raw === null) return tooLarge();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: { code: 'invalid_json', message: 'Body must be JSON.' } });
    }
    if (typeof body === 'object' && body !== null && 'feedback' in body) {
      return takeFeedback(body);
    }

    const parsed = requestSchema.safeParse(body);
    const { question, history: conversation } = parsed.success
      ? conversationFrom(parsed.data)
      : { question: '', history: [] };
    if (!question) {
      return json(400, {
        error: { code: 'invalid_request', message: 'Send { "question": string }.' },
      });
    }
    if (question.length > maxQuestionLength) {
      return json(400, {
        error: {
          code: 'invalid_request',
          message: `Questions are limited to ${String(maxQuestionLength)} characters.`,
        },
      });
    }

    // The bot check, before anything is spent on the question: the cache, the embedding, the model.
    if (options.challenge) {
      const token = parsed.success ? parsed.data.challenge : undefined;
      if (!token) {
        return json(403, {
          error: {
            code: 'challenge_required',
            message: 'Send the bot check’s token as `challenge` with the question.',
          },
        });
      }
      let passed: boolean;
      try {
        passed = (await options.challenge(token, request)).success;
      } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
        // As for the rate limiter: failing closed by default, so an outage cannot switch it off.
        reportError(error);
        if (options.rateLimitFailure !== 'open') return unavailable();
        passed = true;
      }
      if (!passed) {
        return json(403, {
          error: {
            code: 'challenge_failed',
            message: 'The bot check failed, or its token was used before. Ask again.',
          },
        });
      }
    }

    // A client that hung up while the index loaded or the question was embedded is not an error
    // worth reporting.
    const misconfigured = (error: unknown): Response => {
      if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
      reportError(error);
      return json(500, {
        error: { code: 'internal_error', message: 'The ask endpoint is misconfigured.' },
      });
    };

    let index: LoadedIndex;
    try {
      const locale = parsed.success ? parsed.data.locale : undefined;
      index = await ((locale ? localeIndexes.get(locale) : undefined) ?? getIndex)();
    } catch (error) {
      return misconfigured(error);
    }

    // A follow-up that does not stand on its own is rewritten first, so everything after it,
    // the cache included, works from the standalone question. That is a model call, so the
    // question counts against the budget before it, not after a cache hit as otherwise.
    const history = followUps ? conversation.slice(-2 * followUps.maxTurns) : [];
    let searched = question;
    let followUp: AskFinishEvent['followUp'];
    let admitted = false;
    if (followUps && history.length > 0 && (followUps.always || !looksStandalone(question))) {
      if (budget) {
        const admission = await overBudget(() => budget.admit());
        if ('response' in admission) return admission.response;
        admitted = true;
      }
      const prompt = followUpPrompt(history, question);
      let settle: ((actual: number | undefined) => Promise<void>) | null = null;
      if (budget) {
        const estimate =
          Math.ceil((followUps.instructions.length + prompt.length) / 3) + FOLLOW_UP_MAX_TOKENS;
        const reserved = await overBudget(() => budget.reserve(estimate));
        if ('response' in reserved) return reserved.response;
        if (reserved.result?.allowed) settle = reserved.result.settle;
      }
      try {
        const result = await generateText({
          model: followUps.model,
          instructions: followUps.instructions,
          prompt,
          maxOutputTokens: FOLLOW_UP_MAX_TOKENS,
          temperature: 0,
          reasoning: 'minimal',
          maxRetries: 1,
          timeout: FOLLOW_UP_TIMEOUT_MS,
          abortSignal: request.signal,
        });
        await settle?.(totalTokens(result.usage)).catch(reportError);
        searched = standaloneQuestion(result.text, question, maxQuestionLength);
        followUp = { question: searched, usage: result.usage };
      } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
        // Answer the question as it was asked rather than fail it. The rewrite reported no usage,
        // so its reservation goes back: a bad key or an outage must not use up the day's budget.
        reportError(error);
        await settle?.(0).catch(reportError);
      }
    }

    const cacheKey = cache ? await cache.key(index, searched) : null;
    if (cache && cacheKey) {
      const hit = await cache.get(cacheKey, reportError);
      if (hit) {
        const id = generateId();
        return respond(hit, id, null, () =>
          finish({
            id,
            lowConfidence: !hit.refused && !citesSources(hit.answer, hit.sources),
            question,
            answer: hit.answer,
            sources: hit.sources,
            refused: hit.refused,
            retrieval: { hits: [], answerable: !hit.refused, mode: hit.retrieval, best: hit.best },
            cached: true,
            ...(followUp ? { followUp } : {}),
          }),
        );
      }
    }

    if (budget && !admitted) {
      const admission = await overBudget(() => budget.admit());
      if ('response' in admission) return admission.response;
    }

    let queryVector: number[] | null;
    try {
      queryVector = await embedQuery(searched, index, options, request.signal, reportError);
    } catch (error) {
      return misconfigured(error);
    }

    const retrieval = await retrieveWithHooks(
      index,
      { text: searched, vector: queryVector },
      retrievalSettings,
      { signal: request.signal, report: reportError },
    );
    if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
    const promptSources = buildSources(retrieval.hits, maxContextChars);
    const sources: AskSource[] = promptSources.map(({ id, url, title, heading }) => ({
      id,
      url,
      title,
      heading,
    }));
    const answer: CachedAnswer = {
      answer: retrieval.answerable ? '' : noAnswerMessage,
      sources,
      refused: !retrieval.answerable,
      retrieval: retrieval.mode,
      best: retrieval.best,
    };
    // An answer made while the embedding provider was down (keyword fallback) is not kept, so the
    // cache never serves a worse answer than the next request would get.
    const remember = (text: string): void => {
      if (!cache || !cacheKey || retrieval.mode !== expectedMode(index, options)) return;
      cache.set(cacheKey, { ...answer, answer: text }, reportError);
    };

    const id = generateId();
    if (!retrieval.answerable) {
      remember(noAnswerMessage);
      return respond(answer, id, null, () =>
        finish({
          id,
          lowConfidence: false,
          question,
          answer: noAnswerMessage,
          sources,
          refused: true,
          retrieval,
          cached: false,
          ...(followUp ? { followUp } : {}),
        }),
      );
    }

    const prompt = formatPrompt(searched, promptSources);
    let settle: ((actual: number | undefined) => Promise<void>) | null = null;
    if (budget) {
      // The worst case: the prompt at a pessimistic three characters a token, plus every output
      // token allowed. Settled to the real usage when the answer ends.
      const estimate = Math.ceil((instructions.length + prompt.length) / 3) + maxOutputTokens;
      const reserved = await overBudget(() => budget.reserve(estimate));
      if ('response' in reserved) return reserved.response;
      if (reserved.result?.allowed) settle = reserved.result.settle;
    }

    return respond(answer, id, () => {
      let failed = false;
      // Whether the model has begun to answer. One that fails before it does (a bad key, a quota,
      // an outage, a timeout) gives its reservation back, or an outage would use up the day's
      // budget with nothing spent; one that fails after keeps its worst case, unless its usage
      // says otherwise.
      let begun = false;
      const release = async (): Promise<void> => {
        if (settle && !begun) await settle(0).catch(reportError);
      };
      return streamText({
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        ...options.generation,
        timeout: options.generation?.timeout ?? DEFAULT_GENERATION_TIMEOUT,
        model: options.model,
        instructions,
        prompt,
        abortSignal: request.signal,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') begun = true;
        },
        onError: async ({ error }) => {
          failed = true;
          reportError(error);
          // A call that fails before it streams has no `onEnd` to settle it.
          await release();
        },
        onEnd: async (event) => {
          begun ||= event.text !== '';
          if (settle) {
            const spent = totalTokens(event.usage) ?? (failed && !begun ? 0 : undefined);
            await settle(spent).catch(reportError);
          }
          if (!failed && event.finishReason === 'stop') remember(event.text);
          await finish({
            id,
            question,
            answer: event.text,
            sources,
            refused: false,
            lowConfidence: !citesSources(event.text, sources),
            retrieval,
            usage: event.usage,
            cached: false,
            ...(followUp ? { followUp } : {}),
          });
        },
        // A client that hung up is not an error, and keeps its reservation; `generation.timeout`
        // firing is one.
        onAbort: async ({ reason }) => {
          if (request.signal.aborted) return;
          reportError(new Error('The answer was aborted before it finished.', { cause: reason }));
          await release();
        },
      });
    });
  };

  /**
   * Streams an answer: metadata, the numbered sources, then the text, either `answer.answer` as
   * it is (a refusal or a cached answer, followed by `done`) or the model's stream from `generate`.
   */
  function respond(
    answer: CachedAnswer,
    id: string,
    generate: (() => ReturnType<typeof streamText>) | null,
    done?: () => Promise<void>,
  ): Response {
    const metadata: AskMetadata = {
      // A cached reply of only "I don't know" is a refusal from the start.
      refused: answer.refused || saysOnlyIDontKnow(answer.answer),
      retrieval: answer.retrieval,
      ...(options.onFeedback ? { feedback: true } : {}),
    };
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageId: id, messageMetadata: metadata });
        for (const source of answer.sources) {
          writer.write({
            type: 'source-url',
            sourceId: String(source.id),
            url: source.url,
            title: source.heading ? `${source.title} › ${source.heading}` : source.title,
            providerMetadata: {
              [SOURCE_METADATA_KEY]: { title: source.title, heading: source.heading },
            },
          });
        }

        if (!generate) {
          const id = generateId();
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: answer.answer });
          writer.write({ type: 'text-end', id });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return done?.();
        }

        // A reply that is only "I don't know" is a refusal: the stream's last part says so, so the
        // dialog shows it as one, without the sources it was given.
        let reply = '';
        writer.merge(
          toUIMessageStream({
            stream: generate().stream,
            sendStart: false,
            onError: () => MODEL_ERROR_MESSAGE,
            messageMetadata: ({ part }) => {
              if (part.type === 'text-delta') reply += part.text;
              return part.type === 'finish' && saysOnlyIDontKnow(reply)
                ? { ...metadata, refused: true }
                : undefined;
            },
          }),
        );
        return undefined;
      },
      onError: (error) => {
        reportError(error);
        return MODEL_ERROR_MESSAGE;
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: { ...baseHeaders, 'x-accel-buffering': 'no' },
    });
  }
}

const DEFAULT_MAX_OUTPUT_TOKENS = 800;

/**
 * What `generation.timeout` defaults to: 30 seconds for the first word, as a reasoning model
 * thinks before it writes, and 90 for the whole answer, which covers a provider that never
 * answers the request at all.
 */
const DEFAULT_GENERATION_TIMEOUT = { firstChunkMs: 30_000, totalMs: 90_000 };

/** What `retrieval.maxContextChars` defaults to: characters of source text sent to the model. */
const DEFAULT_MAX_CONTEXT_CHARS = 8000;

/** What `rateLimit` defaults to: 10 questions a minute per client IP, per instance. */
const DEFAULT_RATE_LIMIT = 10;

/** How retrieval runs when nothing fails: hybrid with an embedding model and vectors. */
function expectedMode(index: LoadedIndex, options: AskHandlerOptions): 'hybrid' | 'keyword' {
  return options.embeddingModel && index.vectors && index.embedding ? 'hybrid' : 'keyword';
}

const modelName = (model: LanguageModel): string =>
  typeof model === 'string' ? model : `${model.provider}:${model.modelId}`;

/**
 * The answer cache behind `answerCache`. A key covers the index's content hash and the normalized
 * question, and what else shapes the answer (the model, the instructions, the retrieval and
 * generation settings), so a rebuilt index or a new prompt starts fresh even in a shared store.
 * The store failing never fails a request: it is reported, and the question is answered anew.
 */
function answerCache(
  cacheOptions: true | AnswerCacheOptions,
  options: AskHandlerOptions,
  instructions: string,
  keyed: {
    retrieval: Omit<AskRetrievalOptions, 'maxContextChars'> | null;
    maxContextChars: number | null;
  },
) {
  const {
    store = memoryAnswerCache(),
    ttlSeconds = 86_400,
    prefix = 'ask-my-site:answer:',
  } = cacheOptions === true ? {} : cacheOptions;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError(
      `answerCache.ttlSeconds must be a positive integer (got ${String(ttlSeconds)}).`,
    );
  }
  let settings: Promise<string> | null = null;
  return {
    key: async (index: LoadedIndex, question: string): Promise<string> => {
      settings ??= sha256(
        JSON.stringify([
          modelName(options.model),
          instructions,
          options.noAnswerMessage ?? null,
          keyed.retrieval,
          // The hooks, which JSON leaves out: a change to their code starts a fresh cache.
          String(options.retrieval?.retrieve ?? ''),
          String(options.retrieval?.rerank ?? ''),
          keyed.maxContextChars,
          options.generation?.maxOutputTokens ?? null,
        ]),
      );
      const digest = await sha256(
        JSON.stringify([index.contentHash, await settings, normalizeQuestion(question)]),
      );
      return `${prefix}${digest}`;
    },
    get: async (key: string, report: (error: unknown) => void): Promise<CachedAnswer | null> => {
      try {
        return parseCachedAnswer(await store.get(key));
      } catch (error) {
        report(error);
        return null;
      }
    },
    set: (key: string, value: CachedAnswer, report: (error: unknown) => void): void => {
      try {
        void Promise.resolve(store.set(key, value, ttlSeconds)).catch(report);
      } catch (error) {
        report(error);
      }
    },
  };
}
