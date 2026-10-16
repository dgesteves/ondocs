---
title: Limits and trade-offs
description: Where ondocs stops being the right tool, and what it gives up for simplicity.
section: Reference
label: Limits
order: 35
---

ondocs trades scale and freshness for having no infrastructure. The trade has edges, and this page lists them.

## Corpus size

Search is an exact scan over every vector, which is the right choice up to tens of thousands of chunks. At 10,000 chunks a query takes about 7 ms and the index is 15.7 MB. Both grow linearly: at 50,000 chunks the index is 78.7 MB, cold load takes 1.7 s and a query about 37 ms. That is comfortable to about 10,000 chunks and workable to about 50,000. Past that, an approximate index or a vector database is the better tool.

If your platform limits function bundle size, serve the index as a static file and load it with `index: () => fetch(url).then((r) => r.text())` instead of importing it.

## Freshness

The index is rebuilt when you deploy. Content that changes between deploys, or differs per user, is not a fit: use a vector database that you write to at runtime.

## Language

Keyword search splits text into words at spaces and punctuation, then applies an English stopword list and light plural stripping. Languages that put spaces between words work through the embedding model, which handles them, but keyword matching is weaker for them. Per-language stopwords and stemming are on the roadmap.

In Chinese, Japanese and Korean, keyword search misses most questions asked in plain words. Chinese and Japanese put no spaces between words, so a run of text with no space or punctuation in it is one word, and it matches only a page with that exact run: `怎么安装插件？` is the single word `怎么安装插件`. The query `环境变量` finds the section headed 环境变量, not the page that says 部署时需要设置环境变量. Korean puts spaces between words, but a particle or an ending stays on the word, so `설치하나요` in a question does not match `설치합니다` on a page.

On a five-page test site in each language, asked 8 questions its pages answer, each keyword path puts the right page first this often ([`test/docs-claims.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/docs-claims.test.ts) checks the counts):

| Search                              | Chinese | Japanese | Korean | English |
| ----------------------------------- | ------- | -------- | ------ | ------- |
| Ask endpoint, `-e none` index       | 1 of 8  | 1 of 8   | 1 of 8 | 8 of 8  |
| Ask endpoint, `-e mock` index       | 3 of 8  | 3 of 8   | 3 of 8 | 8 of 8  |
| MCP search without `embeddingModel` | 3 of 8  | 3 of 8   | 2 of 8 | 8 of 8  |

The MCP server searches by keywords alone unless you give it an `embeddingModel`, and `ondocs dev`'s MCP endpoint and the MCP route the Astro and Starlight integrations serve always do. For docs in these languages, build the index with a multilingual embedding model, and pass it as `embeddingModel` to `createMcpHandler` as well as to `createAskHandler`: a question then clears the relevance gate on similarity alone, with no word in common. Check the model's `minSimilarity` on real questions, as [Tuning per embedding model](#tuning-per-embedding-model) says. On an Astro or Starlight site, a route file of your own at `src/pages/api/mcp.ts` answers instead of the integration's; see [Astro with an adapter](/docs/deployment#astro-with-an-adapter). Splitting these languages into words is planned.

A paragraph longer than a chunk is cut at a space, at the end of a sentence where it can be, and the next chunk repeats the end of the one before. Chinese or Japanese text with no spaces is cut at 1,200 characters, mid-sentence, with no overlap: `。` does not count as the end of a sentence.

## Follow-ups and the top sources

The model answers from the top few sources only, one question at a time. A follow-up is rewritten into a standalone question first, from the last three questions and their answers, so it can lean on them; nothing older is remembered. Whether a question needs the rewrite is decided by an English check, so on a site in another language set `followUps: { always: true }`.

## Content it cannot see

MDX is reduced to text without being evaluated, so components that render content from props are invisible to the index. The HTML loader is a fast tag stripper that expects a static site generator's output, not arbitrary markup. Anything that only appears after JavaScript runs in the browser is not in the built HTML, so it is not indexed.

## Rate limits per instance

`memoryRateLimit` counts per server instance, so on a serverless platform with many instances it limits each noisy client, not your total spend. A `budget` caps the total, but its memory store also counts per instance: give it `upstashBudgetStore` (and the limiter `upstashRateLimit`) for one count across instances, and set your provider's spend limit as the hard cap.

## Tuning per embedding model

The relevance gate's thresholds are chosen for OpenAI's `text-embedding-3-small`, and measured for Workers AI's `@cf/baai/bge-small-en-v1.5`. Another embedding model needs its own `minSimilarity`, found by checking the `best` scores `retrieve()` reports on real questions. That is the main tuning cost.

## Prompt injection

Text on your pages reaches the model as data inside tags it cannot forge, but it is still text the model reads. A page that says "ignore your rules" is read like any other. Index only content you trust.

## When to use something else

- Search results without any server code: Pagefind.
- Answers over content that changes per user or per request: a vector database with a write path.
- A hosted dashboard and analytics, and no endpoint of your own to run: a hosted assistant such as Kapa or Inkeep.
- Docs for agents with no endpoint of your own: an aggregator such as Context7, if it indexes your docs.

## What is planned

- **Bigger corpora:** sharded indexes loaded per section, and binary quantization with int8 rescoring.
- **More framework plugins,** built on [`ondocs/integration`](/docs/writing-an-integration) as the Docusaurus, Astro, Starlight and VitePress ones are.
- **Language-aware keyword search:** stopwords and stemming per language.
