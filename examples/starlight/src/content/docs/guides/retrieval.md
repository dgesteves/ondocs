---
# Generated from examples/nextjs/content/docs/retrieval.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'How retrieval works'
description: 'BM25, cosine similarity, reciprocal rank fusion and the relevance gate that says "I don''t know".'
sidebar:
  order: 25
---

Hybrid search combines keyword search and vector search over the same chunks, then decides whether anything it found is relevant enough to answer from. It all runs in memory, in the same function that streams the answer.

## Two retrievers

BM25 ranks chunks by the question's keywords, weighting rare terms higher. It is strong on exact names such as function names, flags and error messages. camelCase identifiers are indexed whole and split, so `createAskHandler` also matches "create ask handler".

Cosine similarity ranks chunks by the meaning of the question, using the embedding model the index was built with. It is strong on paraphrases, where the question and the page use different words. The scan is exact: every int8 vector is compared, with no approximate index to build at cold start.

## Reciprocal rank fusion

The two rankings are merged with reciprocal rank fusion (RRF). Each chunk scores the sum of 1 / (60 + rank) over the lists it appears in. Fusion uses ranks only, so BM25 scores and similarities never need to be put on one scale, and a chunk that both retrievers rank well beats one that only one of them ranks first.

## Saying "I don't know"

Before fusion, every candidate must clear a relevance gate: a cosine similarity of at least 0.25, or keyword coverage of at least 0.5. Keyword coverage is the share of the question's IDF weight that a chunk contains, so it is between 0 and 1 and comparable across questions of any length.

When no chunk clears the gate, the handler answers "I don't know" immediately and never calls the language model. That makes refusals fast, free and deterministic. The default message is "I don't know. I couldn't find anything about that on this site.", with your `siteName`, and `noAnswerMessage` replaces it. The model's instructions add a second layer: answer only from the numbered sources, cite each claim, and say so when the sources are not enough.

## From chunks to sources

The top 6 chunks are numbered as sources, and chunks from the same section share one number, so an answer never cites two numbers that open the same place. Sources are added in rank order until 8,000 characters (`retrieval.maxContextChars`), and sent to the model with the question. The stream sends the sources before the first word of the answer, so citations are clickable as soon as they appear.

## Keyword fallback

If the embedding provider fails while embedding a question, that request falls back to keyword retrieval instead of failing, and the error goes to `onError`. An index built without embeddings (`-e none`) always retrieves by keywords alone.

## Tuning

The defaults are `{ topK: 6, candidates: 40, rrfK: 60, minSimilarity: 0.25, minKeywordCoverage: 0.5, maxContextChars: 8000 }`, passed to the handler as `retrieval`. The similarity threshold is calibrated for OpenAI's `text-embedding-3-small`. An index embedded with Workers AI's `@cf/baai/bge-small-en-v1.5` gets 0.65 instead, measured on docusaurus.io's docs (see [Workers AI](/guides/workers-ai/#keywords-or-meaning-too)). Other embedding models produce other ranges, so check the `best` scores that `retrieve()` returns on real questions and set `minSimilarity` to match.

The keyword side is conservative: IDF comes from your pages, so a question word that appears on none of them carries the most weight. A question that adds one such word, like a product or company name, can fall below 0.5 on keywords alone even when the rest of it matches a page exactly. With embeddings, the similarity side catches such questions; for a keyword-only index, lower `minKeywordCoverage`.

## Rerank, or retrieve your own way

Two hooks in `retrieval` change how the handler finds its sources, and the relevance gate still decides last.

`rerank` puts the candidates in a new order, best first, before the top `topK` are kept. It gets the question and up to `candidates` hits (default 40), each with its chunk and its scores. With the AI SDK's `rerank()` and a reranking model:

```ts
import { cohere } from '@ai-sdk/cohere';
import { rerank } from 'ai';

export const POST = createAskHandler({
  index,
  model,
  embeddingModel,
  retrieval: {
    rerank: async (question, hits, { signal }) => {
      const { ranking } = await rerank({
        model: cohere.reranking('rerank-v3.5'),
        query: question,
        documents: hits.map((hit) => hit.chunk.text),
        topN: 6,
        abortSignal: signal,
      });
      return ranking.flatMap(({ originalIndex }) => hits[originalIndex] ?? []);
    },
  },
});
```

That is one call to the reranking model per question, after the cache: a question answered from `answerCache` reranks nothing. A reranker can also be plain code, such as boosting a section: `rerank: (question, hits) => [...hits].sort((a, b) => boost(b) - boost(a))`, with `boost` reading `hit.chunk.url`.

`retrieve` finds the candidates instead of the built-in retrieval. It gets the question's text and vector, and `search`, the built-in retrieval, to call with options of its own: `retrieve: (query, search) => search({ topK: 20 }).filter((hit) => hit.chunk.url.startsWith('/docs/v2/'))` answers from one version of the docs. It returns hits on the index's chunks, which `context.index` holds, and runs before `rerank` when both are set.

Whatever the hooks return, each hit's chunk is measured again against the question, and a chunk that clears neither the similarity nor the keyword threshold is dropped, as are chunks not in the index: a hook can reorder and filter the sources, but not make an off-topic page count. With nothing left, the answer is "I don't know", with no model call. A hook that throws is reported to `onError`, and the question is answered without it. `gateHits` from `ondocs` applies the same gate to hits from anywhere, for a handler of your own.

## Retrieval in mock mode

The mock embedder's similarity comes from shared words, so a mock index uses `minSimilarity: 0.2` (`MOCK_MIN_SIMILARITY`) and counts similarity only from chunks that share a word with the question. Without that rule, a short question could match a short chunk through a hash collision. The `similarityNeedsKeyword` option turns the rule on or off; it is off for real embeddings, which match meaning without shared words.
