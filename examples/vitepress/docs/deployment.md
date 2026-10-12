---
# Generated from examples/nextjs/content/docs/deployment.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Deploying'
description: 'Write the endpoint for Vercel, Netlify, Cloudflare or GitHub Pages with one command, where the index lives, cold starts and cost.'
---

# Deploying

The endpoint deploys wherever your site's server code runs, as one function. There is no database to provision and nothing to keep in sync: the index is a file built with the site. `npx ondocs init` writes that function for your host.

## Write the endpoint with init

Run `npx ondocs init` in your site's folder. It works out the site and the host from their config files, writes the ask endpoint and the [MCP endpoint](/mcp), and prints what it wrote, the environment variables to set and what is left to do:

```sh
npx ondocs init             # detects the site and the host, or asks which host
npx ondocs init --dry-run   # prints every file it would write, and writes nothing
```

| Host                                   | Detected from                                                                       | What init writes                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Vercel                                 | `vercel.json` or `.vercel/`                                                         | `api/ask.ts` and `api/mcp.ts`, and `includeFiles` for the index in `vercel.json`                                   |
| Netlify                                | `netlify.toml` or `.netlify/`                                                       | `netlify/functions/ask.mts` and `mcp.mts`, and `included_files` for the index in `netlify.toml`                    |
| Cloudflare Pages                       | a wrangler config with `pages_build_output_dir`, or `--host cloudflare` without one | `functions/api/ask.ts` and `mcp.ts`, which read the index through the `ASSETS` binding                             |
| Cloudflare Workers with static assets  | a wrangler config with `assets`                                                     | `worker/ondocs.ts`, which answers `/api/*` and serves the files, and `main` and the `ASSETS` binding in the config |
| GitHub Pages, or any other static host | a Pages workflow, or the `gh-pages` package or a deploy script that runs it         | `ondocs-worker/`, a Cloudflare Worker of its own that reads the index from the live site and needs no API key      |

For a Next.js app it writes `app/api/ask/route.ts` and `app/api/mcp/route.ts` instead, which import the index, with the client IP header of the host. An Astro site with an SSR adapter needs no file at all: see [Astro with an adapter](#astro-with-an-adapter).

On a site with several locales, read from Docusaurus's or Astro's `i18n` or Starlight's or VitePress's `locales`, the ask endpoint gets each locale's index as `indexes`, bundled with it, so the dialog on a locale's pages is answered from that locale's docs. Every endpoint it writes has a rate limit keyed on the client IP header the host sets (10 questions and 60 tool calls a minute), a daily budget of 500 questions and 1.5 million model tokens, the answer cache, and the CORS preflight answered. The one on another origin than the pages, the GitHub Pages Worker, sends CORS headers for the site's origin only. The files are plain code you own: edit the model, the limits or the budget there.

Run it again whenever you like. Files that are already as it would write them are left alone, a file that differs is only overwritten if you say yes (or pass `--yes`), and an edit to a config file it cannot make safely, such as a `netlify.toml` that already configures the function, is printed for you to make by hand. It never deploys anything, and it reads no `.env` file or credential. `--no-mcp` leaves out the MCP endpoint, and [the CLI reference](/cli#ondocs-init) lists every flag.

## Astro with an adapter

On an Astro or Starlight site with an SSR adapter, the integration serves `POST /api/ask` and `/api/mcp` itself, with `injectRoute`, so there is no endpoint file to write or deploy. CI builds a site this way with the Node, Vercel and Cloudflare adapters and asks it questions. The routes answer from the index the build writes, which they read from the site's own static files, once per server instance (through the `ASSETS` binding on Cloudflare). Questions are embedded with the model the index records. Set `OPENAI_API_KEY` where the site builds and where it runs; `init` says so and writes nothing.

The routes have the same defaults as the files `init` writes: 10 questions and 60 tool calls a minute per visitor, by the client address the adapter reports, a daily budget of 500 questions and 1.5 million model tokens per server instance, and the answer cache. Change them with `route`, or turn the routes off with `route: false` for a route of your own:

```js
ondocs({
  route: {
    model: 'openai:gpt-5.4-mini', // or an AI Gateway id, such as 'anthropic/claude-haiku-4.5'
    rateLimit: 10,
    budget: { requestsPerDay: 500, tokensPerDay: 1_500_000 },
    mcp: '/api/mcp', // false serves no MCP endpoint
  },
});
```

A route file the site already has at `src/pages/api/ask.ts` or `src/pages/api/mcp.ts` answers instead. With `base: '/docs'`, the routes are at `/docs/api/ask` and `/docs/api/mcp`, and the dialog posts there. In `astro dev`, the routes answer from the index the last `astro build` wrote. On a Vercel preview behind Deployment Protection, the route can only read the index with the project's Protection Bypass for Automation secret, which it uses when Vercel sets `VERCEL_AUTOMATION_BYPASS_SECRET`.

## GitHub Pages and other static hosts

A host that serves only files, such as GitHub Pages, S3, Read the Docs or a plain web server, cannot run the endpoint. `init --host github-pages` writes `ondocs-worker/`, a Cloudflare Worker of its own, that answers for the site from another origin with Workers AI, so there is no API key to set (`--provider openai` answers with OpenAI instead):

- It fetches `ask-index.json` from the live site, at the site's URL from your config (or `--site-url`; init asks for it when the config has none, or a template's placeholder such as `your-docusaurus-site.example.com`), keeps it in memory, and checks it again every five minutes with a conditional request, so it follows the site's deploys without being redeployed.
- It sends CORS headers for the site's origin, and only for it, so other sites' pages cannot spend your model budget through their visitors' browsers.
- The MCP endpoint's results link to the pages on the site, not on the Worker.

Deploy it with `cd ondocs-worker && npm install && npx wrangler deploy`, then set the dialog's `endpoint` (or the script tag's `data-endpoint`) to the URL Wrangler prints, plus `/api/ask`. The site keeps deploying as it does today. The same Worker is a template for `npm create cloudflare`; [Workers AI](/workers-ai) has both ways in, the models and what they cost, and how large a site fits.

