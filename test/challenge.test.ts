// The bot check on the ask endpoint: `challenge: turnstile({ secretKey })` on createAskHandler,
// against a stand-in for Turnstile's siteverify that answers as Cloudflare's documented test secret
// keys do. Nothing here reaches Cloudflare: `fetch` is replaced in every test.
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import {
  createAskHandler,
  createMcpHandler,
  turnstile,
  type AskHandlerOptions,
} from '../src/server';
import { corpus } from './helpers';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare's test secret keys: always passes, always fails, and "token already spent". */
const PASS = '1x0000000000000000000000000000000AA';
const FAIL = '2x0000000000000000000000000000000AA';
const SPENT = '3x0000000000000000000000000000000AA';
/** The token Cloudflare's test site keys give, the only one the test secret keys accept. */
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

/** Turnstile's siteverify as the test secret keys make it answer, and the requests it got. */
let siteverify: ReturnType<typeof vi.fn>;
let verified: { secret: string; response: string }[];
beforeEach(() => {
  verified = [];
  siteverify = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== SITEVERIFY) return Promise.reject(new Error(`unexpected fetch of ${url}`));
    const body = JSON.parse(init?.body as string) as { secret: string; response: string };
    verified.push(body);
    const answer = (success: boolean, codes: string[] = []) =>
      Promise.resolve(Response.json({ success, 'error-codes': codes }));
    switch (body.secret) {
      case PASS:
        return body.response === TOKEN ? answer(true) : answer(false, ['invalid-input-response']);
      case FAIL:
        return answer(false, ['invalid-input-response']);
      case SPENT:
        return answer(false, ['timeout-or-duplicate']);
      default:
        return answer(false, ['invalid-input-secret']);
    }
  });
  vi.stubGlobal('fetch', siteverify);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function scriptedModel() {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            { type: 'text-delta' as const, id: 't', delta: 'Vectors are stored as int8 [1].' },
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: {
                inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 9, text: 9, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });
}

function setup(overrides: Partial<AskHandlerOptions> = {}) {
  const model = scriptedModel();
  const embed = vi.spyOn(embeddingModel, 'doEmbed');
  const onError = vi.fn();
  const handler = createAskHandler({
    index,
    model,
    embeddingModel,
    siteName: 'Acme Docs',
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    onError,
    ...overrides,
  });
  return { handler, model, embed, onError };
}

const QUESTION = 'How are vectors stored?';
const post = (body: unknown): Request =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  });
const errorOf = async (response: Response) =>
  [response.status, ((await response.json()) as { error: { code: string } }).error.code] as const;

describe('turnstile', () => {
  it('sends the secret and the token to siteverify, and passes a good token', async () => {
    const check = turnstile({ secretKey: PASS });
    expect(await check(TOKEN, post({}))).toEqual({ success: true });
    expect(verified).toEqual([{ secret: PASS, response: TOKEN }]);
    const [, init] = siteverify.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('fails a bad, used or someone else’s token, with Turnstile’s reasons', async () => {
    expect(await turnstile({ secretKey: FAIL })(TOKEN, post({}))).toEqual({
      success: false,
      errorCodes: ['invalid-input-response'],
    });
    expect(await turnstile({ secretKey: SPENT })(TOKEN, post({}))).toEqual({
      success: false,
      errorCodes: ['timeout-or-duplicate'],
    });
    // The test secret accepts only the test token, as a real one accepts only its widget's.
    expect((await turnstile({ secretKey: PASS })('a.forged.token', post({}))).success).toBe(false);
  });

  it('throws when it cannot tell: a wrong secret, an error at Turnstile, or no answer', async () => {
    await expect(turnstile({ secretKey: 'not-a-secret' })(TOKEN, post({}))).rejects.toThrow(
      /invalid-input-secret/,
    );
    siteverify.mockResolvedValueOnce(
      Response.json({ success: false, 'error-codes': ['internal-error'] }),
    );
    await expect(turnstile({ secretKey: PASS })(TOKEN, post({}))).rejects.toThrow(/internal-error/);
    siteverify.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));
    await expect(turnstile({ secretKey: PASS })(TOKEN, post({}))).rejects.toThrow(/HTTP 502/);
    siteverify.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(turnstile({ secretKey: PASS })(TOKEN, post({}))).rejects.toThrow('fetch failed');
  });

  it('needs a secret key', () => {
    expect(() => turnstile({ secretKey: '' })).toThrow(/secretKey is missing/);
    expect(() => turnstile({ secretKey: undefined as unknown as string })).toThrow(TypeError);
  });
});

