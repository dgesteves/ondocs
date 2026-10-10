// createAskHandler's retrieval hooks, `rerank` and `retrieve`, and the relevance gate that decides
// after them (`gateHits`). No model is called: the embeddings are the mock's, the answers come
// from a scripted model, and the reranking model is the AI SDK's mock.
import { rerank } from 'ai';
import { MockLanguageModelV4, MockRerankingModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import {
  buildIndex,
  gateHits,
  loadIndex,
  retrieve,
  type RetrievalHit,
  type RetrievalResult,
} from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import { createAskHandler, memoryAnswerCache, type AskHandlerOptions } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index: file } = await buildIndex({ documents: corpus, embeddingModel });
const index = loadIndex(file);
const RETRIEVAL = { minSimilarity: MOCK_MIN_SIMILARITY };

function scriptedModel() {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            { type: 'text-delta' as const, id: 't', delta: 'An answer [1].' },
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 4, text: 4, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });
}

/** Asks `question` of a handler with these retrieval options; what retrieval found, and more. */
async function ask(question: string, overrides: Partial<AskHandlerOptions> = {}) {
  const model = scriptedModel();
  let retrieval: RetrievalResult | undefined;
  const onError = vi.fn();
  const handler = createAskHandler({
    index: file,
    model,
    embeddingModel,
    retrieval: RETRIEVAL,
    rateLimit: false,
    onError,
    onFinish: (event) => {
      retrieval = event.retrieval;
    },
    ...overrides,
  });
  const response = await handler(
    new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
  );
  await response.text();
  if (!retrieval) throw new Error('onFinish was not called');
  return { retrieval, urls: retrieval.hits.map((hit) => hit.chunk.url), model, onError };
}

/** The vector the handler embeds a question into. */
async function vectorOf(text: string): Promise<number[]> {
  const result = await embeddingModel.doEmbed({ values: [text] });
  return result.embeddings[0] ?? [];
}

describe('gateHits', () => {
  it('measures each hit again on the index, and keeps the ones the gate lets through', async () => {
    const query = {
      text: 'How are int8 vectors stored?',
      vector: await vectorOf('How are int8 vectors stored?'),
    };
    const { hits } = retrieve(index, query, RETRIEVAL);
    const offTopic = index.chunks.find((chunk) => chunk.documentId === 'pricing.md');
    expect(offTopic).toBeDefined();
    // A hit that claims to be relevant, on a chunk that is not.
    const forged: RetrievalHit = {
      chunk: offTopic!,
      score: 1,
      similarity: 1,
      keywordScore: 99,
      keywordCoverage: 1,
    };
    const missing: RetrievalHit = { ...forged, chunk: { ...offTopic!, id: 'not-in-the-index' } };
    const reversed = [...hits].reverse();
    const gated = gateHits(index, query, [forged, missing, ...reversed, ...reversed], RETRIEVAL);

    // In the given order, without the forged or unknown hit, and without repeats.
    expect(gated.hits.map((hit) => hit.chunk.id)).toEqual(reversed.map((hit) => hit.chunk.id));
    // With the signals the index gives, not the ones the hits carried.
    expect(
      gated.hits.map(({ similarity, keywordCoverage }) => ({ similarity, keywordCoverage })),
    ).toEqual(reversed.map(({ similarity, keywordCoverage }) => ({ similarity, keywordCoverage })));
    expect(gated.best).toEqual(retrieve(index, query, RETRIEVAL).best);
    expect(gated.mode).toBe('hybrid');
    expect(gated.answerable).toBe(true);
  });

  it('keeps at most topK, and is not answerable when nothing passes', () => {
    const query = { text: 'int8 vectors', vector: null };
    const { hits } = retrieve(index, query, { ...RETRIEVAL, topK: 10 });
    expect(gateHits(index, query, hits, { topK: 1 }).hits).toHaveLength(1);
    const offTopic = { text: 'Who won the 1998 World Cup final?', vector: null };
    const result = gateHits(index, offTopic, hits, RETRIEVAL);
    expect(result).toMatchObject({ hits: [], answerable: false, mode: 'keyword' });
  });
});

describe('createAskHandler with no retrieval hooks', () => {
  it('retrieves exactly as retrieve() does', async () => {
    for (const question of ['How are int8 vectors stored?', 'How do I install it with pnpm?']) {
      const { retrieval } = await ask(question);
      expect(retrieval).toEqual(
        retrieve(index, { text: question, vector: await vectorOf(question) }, RETRIEVAL),
      );
    }
  });
});

