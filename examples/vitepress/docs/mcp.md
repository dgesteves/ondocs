---
# Generated from examples/nextjs/content/docs/mcp.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'MCP server'
description: 'Serve the same index to coding agents and AI apps as an MCP server, with search and fetch tools, and no model call on your side.'
---

# MCP server

The index that the Ask box answers from can also be served to agents, such as Claude Code, Codex, Gemini CLI, Cursor, VS Code, ChatGPT and Claude, as an MCP server. `createMcpHandler` from `ondocs/server` serves it with three read-only tools: `search`, `fetch` and `list_pages`. The agent brings its own model: the endpoint never calls a language model, and with no embedding model, it calls no model at all.

This site serves its own docs this way, at `https://ondocs.vercel.app/api/mcp`. To try it in Claude Code:

```sh
claude mcp add --transport http ondocs https://ondocs.vercel.app/api/mcp
```

In Codex:

```sh
codex mcp add ondocs --url https://ondocs.vercel.app/api/mcp
```

That writes this entry to `~/.codex/config.toml`, where you can also add it yourself:

```toml
[mcp_servers.ondocs]
url = "https://ondocs.vercel.app/api/mcp"
```

In Gemini CLI, pass `--transport http`. Without it, Gemini CLI takes the URL for a command to run, and the server shows as disconnected:

```sh
gemini mcp add --transport http --scope user ondocs https://ondocs.vercel.app/api/mcp
```

Or add the same entry to `~/.gemini/settings.json`, or to `.gemini/settings.json` for one project:

```json
{
  "mcpServers": {
    "ondocs": {
      "type": "http",
      "url": "https://ondocs.vercel.app/api/mcp"
    }
  }
}
```

Gemini CLI turns off every MCP server, user-level ones included, in a folder you have not trusted, so trust the folder you run it in.

Or add it to [Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=ondocs&config=eyJ1cmwiOiJodHRwczovL29uZG9jcy52ZXJjZWwuYXBwL2FwaS9tY3AifQ%3D%3D), [VS Code](vscode:mcp/install?%7B%22name%22%3A%22ondocs%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fondocs.vercel.app%2Fapi%2Fmcp%22%7D) or [Claude](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=ondocs&connectorUrl=https%3A%2F%2Fondocs.vercel.app%2Fapi%2Fmcp), or in ChatGPT, add a custom MCP server with that URL at chatgpt.com/plugins.

The endpoint speaks Streamable HTTP only, so choose `http` in a client, not `sse`. A client set to the older SSE transport opens with a GET, which the endpoint answers with a 405, and it cannot connect.

## Mount the endpoint

It is a Web-standard `(Request) => Promise<Response>`, like the ask endpoint, and it mounts the same way. In a Next.js app, `app/api/mcp/route.ts`:

```ts
// app/api/mcp/route.ts
import { createMcpHandler } from 'ondocs/server';
import index from '../../../ask-index.json';

const handler = createMcpHandler({ index, siteName: 'the Acme docs' });

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

Pass the same imported `index` to `createAskHandler` and `createMcpHandler`, and it is loaded into memory once for both. MCP clients send JSON-RPC with POST. The handler answers GET and DELETE with a 405, as a server without sessions does, and OPTIONS for browser clients.

For a static site, `npx ondocs init` writes it next to the ask endpoint: `api/mcp.ts` on Vercel, `netlify/functions/mcp.mts` on Netlify, `functions/api/mcp.ts` on Cloudflare Pages, or `/api/mcp` in the Worker it writes for a Cloudflare Worker or a GitHub Pages site, each rate-limited on the host's client IP header. On an Astro site with an SSR adapter, the integration serves `/api/mcp` itself. See [Deploying](/deployment#write-the-endpoint-with-init).

## The tools

| Tool         | Input                                          | Returns                                                                                                                                                                                        |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`     | `query`: keywords or a short question          | Up to 8 sections, best first, each with an `id`, the page `title`, the section's `heading` path, its absolute `url` with the anchor, and `text`, a snippet of the part that matches the query. |
| `fetch`      | `id`: an id from `search`, or a page URL       | The page as Markdown, or with an `#anchor`, that section. A page over 60,000 characters is cut, and the sections to fetch for the rest are listed.                                             |
| `list_pages` | `prefix` (optional): a path, as `/docs/guides` | Every page's `id`, `title` and `url`, or those under the prefix, up to 500.                                                                                                                    |