describe('createAskHandler with challenge', () => {
  it('is off by default: a question without a token is answered, and Turnstile is not called', async () => {
    const { handler, model } = setup();
    const response = await handler(post({ question: QUESTION }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('int8');
    expect(model.doStreamCalls).toHaveLength(1);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('answers a question whose token passes, checking each question’s token', async () => {
    const { handler, model } = setup({ challenge: turnstile({ secretKey: PASS }) });
    for (const _ of [1, 2]) {
      const response = await handler(post({ question: QUESTION, challenge: TOKEN }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('int8');
    }
    expect(verified).toEqual([
      { secret: PASS, response: TOKEN },
      { secret: PASS, response: TOKEN },
    ]);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('refuses a question without a token, before any embedding or model call', async () => {
    const { handler, model, embed } = setup({ challenge: turnstile({ secretKey: PASS }) });
    const response = await handler(post({ question: QUESTION }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'challenge_required',
        message: 'Send the bot check’s token as `challenge` with the question.',
      },
    });
    expect(await errorOf(await handler(post({ question: QUESTION, challenge: '' })))).toEqual([
      403,
      'challenge_required',
    ]);
    expect(siteverify).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('refuses a bad or used token with challenge_failed, before any embedding or model call', async () => {
    for (const secretKey of [FAIL, SPENT]) {
      const { handler, model, embed, onError } = setup({ challenge: turnstile({ secretKey }) });
      const response = await handler(post({ question: QUESTION, challenge: TOKEN }));
      expect([secretKey, ...(await errorOf(response))]).toEqual([
        secretKey,
        403,
        'challenge_failed',
      ]);
      expect(embed).not.toHaveBeenCalled();
      expect(model.doStreamCalls).toHaveLength(0);
      // A bot's bad token is not an error of the endpoint's.
      expect(onError).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('fails closed when Turnstile cannot tell, and open with rateLimitFailure: open', async () => {
    siteverify.mockRejectedValue(new TypeError('fetch failed'));
    const closed = setup({ challenge: turnstile({ secretKey: PASS }) });
    const response = await closed.handler(post({ question: QUESTION, challenge: TOKEN }));
    expect(await errorOf(response)).toEqual([503, 'service_unavailable']);
    expect(closed.onError).toHaveBeenCalledWith(new TypeError('fetch failed'));
    expect(closed.model.doStreamCalls).toHaveLength(0);

    const open = setup({ challenge: turnstile({ secretKey: PASS }), rateLimitFailure: 'open' });
    const answered = await open.handler(post({ question: QUESTION, challenge: TOKEN }));
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('int8');
    expect(open.onError).toHaveBeenCalledOnce();

    // A wrong secret is the endpoint's mistake, not the visitor's: reported, and a 503.
    const misconfigured = setup({ challenge: turnstile({ secretKey: 'not-a-secret' }) });
    siteverify.mockReset();
    siteverify.mockResolvedValue(
      Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }),
    );
    const refused = await misconfigured.handler(post({ question: QUESTION, challenge: TOKEN }));
    expect(await errorOf(refused)).toEqual([503, 'service_unavailable']);
    expect(misconfigured.onError).toHaveBeenCalledOnce();
  });

  it('checks after the rate limit, and before the answer cache', async () => {
    const limited = setup({
      challenge: turnstile({ secretKey: PASS }),
      rateLimit: () => Promise.resolve({ success: false, limit: 10, remaining: 0 }),
    });
    expect(
      await errorOf(await limited.handler(post({ question: QUESTION, challenge: TOKEN }))),
    ).toEqual([429, 'rate_limited']);
    expect(siteverify).not.toHaveBeenCalled();

    // An answer in the cache costs nothing, but a question still needs its token to get it.
    const cached = setup({ challenge: turnstile({ secretKey: PASS }), answerCache: true });
    const first = await cached.handler(post({ question: QUESTION, challenge: TOKEN }));
    await first.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await errorOf(await cached.handler(post({ question: QUESTION })))).toEqual([
      403,
      'challenge_required',
    ]);
    const again = await cached.handler(post({ question: QUESTION, challenge: TOKEN }));
    expect(await again.text()).toContain('int8');
    expect(cached.model.doStreamCalls).toHaveLength(1);
  });

  it('takes the token with a conversation, as { messages } with challenge', async () => {
    const { handler } = setup({ challenge: turnstile({ secretKey: PASS }) });
    const messages = [{ role: 'user', parts: [{ type: 'text', text: QUESTION }] }];
    expect(await errorOf(await handler(post({ messages })))).toEqual([403, 'challenge_required']);
    const response = await handler(post({ messages, challenge: TOKEN }));
    expect(response.status).toBe(200);
    expect(verified).toEqual([{ secret: PASS, response: TOKEN }]);
  });

  it('takes feedback without a token: a rating costs nothing', async () => {
    const onFeedback = vi.fn();
    const { handler } = setup({ challenge: turnstile({ secretKey: PASS }), onFeedback });
    const response = await handler(
      post({ feedback: { rating: 'up', question: QUESTION, answer: 'Stored as int8 [1].' } }),
    );
    expect(response.status).toBe(204);
    expect(onFeedback).toHaveBeenCalledOnce();
    expect(siteverify).not.toHaveBeenCalled();
  });
});

describe('the MCP endpoint', () => {
  it('is not challenged: agents cannot solve one, and their searches call no model', async () => {
    const ask = setup({ challenge: turnstile({ secretKey: PASS }) });
    expect(await errorOf(await ask.handler(post({ question: QUESTION })))).toEqual([
      403,
      'challenge_required',
    ]);
    const mcp = createMcpHandler({ index, siteName: 'the Acme docs', rateLimit: false });
    const response = await mcp(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'int8 vectors' } },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/docs/quantization');
    expect(siteverify).not.toHaveBeenCalled();
  });
});