The Worker uses `remoteIndex` from `ondocs/server`, which any endpoint deployed apart from its site can use: `createAskHandler({ index: remoteIndex('https://acme.github.io/docs/ask-index.json'), … })`. A check that fails keeps the index it has; only the first fetch's failure fails a request.

The first request in each Worker instance loads the index: 17 ms for this site's docs (334 chunks) and 38 ms for 1,000 chunks, in a fresh Node.js process on an Apple M1 Max. The Workers Free plan gives a request 10 ms of CPU time, with what Cloudflare calls "some built-in flexibility" for a Worker that "infrequently runs over" it, so a small site fits; a large one needs the Workers Paid plan, which allows 30 seconds by default.

## Runtimes

The handler uses Web APIs only, so it runs on Node.js, Bun, Deno, Cloudflare Workers, Vercel Functions and Netlify Functions. File-system helpers live in `ondocs/node` and are only needed at build time.

## Where the index lives

There are three ways for the endpoint to read the index:

- **Import it.** `import index from './ask-index.json'` bundles the index with the function. This is the simplest, and what a Next.js app does.
- **Read it from the build output.** A static site's function reads `build/ask-index.json` (Docusaurus), `dist/ask-index.json` (Astro; `dist/client/ask-index.json` with an adapter) or `.vitepress/dist/ask-index.json` (VitePress) with `readFile`, and the host bundles the file with the function.
- **Fetch it.** For large indexes on platforms that limit function size, or an endpoint deployed apart from its site, serve the file as a static asset and fetch it: `index: remoteIndex(url)`, which checks it again after a deploy, or a loader such as `index: () => fetch(url).then((r) => r.text())`.

A loader runs once per server instance, on the first question, and a failed load is retried on the next request. A `remoteIndex` is checked every five minutes (`revalidateSeconds`), with the file's `ETag`, so an unchanged index is never downloaded again.

## Deploy to Vercel

In a Next.js app on Vercel there is nothing to configure: the route handler is a Vercel Function, and the imported index is bundled with it.

