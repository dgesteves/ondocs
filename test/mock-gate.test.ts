// The relevance gate over a mock index (`ondocs index -e mock`, the README's "Try it without a
// key"): the mock embedder's similarity comes from shared words, so one word in common with a
// short section is enough to clear MOCK_MIN_SIMILARITY. A similarity counts only from a chunk that
// shares two of the question's words.
import { describe, expect, it } from 'vitest';

import {
  Bm25Index,
  buildIndex,
  loadIndex,
  retrieve,
  tokenize,
  type RetrievalOptions,
} from '../src';
import { MOCK_MIN_SIMILARITY, hashEmbedding, mockEmbeddingModel } from '../src/mock';

const page = (id: string, title: string, content: string) => ({
  id: `${id}.md`,
  url: `/docs/${id}`,
  title,
  content,
});

const PAGES = [
  page('search', 'Keyword search', 'Keyword search ranks the pages by keyword.'),
  page('deploy', 'Deploying', 'Deploy the endpoint to Netlify or Vercel as one function.'),
  page('pricing', 'Pricing', 'The plan costs ten dollars a month.'),
  page('install', 'Installing', 'Install the package with npm, then build the index.'),
  page('dialog', 'The dialog', 'The dialog opens with a shortcut and cites its sources.'),
];

/** Shares "plan" and "cost" with the pricing page, and nothing else with any page. */
const PRICE = 'How much does the yearly plan cost in euros?';

async function mockIndex() {
  const { index } = await buildIndex({ documents: PAGES, embeddingModel: mockEmbeddingModel() });
  return index;
}

/** What the endpoint does for a mock index, as `ondocs dev` configures it. */
const ask = (index: ReturnType<typeof loadIndex>, text: string, options: RetrievalOptions = {}) =>
  retrieve(
    index,
    { text, vector: hashEmbedding(text, 512) },
    { minSimilarity: MOCK_MIN_SIMILARITY, ...options },
  );

describe('the relevance gate over a mock index', () => {
  it('refuses a question that shares one word with a short section', async () => {
    const index = loadIndex(await mockIndex());
    const question = 'What does the "yield" keyword do in Python?';
    const loose = ask(index, question, { similarityNeedsKeyword: true });
    // One word in common is enough for the similarity...
    expect(loose.answerable).toBe(true);
    expect(loose.best.similarity).toBeGreaterThan(MOCK_MIN_SIMILARITY);
    expect(loose.best.keywordCoverage).toBeLessThan(0.5);
    // ...so a mock index asks for two, and says "I don't know".
    expect(ask(index, question)).toMatchObject({ answerable: false, hits: [] });
  });

  it('still answers questions that share two words, or most of their keywords', async () => {
    const index = loadIndex(await mockIndex());
    const urls = (text: string) => ask(index, text).hits.map((hit) => hit.chunk.url);
    // Two words in common, on similarity: the question's other words are on no page.
    const priced = ask(index, PRICE);
    expect(priced.hits[0]?.chunk.url).toBe('/docs/pricing');
    expect(priced.best.keywordCoverage).toBeLessThan(0.5);
    expect(urls('How do I deploy to Netlify?')[0]).toBe('/docs/deploy');
    // One word, which is the whole question: keyword coverage counts on its own.
    expect(urls('shortcut')[0]).toBe('/docs/dialog');
  });

  it('takes the number of shared words, true for one, or false for none', async () => {
    const index = loadIndex(await mockIndex());
    const question = 'What does the "yield" keyword do in Python?';
    expect(ask(index, question, { similarityNeedsKeyword: 1 }).answerable).toBe(true);
    expect(ask(index, question, { similarityNeedsKeyword: false }).answerable).toBe(true);
    expect(ask(index, PRICE, { similarityNeedsKeyword: 3 }).answerable).toBe(false);
  });

  it('counts the shared words as BM25 matched them, each distinct word once', () => {
    const bm25 = new Bm25Index([
      tokenize('Pricing. The plan costs ten dollars a month.'),
      tokenize('Deploying. Deploy the plan.'),
      tokenize('Installing. Install the package.'),
    ]);
    const { matchedTerms } = bm25.search(tokenize('plan dollars plan month'));
    expect([...matchedTerms]).toEqual([3, 1, 0]);
  });

  it('leaves other indexes alone: real embeddings match meaning without shared words', async () => {
    const file = await mockIndex();
    const semantic = loadIndex({ ...file, embedding: { ...file.embedding!, model: 'embed-x' } });
    expect(ask(semantic, 'What does the "yield" keyword do in Python?').answerable).toBe(true);
  });
});
