// createOndocs: the ask endpoint and the MCP endpoint from one set of options, so people and
// agents search the same indexes the same way, from the same origins; and the request guard the
// two endpoints share, which turns the same requests away with the same statuses.
import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { buildIndex, serializeIndexFile, type RetrievalHit, type SourceDocument } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { createOndocs, memoryRateLimit, type OndocsOptions } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

type Handler = (request: Request) => Promise<Response>;

/** An embedding model that counts its calls, embedding as the index was embedded. */
function countingModel() {
  const model = new MockEmbeddingModelV4({
    modelId: embeddingModel.modelId,
    doEmbed: (options) => embeddingModel.doEmbed(options),
  });
  return { model, calls: vi.spyOn(model, 'doEmbed') };
}

const model = () => mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 });

const askRequest = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('https://docs.example/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const search = (
  mcp: Handler,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  mcp(
    new Request('https://docs.example/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.7',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: args },
      }),
    }),
  );

const resultIds = async (response: Response): Promise<string[]> => {
  const body = (await response.json()) as {
    result: { structuredContent: { results: { id: string }[] } };
  };
  return body.result.structuredContent.results.map((result) => result.id);
};

describe('createOndocs', () => {
  it('gives both endpoints the same index, embedding model and retrieval hooks', async () => {
    const { model: embedder, calls } = countingModel();
    const reranked: string[] = [];
    const onToolCall = vi.fn();
    const { ask, mcp } = createOndocs({
      index,
      embeddingModel: embedder,
      siteName: 'the Acme docs',
      retrieval: {
        minSimilarity: MOCK_MIN_SIMILARITY,
        rerank: (question, hits) => {
          reranked.push(question);
          return hits;
        },
      },
      ask: { model: model(), rateLimit: false, allowedOrigins: ['https://blog.example'] },
      mcp: { rateLimit: false, onToolCall },
    });

    const answer = await ask(
      askRequest({ question: 'How are int8 vectors stored?' }, { origin: 'https://blog.example' }),
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('access-control-allow-origin')).toBe('https://blog.example');
    expect(await answer.text()).toContain('"url":"/docs/quantization');

    // The ask endpoint's origins are its own: they do not turn on the MCP endpoint's origin
    // check, which would refuse hosted clients, whose servers send an Origin.
    const searched = await search(mcp, { query: 'int8 vectors' }, { origin: 'https://claude.ai' });
    expect(searched.status).toBe(200);
    expect(searched.headers.get('access-control-allow-origin')).toBeNull();
    expect((await resultIds(searched))[0]).toMatch(/^\/docs\/quantization/);

    // One embedding each, the same hook on each, and hybrid search for the agent too.
    expect(calls).toHaveBeenCalledTimes(2);
    expect(reranked).toEqual(['How are int8 vectors stored?', 'int8 vectors']);
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ retrieval: 'hybrid' }));
    // The tools name the site, as the answers do.
    const listed = await mcp(
      new Request('https://docs.example/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      }),
    );
    expect(await listed.text()).toContain('Search the Acme docs');
  });

  it('serves each locale’s index to both', async () => {
    const page = (lang: 'en' | 'fr'): SourceDocument => ({
      id: 'install.md',
      url: lang === 'en' ? '/install' : '/fr/install',
      title: lang === 'en' ? 'Install' : 'Installation',
      content:
        lang === 'en'
          ? 'Install the package with npm and configure the plugin.'
          : 'Installez le paquet avec npm et configurez le plugin.',
    });
    const english = (await buildIndex({ documents: [page('en')] })).index;
    const french = (await buildIndex({ documents: [page('fr')] })).index;
    const { ask, mcp } = createOndocs({
      index: english,
      indexes: { fr: () => serializeIndexFile(french) },
      ask: { model: model(), rateLimit: false },
      mcp: { rateLimit: false },
    });
    const answer = await ask(askRequest({ question: 'Installez le paquet npm', locale: 'fr' }));
    expect(await answer.text()).toContain('"url":"/fr/install"');
    expect(
      await resultIds(await search(mcp, { query: 'Installez le paquet', locale: 'fr' })),
    ).toEqual(['/fr/install']);
  });

  it('loads a lazy index once for both', async () => {
    const lazy = vi.fn(() => Promise.resolve(serializeIndexFile(index)));
    const { ask, mcp } = createOndocs({
      index: lazy,
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      ask: { model: model(), rateLimit: false },
      mcp: { rateLimit: false },
    });
    await (await ask(askRequest({ question: 'How are int8 vectors stored?' }))).text();
    expect((await resultIds(await search(mcp, { query: 'int8 vectors' })))[0]).toMatch(
      /^\/docs\/quantization/,
    );
    expect(lazy).toHaveBeenCalledOnce();
  });

  it('keeps the MCP endpoint keyword-only with mcp.embeddingModel: false', async () => {
    const { model: embedder, calls } = countingModel();
    const onToolCall = vi.fn();
    const { mcp } = createOndocs({
      index,
      embeddingModel: embedder,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      ask: { model: model() },
      mcp: { embeddingModel: false, rateLimit: false, onToolCall },
    });
    expect((await resultIds(await search(mcp, { query: 'int8 vectors' })))[0]).toMatch(
      /^\/docs\/quantization/,
    );
    expect(calls).not.toHaveBeenCalled();
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ retrieval: 'keyword' }));
  });

  it('puts each endpoint’s own retrieval settings and headers over the shared ones', async () => {
    const hooks: string[] = [];
    const rerank = (name: string) => (_question: string, hits: RetrievalHit[]) => {
      hooks.push(name);
      return hits;
    };
    const { ask, mcp } = createOndocs({
      index,
      embeddingModel,
      headers: { 'x-shared': 'yes', 'x-who': 'shared' },
      retrieval: {
        minSimilarity: MOCK_MIN_SIMILARITY,
        retrieve: (_query, find) => {
          hooks.push('retrieve');
          return find();
        },
      },
      ask: {
        model: model(),
        rateLimit: false,
        headers: { 'x-who': 'ask' },
        retrieval: { topK: 1, rerank: rerank('ask rerank') },
      },
      mcp: { rateLimit: false, retrieval: { rerank: rerank('mcp rerank') } },
    });
    const answer = await ask(askRequest({ question: 'How are int8 vectors stored?' }));
    expect(answer.headers.get('x-shared')).toBe('yes');
    expect(answer.headers.get('x-who')).toBe('ask');
    expect((await answer.text()).match(/"type":"source-url"/g)).toHaveLength(1);
    const searched = await search(mcp, { query: 'int8 vectors' });
    expect(searched.headers.get('x-who')).toBe('shared');
    expect((await resultIds(searched)).length).toBeGreaterThan(1);
    expect(hooks).toEqual(['retrieve', 'ask rerank', 'retrieve', 'mcp rerank']);
  });

  it('gives each endpoint its own rate limit', async () => {
    const { ask, mcp } = createOndocs({
      index,
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      ask: { model: model(), rateLimit: memoryRateLimit({ limit: 1, windowMs: 60_000 }) },
      mcp: { rateLimit: memoryRateLimit({ limit: 1, windowMs: 60_000 }) },
    });
    await (await ask(askRequest({ question: 'How are int8 vectors stored?' }))).text();
    // The question used the ask endpoint's one request, not the MCP endpoint's.
    expect((await search(mcp, { query: 'int8 vectors' })).status).toBe(200);
    expect((await ask(askRequest({ question: 'How are int8 vectors stored?' }))).status).toBe(429);
    expect((await search(mcp, { query: 'int8 vectors' })).status).toBe(429);
  });
});