For a static site, such as a Docusaurus or Astro site, `init` writes `api/ask.ts`. This is it without the budget, the answer cache and the comments:

```ts
// api/ask.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';

export const POST = createAskHandler({
  index: () => readFile(join(process.cwd(), 'build/ask-index.json'), 'utf8'),
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  siteName: 'Acme Docs',
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
```

Then include the index in the function's bundle with `vercel.json`: `{ "functions": { "api/ask.ts": { "includeFiles": "build/ask-index.json" } } }`. Use `dist/ask-index.json` for Astro, or `dist/client/ask-index.json` with an adapter. On Vercel, rate limits need no extra setting, because Vercel overwrites `X-Forwarded-For` with the client's IP.

## Deploy to Netlify

On Netlify, `init` writes a function at `netlify/functions/ask.mts` that rate-limits on the client IP header Netlify sets. Shortened, it is:

```ts
// netlify/functions/ask.mts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';

export default createAskHandler({
  index: () => readFile(join(process.cwd(), 'build/ask-index.json'), 'utf8'),
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  rateLimit: memoryRateLimit({
    limit: 10,
    windowMs: 60_000,
    trustedHeader: 'x-nf-client-connection-ip',
  }),
});

export const config = { path: '/api/ask' };
```

Include the index in the function's bundle with `netlify.toml`:

```toml
[functions.ask]
  included_files = ["build/ask-index.json"]
```

## Deploy to Cloudflare

On Cloudflare Pages, `init` writes a Pages Function at `functions/api/ask.ts`. It fetches the index from the site's own static assets, and reads the key from the function's environment. Shortened, it is:

```ts
// functions/api/ask.ts
import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';

const INDEX = '/ask-index.json';

let handler: ((request: Request) => Promise<Response>) | undefined;

export const onRequest: PagesFunction<{ OPENAI_API_KEY: string; ASSETS: Fetcher }> = ({
  request,
  env,
}) => {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  handler ??= createAskHandler({
    index: async () => {
      const response = await env.ASSETS.fetch(new URL(INDEX, request.url));
      if (!response.ok) throw new Error(`${INDEX}: HTTP ${String(response.status)}`);
      return response.text();
    },
    model: openai('gpt-5.4-mini'),
    embeddingModel: openai.embedding('text-embedding-3-small'),
    rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000, trustedHeader: 'cf-connecting-ip' }),
  });
  return handler(request);
};
```

For a static site on Cloudflare Workers, `init` writes `worker/ondocs.ts`, which answers `/api/ask` and `/api/mcp` and hands every other request to the static assets, and points the wrangler config's `main` at it. A Worker that already has an entry point can call its `ondocs(request, env)` from there. On Cloudflare, always rate-limit with `trustedHeader: 'cf-connecting-ip'`, as above: the default limiter reads `X-Forwarded-For`, which is not the header Cloudflare vouches for.

## Environment variables

Set your provider's key, such as `OPENAI_API_KEY`, in two places: in the build, if the build embeds the index, and in the function's runtime environment, which embeds questions and calls the model. `init` prints where each goes on your host. The key never reaches the browser: the dialog only talks to your endpoint. A plugin's build without the key writes a keyword-only index, which the endpoint answers from without embedding questions; `ondocs index` writes one with `-e none`.

## Cold starts

Loading the index is a one-time cost per server instance: about 32 ms for 1,000 chunks and 339 ms for 10,000, measured on an Apple M1 Max. After that, a query takes 0.7 ms of CPU at 1,000 chunks and about 7 ms at 10,000, so nearly all of a request's time is the embedding call and the model's answer.

## Cost

ondocs itself is free and MIT-licensed; you pay your model provider. Each answered question costs one embedding call for the question and one model call for the answer, with at most 8,000 characters of sources in (`maxContextChars`) and at most 800 tokens out (`generation.maxOutputTokens`). A follow-up that needs rewriting costs one more call, with the last three questions and answers in and at most 200 tokens out. A refused question costs the embedding call only: the model is never called. Indexing costs one embedding call per changed chunk, since unchanged chunks reuse their vectors.
