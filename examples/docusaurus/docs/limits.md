---
# Generated from examples/nextjs/content/docs/limits.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Limits and trade-offs'
description: 'Where ondocs stops being the right tool, and what it gives up for simplicity.'
---

ondocs trades scale and freshness for having no infrastructure. The trade has edges, and this page lists them.

## Corpus size

Search is an exact scan over every vector, which is the right choice up to tens of thousands of chunks. At 10,000 chunks a query takes about 7 ms and the index is 15.7 MB. Both grow linearly: at 50,000 chunks the index is 78.7 MB, cold load takes 1.7 s and a query about 37 ms. That is comfortable to about 10,000 chunks and workable to about 50,000. Past that, an approximate index or a vector database is the better tool.

If your platform limits function bundle size, serve the index as a static file and load it with `index: () => fetch(url).then((r) => r.text())` instead of importing it.

## Freshness

The index is rebuilt when you deploy. Content that changes between deploys, or differs per user, is not a fit: use a vector database that you write to at runtime.

## Language

Keyword search uses an English stopword list and light plural stripping. Other languages still work through the embedding model, which handles them, but keyword matching is weaker for them. Per-language stopwords and stemming are on the roadmap.

## Follow-ups and the top sources

The model answers from the top few sources only, one question at a time. A follow-up is rewritten into a standalone question first, from the last three questions and their answers, so it can lean on them; nothing older is remembered. Whether a question needs the rewrite is decided by an English check, so on a site in another language set `followUps: { always: true }`.

## Content it cannot see

MDX is reduced to text without being evaluated, so components that render content from props are invisible to the index. The HTML loader is a fast tag stripper that expects a static site generator's output, not arbitrary markup. Anything that only appears after JavaScript runs in the browser is not in the built HTML, so it is not indexed.

## Rate limits per instance

`memoryRateLimit` counts per server instance, so on a serverless platform with many instances it limits each noisy client, not your total spend. A `budget` caps the total, but its memory store also counts per instance: give it `upstashBudgetStore` (and the limiter `upstashRateLimit`) for one count across instances, and set your provider's spend limit as the hard cap.

## Tuning per embedding model

The relevance gate's thresholds are calibrated for OpenAI's `text-embedding-3-small`, and measured for Workers AI's `@cf/baai/bge-small-en-v1.5`. Another embedding model needs its own `minSimilarity`, found by checking the `best` scores `retrieve()` reports on real questions. That is the main tuning cost.

## Prompt injection

Text on your pages reaches the model as data inside tags it cannot forge, but it is still text the model reads. A page that says "ignore your rules" is read like any other. Index only content you trust.

## When to use something else

- Search results without any server code: Pagefind.
- Answers over content that changes per user or per request: a vector database with a write path.
- A hosted dashboard and analytics, and no endpoint of your own to run: a hosted assistant such as Kapa or Inkeep.

## What is planned

- **A reranking hook:** an optional AI SDK reranking model over the fused candidates.
- **Bigger corpora:** sharded indexes loaded per section, and binary quantization with int8 rescoring.
- **More framework plugins,** built on [`ondocs/integration`](./writing-an-integration.md) as the Docusaurus, Astro, Starlight and VitePress ones are.
- **Language-aware keyword search:** stopwords and stemming per language.