describe('the request guard both endpoints share', () => {
  const MAX_BODY = 512;
  const toolCall = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'search', arguments: { query: 'int8 vectors' } },
  });
  const question = JSON.stringify({ question: 'How are int8 vectors stored?' });

  function endpoints(overrides: Partial<OndocsOptions> = {}) {
    const onError = vi.fn();
    const { ask, mcp } = createOndocs({
      index,
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      maxBodyBytes: MAX_BODY,
      onError,
      ask: { model: model(), rateLimit: false },
      mcp: { rateLimit: false },
      ...overrides,
    });
    return { ask, mcp, onError };
  }

  /** The same request to each endpoint: with its own body, or the one given. */
  async function both(
    handlers: { ask: Handler; mcp: Handler },
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ ask: Response; mcp: Response }> {
    const make = (path: string, body: string) =>
      new Request(`https://docs.example/api/${path}`, {
        method: init.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.7',
          ...init.headers,
        },
        ...((init.method ?? 'POST') === 'POST' ? { body: init.body ?? body } : {}),
      });
    return {
      ask: await handlers.ask(make('ask', question)),
      mcp: await handlers.mcp(make('mcp', toolCall)),
    };
  }

  /** The error code each endpoint words a refusal with. */
  async function codes(responses: { ask: Response; mcp: Response }) {
    const ask = (await responses.ask.json()) as { error: { code: string } };
    const mcp = (await responses.mcp.json()) as { jsonrpc: string; error: { code: number } };
    expect(mcp.jsonrpc).toBe('2.0');
    return { ask: ask.error.code, mcp: mcp.error.code };
  }

  it('turns away a wrong method, a body that is not JSON, too large or unparseable', async () => {
    const handlers = endpoints();
    const cases = [
      { init: { method: 'GET' }, status: 405, ask: 'method_not_allowed', mcp: -32000 },
      {
        init: { headers: { 'content-type': 'text/plain' } },
        status: 415,
        ask: 'unsupported_media_type',
        mcp: -32000,
      },
      {
        init: { body: 'x'.repeat(MAX_BODY + 1) },
        status: 413,
        ask: 'payload_too_large',
        mcp: -32600,
      },
      { init: { body: '{"not json' }, status: 400, ask: 'invalid_json', mcp: -32700 },
    ];
    for (const { init, status, ask, mcp } of cases) {
      const responses = await both(handlers, init);
      expect([responses.ask.status, responses.mcp.status], JSON.stringify(init)).toEqual([
        status,
        status,
      ]);
      if (status === 405) {
        expect(responses.ask.headers.get('allow')).toBe('POST, OPTIONS');
        expect(responses.mcp.headers.get('allow')).toBe('POST, OPTIONS');
      }
      expect(await codes(responses)).toEqual({ ask, mcp });
    }
  });

  it('rate-limits both, with Retry-After, and fails closed or open alike', async () => {
    const limited = () => ({ success: false, limit: 1, remaining: 0, reset: Date.now() + 30_000 });
    const full = await both(
      endpoints({ ask: { model: model(), rateLimit: limited }, mcp: { rateLimit: limited } }),
      {},
    );
    expect([full.ask.status, full.mcp.status]).toEqual([429, 429]);
    expect([full.ask.headers.get('retry-after'), full.mcp.headers.get('retry-after')]).toEqual([
      '30',
      '30',
    ]);
    expect(await codes(full)).toEqual({ ask: 'rate_limited', mcp: -32000 });

    const outage = new Error('redis down');
    const failing = () => Promise.reject(outage);
    const closed = endpoints({
      ask: { model: model(), rateLimit: failing },
      mcp: { rateLimit: failing },
    });
    const down = await both(closed, {});
    expect([down.ask.status, down.mcp.status]).toEqual([503, 503]);
    expect(await codes(down)).toEqual({ ask: 'service_unavailable', mcp: -32000 });
    expect(closed.onError.mock.calls).toEqual([[outage], [outage]]);

    const open = await both(
      endpoints({
        rateLimitFailure: 'open',
        ask: { model: model(), rateLimit: failing },
        mcp: { rateLimit: failing },
      }),
      {},
    );
    expect([open.ask.status, open.mcp.status]).toEqual([200, 200]);
    await open.ask.text();
  });

  it('caps each day with a budget, alike', async () => {
    const handlers = endpoints({
      ask: { model: model(), budget: { requestsPerDay: 1 } },
      mcp: { budget: { requestsPerDay: 1 } },
    });
    const first = await both(handlers, {});
    expect([first.ask.status, first.mcp.status]).toEqual([200, 200]);
    await first.ask.text();
    const spent = await both(handlers, {});
    expect([spent.ask.status, spent.mcp.status]).toEqual([429, 429]);
    expect(Number(spent.ask.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(spent.mcp.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await codes(spent)).toEqual({ ask: 'budget_exceeded', mcp: -32000 });
  });
});