describe('retrieval.rerank', () => {
  it('orders the sources, from the candidates, before topK is applied', async () => {
    const question = 'How are int8 vectors stored?';
    const seen: { question: string; count: number; signal: boolean }[] = [];
    const { urls, retrieval } = await ask(question, {
      retrieval: {
        ...RETRIEVAL,
        topK: 1,
        // Last first: what a reranker that disagrees with the fusion does.
        rerank: (q, hits, { signal, index: searched }) => {
          seen.push({ question: q, count: hits.length, signal: signal instanceof AbortSignal });
          expect(searched.chunks.length).toBe(index.chunks.length);
          return [...hits].reverse();
        },
      },
    });
    const all = retrieve(
      index,
      { text: question, vector: await vectorOf(question) },
      {
        ...RETRIEVAL,
        topK: 40,
      },
    ).hits;
    expect(seen).toEqual([{ question, count: all.length, signal: true }]);
    expect(all.length).toBeGreaterThan(1);
    // The fusion's last candidate, which topK: 1 alone would have left out.
    expect(urls).toEqual([all.at(-1)?.chunk.url]);
    expect(retrieval.hits).toHaveLength(1);
  });

  it('cannot make an off-topic chunk count: the gate decides after it', async () => {
    const pricing = index.chunks.filter((chunk) => chunk.documentId === 'pricing.md');
    const forge = (chunk: (typeof pricing)[number]): RetrievalHit => ({
      chunk,
      score: 1,
      similarity: 1,
      keywordScore: 1,
      keywordCoverage: 1,
    });
    const { urls } = await ask('How are int8 vectors stored?', {
      retrieval: { ...RETRIEVAL, rerank: (_q, hits) => [...pricing.map(forge), ...hits] },
    });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.startsWith('/docs/pricing'))).toBe(false);

    // With nothing left, the question is refused, and the model is not called.
    const { retrieval, model } = await ask('How are int8 vectors stored?', {
      retrieval: { ...RETRIEVAL, rerank: () => pricing.map(forge) },
    });
    expect(retrieval.answerable).toBe(false);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('works with the AI SDK’s rerank(), as the docs show it', async () => {
    const question = 'How are int8 vectors stored?';
    const calls: { query: string; documents: number }[] = [];
    // Puts the documents that mention "scaled" first, as a reranking model might.
    const reranking = new MockRerankingModelV4({
      doRerank: ({ query, documents }) => {
        const texts = documents.type === 'text' ? documents.values : [];
        calls.push({ query, documents: texts.length });
        const ranking = texts
          .map((text, index) => ({ index, relevanceScore: text.includes('scaled') ? 1 : 0 }))
          .sort((a, b) => b.relevanceScore - a.relevanceScore);
        return Promise.resolve({ ranking });
      },
    });
    const { urls } = await ask(question, {
      retrieval: {
        ...RETRIEVAL,
        rerank: async (q, hits, { signal }) => {
          const { ranking } = await rerank({
            model: reranking,
            query: q,
            documents: hits.map((hit) => hit.chunk.text),
            topN: 6,
            abortSignal: signal,
          });
          return ranking.flatMap(({ originalIndex }) => hits[originalIndex] ?? []);
        },
      },
    });
    expect(calls[0]?.query).toBe(question);
    expect(urls[0]).toBe('/docs/quantization#why-int8');
  });

  it('is reported, and skipped, when it throws', async () => {
    const failure = new Error('reranker down');
    const question = 'How are int8 vectors stored?';
    const { retrieval, onError } = await ask(question, {
      retrieval: { ...RETRIEVAL, rerank: () => Promise.reject(failure) },
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(retrieval.hits.map((hit) => hit.chunk.id)).toEqual(
      retrieve(index, { text: question, vector: await vectorOf(question) }, RETRIEVAL).hits.map(
        (hit) => hit.chunk.id,
      ),
    );
  });
});

describe('retrieval.retrieve', () => {
  it('finds the candidates instead of the built-in retrieval, with search() to call', async () => {
    const queries: { text: string; vector: boolean }[] = [];
    const { urls } = await ask('How do I install it with pnpm?', {
      retrieval: {
        ...RETRIEVAL,
        // Only the installation guide, boosted to the top: a filter by section.
        retrieve: (query, search) => {
          queries.push({ text: query.text, vector: query.vector !== null });
          return search({ topK: 10 }).filter((hit) => hit.chunk.documentId === 'install.md');
        },
      },
    });
    expect(queries).toEqual([{ text: 'How do I install it with pnpm?', vector: true }]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('/docs/install'))).toBe(true);
  });

  it('runs before rerank, and the gate checks what it adds', async () => {
    const order: string[] = [];
    const pricing = index.chunks.find((chunk) => chunk.documentId === 'pricing.md')!;
    const { urls } = await ask('How are int8 vectors stored?', {
      retrieval: {
        ...RETRIEVAL,
        retrieve: (_query, search) => {
          order.push('retrieve');
          const forged = {
            chunk: pricing,
            score: 9,
            similarity: 1,
            keywordScore: 9,
            keywordCoverage: 1,
          };
          return [forged, ...search()];
        },
        rerank: (_q, hits) => {
          order.push('rerank');
          return hits;
        },
      },
    });
    expect(order).toEqual(['retrieve', 'rerank']);
    expect(urls.some((url) => url.startsWith('/docs/pricing'))).toBe(false);
    expect(urls.length).toBeGreaterThan(0);
  });

  it('falls back to the built-in retrieval, reported, when it throws', async () => {
    const failure = new Error('search service down');
    const question = 'How are int8 vectors stored?';
    const { retrieval, onError } = await ask(question, {
      retrieval: {
        ...RETRIEVAL,
        retrieve: () => {
          throw failure;
        },
      },
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(retrieval.answerable).toBe(true);
  });
});

describe('the answer cache with hooks', () => {
  it('keeps answers apart from the ones made without them, or with other hook code', async () => {
    const store = memoryAnswerCache();
    const question = 'How are int8 vectors stored?';
    const first = await ask(question, { answerCache: { store } });
    expect(first.model.doStreamCalls).toHaveLength(1);
    // The same settings answer from the cache, without a model call.
    const again = await ask(question, { answerCache: { store } });
    expect(again.model.doStreamCalls).toHaveLength(0);
    // A reranker makes other answers: not from the cache.
    const reranked = await ask(question, {
      answerCache: { store },
      retrieval: { ...RETRIEVAL, rerank: (_q, hits) => [...hits].reverse() },
    });
    expect(reranked.model.doStreamCalls).toHaveLength(1);
  });
});
