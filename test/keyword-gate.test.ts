// The keyword side of the relevance gate on an index without embeddings (`-e none`, or a plugin
// build with no model key), where nothing else can catch a question the keywords miss.
import { describe, expect, it } from 'vitest';

import { buildIndex, DEFAULT_RETRIEVAL, loadIndex, retrieve } from '../src';
import { MOCK_MIN_SIMILARITY, hashEmbedding, mockEmbeddingModel } from '../src/mock';
import { createMcpHandler } from '../src/server';
import { searchSections } from '../src/server/mcp-tools';
import { OFF_TOPIC, SITES } from './cjk-sites';
import { corpus } from './helpers';

const { index: keywordOnly } = await buildIndex({ documents: corpus });
const { index: embedded } = await buildIndex({
  documents: corpus,
  embeddingModel: mockEmbeddingModel(),
});

// Every word of it but "laptop" is in the Requirements section, and "laptop" is on no page, so it
// carries the most IDF and holds the question's keyword coverage under 0.5.
const PLAIN = 'Which Node.js version do I need for my laptop?';

describe('the keyword gate on a keyword-only index', () => {
  it('answers a plain question that one word the docs lack holds under 0.5', () => {
    const result = retrieve(loadIndex(keywordOnly), { text: PLAIN });
    expect(result.best.keywordCoverage).toBeGreaterThanOrEqual(0.4);
    expect(result.best.keywordCoverage).toBeLessThan(DEFAULT_RETRIEVAL.minKeywordCoverage);
    expect(result.answerable).toBe(true);
    expect(result.hits[0]?.chunk.url).toBe('/docs/install#requirements');
  });

  it('still refuses what the docs do not cover', () => {
    const result = retrieve(loadIndex(keywordOnly), { text: 'What is the capital of Mongolia?' });
    expect(result).toMatchObject({ answerable: false, hits: [] });
  });

  it('keeps 0.5 for an index with embeddings, and an explicit minKeywordCoverage wins', () => {
    // With embeddings, the similarity side is there to catch such questions.
    const withVectors = retrieve(loadIndex(embedded), { text: PLAIN, vector: null });
    expect(withVectors.answerable).toBe(false);
    const strict = retrieve(loadIndex(keywordOnly), { text: PLAIN }, { minKeywordCoverage: 0.5 });
    expect(strict.answerable).toBe(false);
  });
});

describe('MCP search with nothing past its gate', () => {
  const handler = createMcpHandler({ index: keywordOnly, rateLimit: false });
  let id = 0;
  const search = async (query: string) => {
    const response = await handler(
      new Request('https://docs.example.com/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: (id += 1),
          method: 'tools/call',
          params: { name: 'search', arguments: { query } },
        }),
      }),
    );
    const { result } = (await response.json()) as {
      result: {
        content: { type: string; text: string }[];
        structuredContent: { results: unknown[]; note?: string };
      };
    };
    return result;
  };

  it('tells the agent what to try instead of returning a bare empty list', async () => {
    // The rate-limiting page answers it, but "requests" and "chatbot" are on no page, so the
    // question's keyword coverage stays under search's 0.3.
    const result = await search('How do I rate limit requests from my chatbot?');
    expect(result.structuredContent.results).toEqual([]);
    expect(result.structuredContent.note).toMatch(/fewer .*keywords.*list_pages/);
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent);
    // The keywords alone find it.
    const retry = await search('rate limit');
    expect(retry.structuredContent.results).not.toEqual([]);
    expect(retry.structuredContent.note).toBeUndefined();
  });
});

describe('the keyword gate in Chinese, Japanese and Korean', () => {
  const keywordOnly = async (language: keyof typeof SITES) =>
    loadIndex((await buildIndex({ documents: SITES[language] })).index);

  it('answers a question that shares words, not a whole run, with the page', async () => {
    // Each was one term that no page had, so the gate refused it and MCP search found nothing.
    const zh = await keywordOnly('zh');
    const install = retrieve(zh, { text: '怎么安装插件？' });
    expect(install.answerable).toBe(true);
    expect(install.hits[0]?.chunk.url).toBe('/zh/docs/install#安装插件');
    expect(searchSections(zh, '怎么部署到 Vercel？', null, {})[0]?.id).toBe(
      '/zh/docs/deploy#部署到-vercel',
    );
    // The deploy page says 部署时需要设置环境变量, inside a longer run.
    expect(searchSections(zh, '环境变量', null, {}).map((result) => result.id)).toEqual([
      '/zh/docs/config#环境变量',
      '/zh/docs/deploy#部署到-vercel',
    ]);
    const ja = await keywordOnly('ja');
    expect(retrieve(ja, { text: 'Vercel にデプロイするには？' }).hits[0]?.chunk.url).toBe(
      '/ja/docs/deploy#vercel-にデプロイする',
    );
    expect(searchSections(ja, 'ダイアログを開くには？', null, {})[0]?.id).toBe(
      '/ja/docs/dialog#ダイアログを開く',
    );
  });

  it('still refuses what the pages do not cover, on every keyword path', async () => {
    for (const language of ['zh', 'ja', 'ko'] as const) {
      const documents = SITES[language];
      const plain = await keywordOnly(language);
      const mock = loadIndex(
        (await buildIndex({ documents, embeddingModel: mockEmbeddingModel() })).index,
      );
      for (const question of OFF_TOPIC[language]) {
        expect(retrieve(plain, { text: question }).answerable, question).toBe(false);
        const vector = hashEmbedding(question, 512);
        const answer = retrieve(
          mock,
          { text: question, vector },
          { minSimilarity: MOCK_MIN_SIMILARITY },
        );
        expect(answer.answerable, question).toBe(false);
        expect(searchSections(plain, question, null, {}), question).toEqual([]);
      }
    }
  });
});