Results come back as structured content, and as the same JSON in a text block for clients that read only text. That is the shape ChatGPT's connectors and deep research expect from `search` and `fetch`. `fetch` also takes a URL as an agent might write it: absolute, with a trailing slash, ending in `.md`, or with its anchor percent-encoded, as `#configura%C3%A7%C3%A3o` for `#configuração`. A page or tool that does not exist is an error the agent reads, with what to try instead.

## Keyword-only or hybrid search

Without an `embeddingModel`, `search` matches on keywords (BM25), and agent traffic costs you no model call of any kind. Keyword search finds a page best when the query uses the page's own words. On docusaurus.io's own docs (92 pages, 1,070 chunks), 22 agent-style queries written for this test in the docs' terms ("autogenerated sidebar from folder", "configureWebpack") have the right page in the top three for all 22, and first for 19. The same 22 questions, asked as a person asks ("How do I add a tip or warning callout box?"), have it in the top three for 20. The project wrote both sets knowing the docs, so these counts are a best case: a question in a reader's own words, which shares fewer words with the page, finds it less often. CI checks the counts on every change, in [`test/corpus.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/corpus.test.ts).

With `embeddingModel`, each search also embeds its query, one embedding call at your provider's price, and merges both rankings as the ask endpoint does. That helps queries that share no words with the page. It must be the model the index was built with. If the provider fails, that search falls back to keywords.

```ts
const handler = createMcpHandler({
  index,
  embeddingModel: openai.embedding('text-embedding-3-small'),
});
```

## Limits

- **Rate limit.** 60 tool calls a minute per client IP by default, per server instance, keyed as the ask endpoint's are (see [which client IP header to trust](/security#which-client-ip-header-to-trust)). Discovery and listing the tools are not counted. Hosted clients, ChatGPT and claude.ai, call from their own servers, so their users share a few IPs; raise the limit if many people use your docs from them.
- **Budget.** `budget: { requestsPerDay }` caps tool calls a day for the whole endpoint, apart from the ask endpoint's budget. There is no token budget, as nothing generates tokens.
- **Size.** Bodies over 64 KiB get a 413 while they are read, and queries over 500 characters an error.

## Protocol versions

The endpoint speaks MCP 2026-07-28, where every request names its version and there is no session, and, for clients that still start with `initialize`, 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05, answered without a session. Claude Code's newer runtime asks for 2026-07-28 first, with `server/discover`. Cursor and VS Code start with `initialize`. Both ways are tested with the official MCP TypeScript client, and against the official conformance suite's scenarios that apply to a tools-only server.

Browsers on other sites get no CORS headers, so they cannot read the answers. Requests are answered whatever their `Origin`, because hosted clients send one from their servers. `allowedOrigins: ['https://app.example.com']` turns on MCP's origin check: requests from any other origin get a 403, and the listed ones get CORS headers.

## Tested clients

| Client                                                          | Version                      | Protocol it used                                                    | Checked                                                                |
| --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Official MCP TypeScript client (`@modelcontextprotocol/client`) | 2.3.1, on every change in CI | 2026-07-28 with `server/discover`, and 2025-11-25 with `initialize` | Connects, lists the tools, searches and fetches                        |
| Codex                                                           | 0.163.0                      | 2025-06-18                                                          | Connects and lists the tools when a session starts                     |
| Gemini CLI                                                      | 0.64.0                       | 2025-06-18                                                          | `gemini mcp list` shows it connected, with `--transport http`          |
| MCP TypeScript SDK (`@modelcontextprotocol/sdk`)                | 1.32.1                       | 2025-11-25                                                          | Connects, lists the tools, searches, and fetches a search result's URL |
| MCP Python SDK (`mcp`)                                          | 1.30.0 and 2.3.0             | 2025-11-25                                                          | The same                                                               |
| OpenAI Agents SDK (Python)                                      | 0.24.0                       | 2026-07-28 with `server/discover`                                   | The same                                                               |
| LangChain MCP adapters (`langchain-mcp-adapters`)               | 0.3.2                        | 2025-11-25                                                          | The same                                                               |

CI runs the first row on every change, in [`test/mcp-client.test.ts`](https://github.com/dgesteves/ondocs/blob/main/test/mcp-client.test.ts). The others were run by hand in October 2026, against a local `createMcpHandler` serving this site's docs, and CI does not re-run them. Codex and Gemini CLI were not given a model, so they made no tool calls. Claude Code, Cursor and VS Code are not in the table: they were not run for it.

## Show it on your site

Give the plugin the endpoint's URL with `mcp`, and a page can show how to add it to Cursor, VS Code, Claude, Claude Code, Codex, Gemini CLI and ChatGPT:

- **Docusaurus:** `['ondocs/docusaurus', { mcp: '/api/mcp' }]`, then in an MDX page, `import OndocsMcp from '@theme/OndocsMcp'` and `<OndocsMcp />`.
- **Astro and Starlight:** `ondocs({ mcp: '/api/mcp' })`, with `site` set, then in an MDX page, `import McpInstall from 'ondocs/astro/McpInstall.astro'` and `<McpInstall />`. With an SSR adapter and `site` set, the MCP route the integration serves is the default.
- **VitePress:** `withOndocs(config, { mcp: '/api/mcp' })`, with `sitemap.hostname` set, points `llms.txt` at it; for the links on a page, use `mcpInstallLinks` below.
- **React:** `<McpInstall url="https://docs.example.com/api/mcp" name="acme-docs" />` from `ondocs/react`.
- **Anything else:** `mcpInstallLinks({ url, name })` from `ondocs` returns the Cursor and VS Code install links, the claude.ai link, the Claude Code, Codex and Gemini CLI commands, the TOML for Codex's `config.toml`, and the JSON for other clients.

A path is resolved against the site's URL. A URL that does not parse, such as the Worker's with `<your-subdomain>` left in, stops the build. The name defaults to the site title, as `acme-docs`. The URL also goes into [`llms.txt`](/llms-txt), for agents that start there. `npx ondocs init` says which `mcp` to set for the endpoint it writes.

## Try it locally

`npx ondocs dev` serves the index at `http://localhost:8787/api/mcp` as well as the ask endpoint, keyword-only, with the same origin and host checks, and prints the commands that add it to Claude Code, Codex and Gemini CLI:

```sh
npx ondocs dev
claude mcp add --transport http docs http://localhost:8787/api/mcp
```

## Handler options

| Option                     | Default            | Notes                                                                                                                             |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `index`                    | required           | As for `createAskHandler`. The same imported object as the ask endpoint's is loaded once.                                         |
| `embeddingModel`           | none               | Embeds each search query. Without it, search is keyword-only and no model is called.                                              |
| `embeddingProviderOptions` | none               | As for `createAskHandler`.                                                                                                        |
| `siteName`                 | `"this site"`      | Names the docs in the tools' descriptions, which the agent reads.                                                                 |
| `siteUrl`                  | the request's      | The origin to make URLs absolute with, when the endpoint runs on another host. `false` keeps the index's URLs.                    |
| `name`, `instructions`     | `ondocs`           | The server's name, and what it tells the agent about using the tools.                                                             |
| `version`                  | ondocs's version   | The server's version beside its `name`, such as your docs'. A server named after your docs reports their version, not ondocs's.   |
| `retrieval`                | keyword gate `0.3` | Retrieval settings for `search`; it keeps sections with at least 30% of the query's keyword weight, looser than the ask endpoint. |
| `rateLimit`                | 60 a minute per IP | Any limiter, or `false`. `rateLimitFailure` works as for `createAskHandler`.                                                      |
| `budget`                   | none               | `{ requestsPerDay, store }`: tool calls a day.                                                                                    |
| `allowedOrigins`           | none               | A list of origins, or `'*'`, to check `Origin` and send CORS headers.                                                             |
| `maxQueryLength`           | `500`              | Longest search query, in characters.                                                                                              |
| `maxBodyBytes`             | 64 KiB             | Counted while reading.                                                                                                            |
| `onToolCall`               | none               | `{ tool, arguments, isError, results, retrieval, durationMs }` after each call, to count agent traffic.                           |
| `onError`                  | `console.error`    | Handled errors: embedding fallbacks, a failing limiter, a misconfigured index.                                                    |
