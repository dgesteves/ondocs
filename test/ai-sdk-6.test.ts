// AI SDK 6, which ondocs supports next to 7: v6 has no standalone `toUIMessageStream` and no
// `ai/test` v4 models, and reads some settings by their older names (`system` for `instructions`,
// `onFinish` for `onEnd`, `experimental_telemetry` for `telemetry`), dropping the new ones without
// a word. These tests run on the AI SDK installed: the lockfile's 7, and 6 in CI's ai-sdk-6 job,
// where each failed before the handler and the mock models looked for what the SDK has.
import { describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { createAskHandler, type AskHandlerOptions } from '../src/server';
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

/** The text the stream carries, joined. */
const textOf = (stream: string) =>
  [...stream.matchAll(/"type":"text-delta","id":"[^"]+","delta":"((?:[^"\\]|\\.)*)"/g)]
    .map(([, delta]) => JSON.parse(`"${delta ?? ''}"`) as string)
    .join('');

/** The system prompt of a call the model got: its first message, when that is one. */
function systemPrompt(call: { prompt: { role: string; content: unknown }[] } | undefined) {
  const first = call?.prompt[0];
  return first?.role === 'system' ? first.content : undefined;
}

describe('the endpoint on the AI SDK installed', () => {
  it('answers with its instructions as the system prompt, and reports the answer and its usage', async () => {
    const { handler, model, onFinish, onError } = setup();
    const response = await handler(ask({ question: 'How do I keep a token bucket in memory?' }));
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
    const message = (role: 'user' | 'assistant', text: string) => ({
      role,
      parts: [{ type: 'text', text }],
    });
    await (
      await handler(
        ask({
          messages: [
            message('user', 'How do I keep a token bucket per client IP in memory?'),
            message('assistant', 'Use memoryRateLimit, which keeps one per client IP [1].'),
            message('user', 'And with Upstash?'),
          ],
        }),
      )
    ).text();
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
    await (await handler(ask({ question: 'How do I keep a token bucket in memory?' }))).text();
    expect(onStart.mock.calls.length + spans.length).toBeGreaterThan(0);
  });
});
