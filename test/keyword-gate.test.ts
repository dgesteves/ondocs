// The keyword side of the relevance gate on an index without embeddings (`-e none`, or a plugin
// build with no model key), where nothing else can catch a question the keywords miss.
import { describe, expect, it } from 'vitest';

import { buildIndex, DEFAULT_RETRIEVAL, loadIndex, retrieve } from '../src';
import { mockEmbeddingModel } from '../src/mock';
import { createMcpHandler } from '../src/server';
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
