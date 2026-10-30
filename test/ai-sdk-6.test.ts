// AI SDK 6, which ondocs supports next to 7: v6 has no standalone `toUIMessageStream` and no
// `ai/test` v4 models, and reads some settings by their older names (`system` for `instructions`,
// `onFinish` for `onEnd`, `experimental_telemetry` for `telemetry`), dropping the new ones without
// a word. These tests run on the AI SDK installed: the lockfile's 7, and 6 in CI's ai-sdk-6 job,
// which leaves out the test files written for AI SDK 7's v4 test models. So the models made here
// are v3 ones, which both take: the errors, the timeouts and the budget's settlement are tested on
// AI SDK 6 too.
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { createAskHandler, type AskHandlerOptions, type BudgetStore } from '../src/server';
import { FOLLOW_UP_INSTRUCTIONS } from '../src/server/follow-up';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

function setup(overrides: Partial<AskHandlerOptions> = {}) {
  const model = mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 });
  const onFinish = vi.fn();
  const onError = vi.fn();
  const handler = createAskHandler({
    index,
    model,
    embeddingModel,
    siteName: 'Acme Docs',
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    onFinish,
    onError,
    ...overrides,
  });
  return { handler, model, onFinish, onError };
}

const ask = (body: unknown) =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const QUESTION = 'How do I keep a token bucket in memory?';

/** A follow-up after one question and its answer: the endpoint rewrites it before it searches. */
const FOLLOW_UP = {
  messages: [
    ['user', 'How do I keep a token bucket per client IP in memory?'],
    ['assistant', 'Use memoryRateLimit, which keeps one per client IP [1].'],
    ['user', 'And with Upstash?'],
  ].map(([role, text]) => ({ role, parts: [{ type: 'text', text }] })),
};

/** The text the stream carries, joined. */
const textOf = (stream: string) =>
  [...stream.matchAll(/"type":"text-delta","id":"[^"]+","delta":"((?:[^"\\]|\\.)*)"/g)]
    .map(([, delta]) => JSON.parse(`"${delta ?? ''}"`) as string)
    .join('');

type Part = Record<string, unknown> & { type: string };

/** The stream's parts, as JSON. */
async function readParts(response: Response): Promise<Part[]> {
  return (await response.text())
    .split('\n\n')
    .map((event) => event.replace(/^data: /, '').trim())
    .filter((event) => event && event !== '[DONE]')
    .map((event) => JSON.parse(event) as Part);
}

/** The system prompt of a call the model got: its first message, when that is one. */
function systemPrompt(call: { prompt: { role: string; content: unknown }[] } | undefined) {
  const first = call?.prompt[0];
  return first?.role === 'system' ? first.content : undefined;
}

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV3['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never;

/** A model that answers in four words, reporting 120 input and 9 output tokens. */
const answering = () =>
  new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream<StreamPart>({
          chunks: [
            { type: 'text-start', id: 't' },
            ...['Use ', 'memoryRateLimit ', 'for ', 'that [1].'].map((delta) => ({
              type: 'text-delta' as const,
              id: 't',
              delta,
            })),
            { type: 'text-end', id: 't' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 9, text: 9, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });

/** A model whose call fails with `error`, as a provider's does. */
const failing = (error: Error) =>
  new MockLanguageModelV3({ doStream: () => Promise.reject(error) });

/** A model whose provider never answers the call, until it is aborted. */
const unanswered = () =>
  new MockLanguageModelV3({
    doStream: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => {
          reject(abortSignal.reason as Error);
        });
      }),
  });

const apiError = (statusCode: number) =>
  new APICallError({
    message: `status ${String(statusCode)}`,
    url: 'https://api.openai.com/v1/responses',
    requestBodyValues: {},
    statusCode,
  });

/** A budget store that keeps its counters, for the tokens the day has counted. */
function countingStore(): BudgetStore & { counted: () => number } {
  const counters = new Map<string, number>();
  return {
    counted: () => [...counters.values()].reduce((sum, value) => sum + value, 0),
    increment(key, amount) {
      const value = (counters.get(key) ?? 0) + amount;
      counters.set(key, value);
      return value;
    },
  };
}

describe('the endpoint on the AI SDK installed', () => {
  // First, before another test here has had the AI SDK print a deprecation, which its own logger
  // prints once a process.
  it('prints no warning while it answers and rewrites a follow-up', async () => {
    const printed: unknown[] = [];
    const onWarning = (warning: Error) => printed.push(warning);
    process.on('warning', onWarning);
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => printed.push(args));
    // The AI SDK's warnings, deprecations among them, to a logger of the test's: every one.
    const logger: unknown = Reflect.get(globalThis, 'AI_SDK_LOG_WARNINGS');
    Reflect.set(globalThis, 'AI_SDK_LOG_WARNINGS', ({ warnings }: { warnings: unknown[] }) =>
      printed.push(...warnings),
    );
    try {
      const { handler, onError } = setup();
      expect(textOf(await (await handler(ask({ question: QUESTION }))).text())).not.toBe('');
      await (await handler(ask(FOLLOW_UP))).text();
      // process.emitWarning emits on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onError).not.toHaveBeenCalled();
    } finally {
      process.off('warning', onWarning);
      Reflect.set(globalThis, 'AI_SDK_LOG_WARNINGS', logger);
    }
    expect(printed).toEqual([]);
  });

  it('answers with its instructions as the system prompt, and reports the answer and its usage', async () => {
    const { handler, model, onFinish, onError } = setup();
    const response = await handler(ask({ question: QUESTION }));
    expect(response.status).toBe(200);
    const stream = await response.text();

    expect(model.doStreamCalls).toHaveLength(1);
    expect(systemPrompt(model.doStreamCalls[0])).toContain('Acme Docs');
    expect(textOf(stream)).toMatch(/\[\d+\]/);
    expect(stream).toContain('"type":"finish"');
    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalledTimes(1);
    });
    const event = onFinish.mock.calls[0]?.[0] as {
      answer: string;
      usage?: { totalTokens?: number };
    };
    expect(event.answer).toBe(textOf(stream));
    expect(event.usage?.totalTokens).toBeGreaterThan(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it('rewrites a follow-up with the rewrite’s own instructions as the system prompt', async () => {
    const { handler, model } = setup();
    await (await handler(ask(FOLLOW_UP))).text();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(systemPrompt(model.doGenerateCalls[0])).toBe(FOLLOW_UP_INSTRUCTIONS);
  });

  it('passes generation.telemetry on to the AI SDK', async () => {
    // AI SDK 7 tells the integrations, and AI SDK 6 records spans with the tracer, which its
    // releases before 6.0.110 have only.
    const onStart = vi.fn();
    const spans: string[] = [];
    const span: object = new Proxy(
      {},
      { get: (_, key) => (key === 'then' ? undefined : () => span) },
    );
    const tracer = {
      startSpan: (name: string) => (spans.push(name), span),
      startActiveSpan: (name: string, ...args: unknown[]) => {
        spans.push(name);
        return (args.at(-1) as (span: object) => unknown)(span);
      },
    };
    const { handler } = setup({
      generation: {
        telemetry: { isEnabled: true, integrations: { onStart }, ...({ tracer } as object) },
      },
    });
    await (await handler(ask({ question: QUESTION }))).text();
    expect(onStart.mock.calls.length + spans.length).toBeGreaterThan(0);
  });
});

describe('model errors on the AI SDK installed', () => {
  it('says the endpoint is misconfigured when the provider rejects the key (401)', async () => {
    const { handler, onError } = setup({ model: failing(apiError(401)) });
    const parts = await readParts(await handler(ask({ question: QUESTION })));
    const types = parts.map((part) => part.type);

    expect(types.indexOf('source-url')).toBeGreaterThan(0);
    expect(parts.find((part) => part.type === 'error')).toEqual({
      type: 'error',
      errorText: 'The ask endpoint is misconfigured.',
    });
    expect(parts.at(types.indexOf('error') + 1)).toEqual({
      type: 'message-metadata',
      messageMetadata: { refused: false, retrieval: 'hybrid', misconfigured: true },
    });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]?.[0] as Error).name).toBe('AI_APICallError');
  });

  it('masks any other error, and reports it', async () => {
    const { handler, onError } = setup({
      model: failing(new Error('upstream 500 with secret details')),
      generation: { maxRetries: 0 },
    });
    const stream = await (await handler(ask({ question: QUESTION }))).text();

    expect(stream).toContain('"errorText":"The answer could not be generated. Please try again."');
    expect(stream).not.toContain('secret details');
    expect(stream).not.toContain('misconfigured');
    expect(String(onError.mock.calls[0]?.[0])).toContain('secret details');
  });
});

