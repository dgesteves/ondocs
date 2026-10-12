---
# Generated from examples/nextjs/content/docs/workers-ai.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Workers AI, without an API key'
description: 'A Cloudflare Worker that answers for any static docs site with Workers AI, the models and their cost, and how large a site fits.'
sidebar:
  order: 23
---

A docs site on GitHub Pages, S3, Read the Docs or any other host that only serves files can have its Ask box and its MCP endpoint answered by a Cloudflare Worker with Workers AI, Cloudflare's own models. There is no model key to get or set, and a small site's questions fit in Workers AI's free daily allowance of 10,000 neurons.

## Deploy the Worker

There are two ways to get the same Worker. In the site's folder, `init` reads the site's URL from its config:

```sh
npx ondocs init --host github-pages   # writes ondocs-worker/
cd ondocs-worker && npm install && npx wrangler deploy
```

Or start from the template, set `SITE_URL` in its `wrangler.jsonc` to the site's URL with its base path, and deploy:

```sh
npm create cloudflare@latest my-docs-ask -- --template=dgesteves/ondocs/templates/cloudflare-worker
cd my-docs-ask && npx wrangler deploy
```

Or use [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dgesteves/ondocs/tree/main/templates/cloudflare-worker), which copies the template to a new repository of yours, asks for `SITE_URL`, and deploys it on every push.

Wrangler prints the Worker's URL. Point the dialog at it, plus `/api/ask`: `endpoint` in the Docusaurus or Starlight plugin, or `data-endpoint` on the script tag. You need a Cloudflare account, which is free, and `npx wrangler login` once. The site keeps deploying as it does now, and must serve its index at `SITE_URL/ask-index.json`, which the plugins write with every build.

The Worker fetches the index from the live site and checks it again every five minutes with a conditional request, so it follows the site's deploys without being deployed again. It sends CORS headers for the site's origin and no other, says "I don't know" without calling the model when nothing in the docs is relevant, and serves the same index to agents at `/api/mcp`, keyword-only, calling no model.

## Keywords, or meaning too

An index built without an embedding model, the default when the build has no model key, is searched by keywords, and needs no secret anywhere. To search by meaning as well, embed the index with Workers AI as the site builds:

```js
// The Docusaurus or Starlight plugin
ondocs({
  endpoint: 'https://my-docs-ask.<subdomain>.workers.dev/api/ask',
  embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5',
});
```

```sh
# Any other site
npx ondocs index public -o public/ask-index.json -e workers-ai:@cf/baai/bge-small-en-v1.5
```

The build calls Cloudflare's REST API with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, a token with Workers AI Read and Edit permissions, set as repository secrets for a GitHub Actions build. It sends each chunk's text, 100 at a time, and gets back BGE-small's 384-dimension vectors, at $0.020 per million tokens (1,841 neurons per million). The Worker embeds each question with the same model through its AI binding. Both send only the text, so both get the model's default pooling, as they must to compare.

On docusaurus.io's docs (1,070 chunks) and the 22 questions and 6 off-topic ones the 2026-10-10 audit asked, with BGE-small run locally (the same open weights, with Workers AI's default mean pooling):

| Search                 | Right page first | Right page in the top 3 | Off-topic questions answered |
| ---------------------- | ---------------- | ----------------------- | ---------------------------- |
| Keywords only          | 14 of 22         | 18 of 22                | 0 of 6                       |
| Keywords and BGE-small | 16 of 22         | 19 of 22                | 0 of 6                       |

BGE-small scored even the off-topic questions 0.46 to 0.63 against their closest chunk, so the default gate of 0.25, set for OpenAI's models, would let every question through. An index embedded with it gets 0.65 instead: the lowest value at which no off-topic question in that set gets through. Another embedding model needs its own `retrieval.minSimilarity`; [How retrieval works](/guides/retrieval/) explains the gate.

## Choose the model that answers

`CHAT_MODEL` in `wrangler.jsonc` is the Workers AI model that writes the answers. Workers AI costs $0.011 per 1,000 neurons, after the first 10,000 each day. A question of 2,400 input tokens (the instructions and up to 8,000 characters of sources) and 500 output tokens costs, from the neurons per million tokens on Cloudflare's pricing page in October 2026:

| Model                                          | Neurons a question | Questions a day, free | Per 1,000 questions after |
| ---------------------------------------------- | ------------------ | --------------------- | ------------------------- |
| `@cf/meta/llama-4-scout-17b-16e-instruct`      | 97.5               | about 100             | $1.07                     |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 101.8              | about 98              | $1.12                     |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast`     | 166.4              | about 60              | $1.83                     |
| `@cf/meta/llama-3.2-3b-instruct`               | 26.3               | about 380             | $0.29                     |
| `@cf/ibm-granite/granite-4.0-h-micro`          | 8.8                | about 1,100           | $0.10                     |

Llama 4 Scout is the default. These figures are prices, not quality: the answers of these models have not been compared here. A question's embedding costs about 0.04 neurons. On the Workers Free plan, nothing is charged past the free allowance; on Workers Paid it is billed at the rate above. The Worker caps itself at 100 questions and 300,000 model tokens a day per instance, about the free allowance with Llama 4 Scout: raise the `budget` in `src/index.ts` on Workers Paid.

## How large a site fits

A Worker instance has 128 MB of memory, and loads the index on its first request. Measured with Node.js 24 on an Apple M1 Max (V8, the engine Workers run), for indexes of docusaurus.io's text:

| Chunks | Index file, keywords / 384 dimensions | Memory once loaded | Heap growth while loading, before collection |
| ------ | ------------------------------------- | ------------------ | -------------------------------------------- |
| 1,000  | 0.8 MB / 1.3 MB                       | 1.8 MB / 2.2 MB    | 13 MB / 17 MB                                |
| 5,000  | 3.9 MB / 6.4 MB                       | 6.7 MB / 8.6 MB    | 48 MB / 66 MB                                |
| 10,000 | 7.7 MB / 12.7 MB                      | 14 MB / 23 MB      | 110 MB / 137 MB                              |

Up to about 5,000 chunks, a site fits with room to spare. Around 10,000 chunks, loading comes close to the limit; keep such an index keyword-only, or split it, as the plugins already do per locale. Avoid OpenAI's full 1,536 dimensions in a Worker: in the audit, 9,610 chunks at that size grew the process by 214 MB.

CPU time is the other limit. The Workers Free plan gives a request 10 ms of CPU time, and, in Cloudflare's words, "each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit". Loading the index in a fresh process took 17 ms for this site's docs (365 chunks), 38 ms for 1,000 chunks and about 160 ms for 5,000, once per instance. A search after that takes 0.7 ms at 1,000 chunks and about 7 ms at 10,000 ([Benchmarks](/reference/benchmarks/)), and the model calls are waits, not CPU time. A small site fits the Free plan. For a large one, use Workers Paid, which allows 30 seconds of CPU time by default. The Free plan also caps a Worker at 100,000 requests a day.

## Test it without an account

The template's `npm test` runs the Worker in workerd, the Workers runtime, on your machine, with stand-ins for the site and the AI binding, so it needs no Cloudflare account and uses none of your allowance. `npx wrangler dev` runs it against the real Workers AI, which needs `wrangler login` and counts against your allowance.

## With OpenAI instead

`npx ondocs init --host github-pages --provider openai` writes the same Worker with OpenAI: set its key with `npx wrangler secret put OPENAI_API_KEY`, and it embeds questions with the OpenAI model the index records.
