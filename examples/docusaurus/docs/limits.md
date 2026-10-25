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

Keyword search splits text into words at spaces and punctuation, then applies an English stopword list and light plural stripping. Languages that put spaces between words work through the embedding model, which handles them, but keyword matching is weaker for them. Per-language stopwords and stemming are on the roadmap.

Chinese and Japanese put no spaces between words, and Korean keeps a particle or an ending on the word, so keyword search splits a run of Chinese, Japanese or Korean text into overlapping pairs of characters, and drops a short list of question words such as 怎么, 如何, どこ and 어떻게, as it drops English stopwords: `怎么安装插件？` is `安装`, `装插` and `插件`, which a page that says 安装插件 has too. The query `环境变量` finds the section headed 环境变量 and the page that says 部署时需要设置环境变量. In Korean, `설치하나요` in a question shares only `설치` with `설치합니다` on a page, so a Korean question clears the relevance gate less often.

On a five-page test site in each language, asked 8 questions its pages answer, each keyword path puts the right page first this often ([`test/docs-claims.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/docs-claims.test.ts) checks the counts):

| Search                              | Chinese | Japanese | Korean | English |
| ----------------------------------- | ------- | -------- | ------ | ------- |
| Ask endpoint, `-e none` index       | 7 of 8  | 6 of 8   | 2 of 8 | 8 of 8  |
| Ask endpoint, `-e mock` index       | 8 of 8  | 8 of 8   | 7 of 8 | 8 of 8  |
| MCP search without `embeddingModel` | 8 of 8  | 7 of 8   | 3 of 8 | 8 of 8  |

Asked 6 questions the pages do not answer, each path refuses all 6, in every language.

The MCP server searches by keywords alone unless you give it an `embeddingModel`, and `ondocs dev`'s MCP endpoint and the MCP route the Astro and Starlight integrations serve always do. Keywords still miss a question worded differently from the page, so for docs in these languages, Korean above all, build the index with a multilingual embedding model, and pass it as `embeddingModel` to `createMcpHandler` as well as to `createAskHandler`: a question then clears the relevance gate on similarity alone, with no word in common. Check the model's `minSimilarity` on real questions, as [Tuning per embedding model](#tuning-per-embedding-model) says. On an Astro or Starlight site, a route file of your own at `src/pages/api/mcp.ts` answers instead of the integration's; see [Astro with an adapter](./deployment.md#astro-with-an-adapter).

A paragraph longer than a chunk is cut at a space, at the end of a sentence where it can be, and the next chunk repeats the end of the one before. In Chinese and Japanese, `。`, `！`, `？`, `；` and `：` end a sentence with or without a space after them, so their text is cut there too. A run of more than 1,200 characters with no space and none of them is cut at 1,200 characters, mid-sentence.

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

## Support tiers

ondocs works with more site types, hosts, model providers and agents than one maintainer can check by hand, so each one has a tier:

- **Tier 1, checked.** CI builds or tests it on every change, or someone ran it by hand on the date given, for the pull request linked. A check by hand holds for that date and version: CI does not repeat it.
- **Tier 2, documented.** The docs show how to set it up, and it should work, but nothing here runs it. If it does not work, [open an issue](https://github.com/dgesteves/ondocs/issues/new?template=bug_report.yml). A CI job, or a check by hand with its date, moves it to Tier 1.

CI has no model key and signs in to no host. Where it calls a model, it calls a local stand-in, such as one that answers as OpenAI's API does ([`scripts/openai-stub.mjs`](https://github.com/dgesteves/ondocs/blob/main/scripts/openai-stub.mjs)), and it builds and runs each host's output with that host's own tools, offline, without deploying it. Below, `consumers: next` is the `next` site of the `consumers` job in [CI](https://github.com/dgesteves/ondocs/blob/main/.github/workflows/ci.yml), which creates a fresh site and installs ondocs into it from the packed package, and `recipes: vercel` is the `vercel` run of the `recipes` job, which builds what `npx ondocs init` writes for that host and asks it questions.

### Site types

| Site                                                   | Tier | Evidence                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                                                | 1    | `consumers: next`, a `create-next-app@16` site. CI also builds the Next.js example, which is ondocs.vercel.app.                                                                                                                                                                                                                        |
| Fumadocs                                               | 1    | `consumers: fumadocs`, a `create-fumadocs-app@16` site set up as the [Fumadocs guide](./fumadocs.md) says.                                                                                                                                                                                                                             |
| Nextra                                                 | 1    | `consumers: nextra`, Nextra 4.6.1's docs starter set up as the [Nextra guide](./nextra.md) says.                                                                                                                                                                                                                                       |
| Docusaurus                                             | 1    | `consumers: docusaurus` and `consumers: docusaurus-plugin-ondocs`, `create-docusaurus@3` sites. CI also builds the Docusaurus example, one of the live demos.                                                                                                                                                                          |
| Starlight                                              | 1    | `consumers: starlight` and `consumers: starlight-ondocs`, `create-astro@4` Starlight sites. CI also builds the Starlight example, one of the live demos.                                                                                                                                                                               |
| Astro, without Starlight                               | 1    | `recipes: astro-node`, `recipes: astro-vercel` and `recipes: astro-cloudflare`, an Astro 7 site with `ondocs/astro` and an SSR adapter.                                                                                                                                                                                                |
| VitePress                                              | 1    | `consumers: vitepress`, a VitePress 1 site. CI also builds the VitePress example, one of the live demos.                                                                                                                                                                                                                               |
| Plain HTML, with the script tag                        | 1    | [`scripts/js-weight.mjs`](https://github.com/dgesteves/ondocs/blob/main/scripts/js-weight.mjs) in CI: on a plain HTML page with the script tag, in headless Chrome, the dialog opens from the shortcut and gives focus back. [`test/init.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/init.test.ts) runs `init --out`. |
| Hugo, Jekyll, MkDocs and Eleventy, with the script tag | 2    | [`test/init-project-site.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/init-project-site.test.ts) checks that `init` reads Hugo's, Jekyll's and MkDocs's config, but CI builds no site with any of the four.                                                                                                            |
| Other React frameworks                                 | 2    | [Next.js and React](./nextjs.md#other-react-frameworks-and-runtimes) shows the route and the dialog. CI builds none.                                                                                                                                                                                                                   |

### Deploy targets

| Host                                         | Tier | Evidence                                                                                                                                                                                           |
| -------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel                                       | 1    | `recipes: vercel`: `vercel build`, then each function called as Vercel calls it. ondocs.vercel.app and the three live demos are deployed on Vercel.                                                |
| Netlify                                      | 1    | `recipes: netlify`: `netlify build --offline`, then `netlify serve --offline`.                                                                                                                     |
| Cloudflare Pages                             | 1    | `recipes: cloudflare-pages`: `wrangler pages functions build`, then `wrangler pages dev`.                                                                                                          |
| Cloudflare Workers, with static assets       | 1    | `recipes: cloudflare-workers`: `wrangler deploy --dry-run`, then `wrangler dev`.                                                                                                                   |
| GitHub Pages, with a Cloudflare Worker       | 1    | `recipes: github-pages`: the Worker `init` writes, with OpenAI, under `wrangler dev`, reading the index from a local copy of the site.                                                             |
| The Workers AI Worker template               | 1    | `recipes: workers-ai`: the template's own tests, in workerd, with stand-ins for the site and the AI binding.                                                                                       |
| Astro's Node, Vercel and Cloudflare adapters | 1    | `recipes: astro-node`, `recipes: astro-vercel` and `recipes: astro-cloudflare`: the integration serves the endpoints through the adapter, with no route file.                                      |
| Any other host or runtime                    | 2    | The handler uses Web APIs only, so it should run on Bun, Deno, Hono or another Node.js host ([Runtimes](./deployment.md#runtimes)). CI runs it on Node.js and in workerd, on the hosts above only. |

### Model providers

| Provider                       | Tier | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                         | 1    | Every `consumers` site embeds its index with `@ai-sdk/openai`, and every `recipes` run but `workers-ai` answers with it, all against the stand-in. Against OpenAI itself, [`retrieval-eval.yml`](https://github.com/dgesteves/ondocs/blob/main/.github/workflows/retrieval-eval.yml), which runs by hand, embedded docusaurus.io's docs with `text-embedding-3-small` on 2026-10-21 ([run](https://github.com/dgesteves/ondocs/actions/runs/39674683854)).                                                                                                                  |
| Workers AI                     | 1    | `recipes: workers-ai` runs the Worker template's tests in workerd, with a stand-in AI binding. [`test/workers-ai.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/workers-ai.test.ts) runs the template with a stand-in binding that streams as Workers AI does, and builds an index over its REST API, against a local stub. The relevance gate for `@cf/baai/bge-small-en-v1.5` was measured on the model's open weights, run locally, on 2026-10-10 ([#60](https://github.com/dgesteves/ondocs/pull/60)). No run on Cloudflare's own Workers AI is recorded. |
| AI Gateway, building the index | 1    | [`test/embedding-defaults.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/embedding-defaults.test.ts) builds an index through AI Gateway when only its key is set, against a stand-in.                                                                                                                                                                                                                                                                                                                                                                         |
| AI Gateway, answers            | 2    | A model id such as `'openai/gpt-5.4-mini'` goes through AI Gateway, but no test streams an answer through it.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Anthropic                      | 2    | The snippets type-checked against `@ai-sdk/anthropic` on 2026-10-09 ([#25](https://github.com/dgesteves/ondocs/pull/25)), but no answer from Claude is recorded.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Google Gemini                  | 2    | The snippets type-checked against `@ai-sdk/google` on 2026-10-09 ([#25](https://github.com/dgesteves/ondocs/pull/25)), but no answer from Gemini is recorded, and the relevance gate is not measured for its embeddings.                                                                                                                                                                                                                                                                                                                                                    |
| xAI Grok                       | 2    | The snippets type-checked against `@ai-sdk/xai` on 2026-10-09 ([#25](https://github.com/dgesteves/ondocs/pull/25)), but no answer from Grok is recorded.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Any other AI SDK provider      | 2    | Documented in [Model providers](./model-providers.md#any-other-ai-sdk-provider). No run is recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### MCP clients

| Client                         | Tier | Evidence                                                                                                                                                                                                                                                                                |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official MCP TypeScript client | 1    | [`test/mcp-client.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/mcp-client.test.ts): `@modelcontextprotocol/client` connects, lists the tools, searches and fetches, with `initialize` and with `server/discover`.                                                       |
| Codex                          | 1    | 0.163.0, by hand on 2026-10-15 ([#155](https://github.com/dgesteves/ondocs/pull/155)): it connected and listed the tools. It had no model, so it made no tool call.                                                                                                                     |
| Gemini CLI                     | 1    | 0.64.0, by hand on 2026-10-15 ([#155](https://github.com/dgesteves/ondocs/pull/155)): `gemini mcp list` showed it connected, with `--transport http`. It made no tool call.                                                                                                             |
| MCP SDKs and agent frameworks  | 1    | By hand on 2026-10-15 ([#155](https://github.com/dgesteves/ondocs/pull/155)): the MCP TypeScript and Python SDKs, the OpenAI Agents SDK and the LangChain MCP adapters connected, listed the tools, searched and fetched. [Tested clients](./mcp.md#tested-clients) has their versions. |
| Claude Code                    | 2    | Its command is documented. No run against the endpoint is recorded.                                                                                                                                                                                                                     |
| Cursor                         | 2    | Its install link is documented. No run is recorded.                                                                                                                                                                                                                                     |
| VS Code                        | 2    | Its install link is documented. No run is recorded.                                                                                                                                                                                                                                     |
| ChatGPT                        | 2    | How to add it is documented. No run is recorded.                                                                                                                                                                                                                                        |
| Claude (claude.ai)             | 2    | Its connector link is documented. No run is recorded.                                                                                                                                                                                                                                   |

## When to use something else

- Search results without any server code: Pagefind.
- Answers over content that changes per user or per request: a vector database with a write path.
- A hosted dashboard and analytics, and no endpoint of your own to run: a hosted assistant such as Kapa or Inkeep.
- Docs for agents with no endpoint of your own: an aggregator such as Context7, if it indexes your docs.

## What is planned

- **Bigger corpora:** sharded indexes loaded per section, and binary quantization with int8 rescoring.
- **More framework plugins,** built on [`ondocs/integration`](./writing-an-integration.md) as the Docusaurus, Astro, Starlight and VitePress ones are. None lands before Thursday 2026-11-19, four weeks after the public launch, unless an issue asks for it ([new integrations](https://github.com/dgesteves/ondocs/blob/main/CONTRIBUTING.md#new-integrations)).
- **Language-aware keyword search:** stopwords and stemming per language.
