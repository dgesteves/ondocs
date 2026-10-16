---
'ondocs': minor
---

The ask endpoint and the MCP endpoint now search the same docs the same way, and one call makes both.

- `createOndocs` from `ondocs/server` returns `{ ask, mcp }` from one set of options: the same `index`, and each locale's in `indexes`, loaded once for both; the same `embeddingModel`, `retrieval` settings and hooks; and the same `siteName`. Each endpoint's own options go in `ask` (its `model`, for one) and `mcp`. The rate limit, the budget and `allowedOrigins` stay each endpoint's own, and `mcp: { embeddingModel: false }` keeps agents' searches keyword-only.
- `createMcpHandler` takes `indexes`, as `createAskHandler` does. Its `search` and `list_pages` tools then take a `locale`, and `fetch` reads a page from whichever index has it. Before, agents could search only the default locale.
- `createMcpHandler`'s `retrieval` takes the `rerank` and `retrieve` hooks, which run for each search as they do for each question, behind the same relevance gate. Before, agents' searches skipped a site's reranker.
- `createAskHandler` takes `allowedOrigins`: a list of origins, or `'*'`. Each listed origin gets CORS headers for its own origin, with `Vary: Origin`, its preflight is answered, and it can read `Retry-After` on a 429. Any other origin gets no CORS headers, as before. Before, CORS took static `headers`, which name one origin, or a wrapper of your own for several. `headers` still works.
- The MCP endpoint's CORS headers now let a browser client read `Retry-After` too.
- The Worker that `ondocs init --host github-pages` writes, and the Cloudflare template, now let the site's pages read `Retry-After`, which `useAsk` reports as a rate-limited error's `retryAfter`.