describe('timeouts on the AI SDK installed', () => {
  it('stops an answer that runs past generation.timeout, and reports it', async () => {
    const { handler, onFinish, onError } = setup({
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 40 }),
      generation: { timeout: 60 },
    });
    const parts = await readParts(await handler(ask({ question: QUESTION })));

    expect(parts.some((part) => part.type === 'abort')).toBe(true);
    expect(onFinish).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/aborted/i);
  });

  it('stops a provider that never answers after 90 seconds by default', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The AI SDK times the whole call with `AbortSignal.timeout`, which fake timers do not reach.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      }, ms);
      return controller.signal;
    });
    try {
      const { handler, onError } = setup({ model: unanswered() });
      let ended = false;
      const parts = handler(ask({ question: QUESTION }))
        .then(readParts)
        .finally(() => (ended = true));

      await vi.advanceTimersByTimeAsync(89_999);
      expect(ended).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => {
        expect(ended).toBe(true);
      });
      expect((await parts).some((part) => part.type === 'abort')).toBe(true);
      expect(String(onError.mock.calls[0]?.[0])).toMatch(/aborted/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the budget on the AI SDK installed', () => {
  const budget = (store: BudgetStore) => ({
    tokensPerDay: 100_000,
    store,
    now: () => Date.UTC(2026, 9, 10, 18),
  });

  it('settles an answer’s reservation to the tokens it used', async () => {
    const store = countingStore();
    const { handler } = setup({ model: answering(), budget: budget(store) });
    await (await handler(ask({ question: QUESTION }))).text();
    // 120 input and 9 output tokens, once the answer has ended.
    await vi.waitFor(() => {
      expect(store.counted()).toBe(129);
    });
  });

  it('gives the reservation back when the call fails, or times out, before a word', async () => {
    for (const overrides of [
      { model: failing(apiError(503)), generation: { maxRetries: 0 } },
      { model: unanswered(), generation: { timeout: { totalMs: 50 } } },
    ]) {
      const store = countingStore();
      const { handler, onError } = setup({ ...overrides, budget: budget(store) });
      const parts = await readParts(await handler(ask({ question: QUESTION })));

      expect(parts.some((part) => part.type === 'error' || part.type === 'abort')).toBe(true);
      expect(onError).toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(store.counted()).toBe(0);
      });
    }
  });
});
