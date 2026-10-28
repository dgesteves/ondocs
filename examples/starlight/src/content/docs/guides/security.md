---
# Generated from examples/nextjs/content/docs/security.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Rate limits and security'
description: 'Rate limiting, client IPs, CORS, prompt injection and what data leaves your servers.'
sidebar:
  order: 24
---

A public ask endpoint spends your model budget on every question, so it needs a rate limit, and it reads untrusted input on both sides: the question and your own pages. This page covers what the handler does about each.

## Add a rate limit

The handler rate-limits by default: 10 questions a minute per client IP, read from `X-Forwarded-For`, which suits Vercel. To set your own limit, or to read the IP header your platform sets, pass `rateLimit` to `createAskHandler`. `memoryRateLimit` is a token bucket per client IP, kept in the memory of one server instance:

```ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
```

A rejected request gets a 429 with `Retry-After` and `RateLimit-*` headers before any model is called, and the dialog shows "Too many questions. Try again shortly." On serverless platforms each instance counts on its own, so treat the memory limiter as a guard against one noisy client. For a limit shared by every instance and region, wrap an `@upstash/ratelimit` instance with `upstashRateLimit(new Ratelimit({ … }))`; ondocs does not depend on Upstash. Any `(request) => { success }` function works too.

## Which client IP header to trust

A rate limit is only as strong as its key. Both limiters key each request by the client IP read from one header, and only a header your platform sets on every request can be trusted: a client can send any other. By default it is the last entry of `X-Forwarded-For`. An IPv6 address is keyed by its /64, which one subscriber is usually given whole.

| Where the handler runs        | Configure                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Vercel                        | Nothing: Vercel overwrites `X-Forwarded-For` with the client IP.                               |
| Netlify                       | `trustedHeader: 'x-nf-client-connection-ip'`                                                   |
| Cloudflare                    | `trustedHeader: 'cf-connecting-ip'`                                                            |
| Fly.io                        | `trustedHeader: 'fly-client-ip'`                                                               |
| Behind your own reverse proxy | Nothing if it appends to `X-Forwarded-For`; otherwise the header it sets, such as `x-real-ip`. |

Requests without the header share one `"anonymous"` bucket. On a platform that does not set `X-Forwarded-For`, the default limiter is therefore one limit of 10 a minute for all visitors together, which errs on the side of your bill, and the handler reports the first such request to `onError` with the setting to change. Pass `rateLimit: false` only when something in front of the endpoint already limits it. `key: (request) => string` replaces the lookup, for example to limit per signed-in user.

## When the rate limiter fails

If the limiter throws, for example because Redis is unreachable, the handler fails closed: it reports the error and answers 503 without calling the model. Set `rateLimitFailure: 'open'` to keep answering during an outage and rely on your provider's spend limits instead.

## Cap the daily spend

A rate limit is per client, so many clients, or one rotating its IPs, can still run up the bill. `budget` caps the whole endpoint per UTC day, in questions and in model tokens:

```ts
export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
  budget: { requestsPerDay: 1_000, tokensPerDay: 3_000_000 },
});
```

`requestsPerDay` counts the questions that go on to retrieval and the model, and `tokensPerDay` the model's input and output tokens, from each answer's `usage`. Before the model is called, the answer's worst case (its prompt plus `maxOutputTokens`) is reserved, and the answer goes ahead only if that fits; once it ends, the reservation is corrected to what it really used. So concurrent answers cannot overshoot the cap. An answer the model fails before it writes a word, from a bad key, a quota, an outage or a timeout, gives its reservation back, so an outage does not use up the day's budget; one the visitor abandons keeps it. Once the day's budget is spent, questions get a 429 with code `budget_exceeded` until midnight UTC, and the dialog says the assistant has reached its daily limit.

The counts are kept in memory by default, so on a serverless platform each instance has its own budget. For one budget shared by every instance, pass `store: upstashBudgetStore(Redis.fromEnv())` with `@upstash/redis`. Either way, also set a monthly spend limit with your model provider: it is the only hard cap.

## Check for bots

A fleet of addresses gets past a per-client rate limit, and can use up the day's budget before your readers ask anything. `challenge: turnstile({ secretKey })` has each question carry a Cloudflare Turnstile token, which the dialog solves, invisibly for most visitors, and the endpoint checks before it spends anything. See [Bot check with Turnstile](/guides/bot-challenge/). For a widget that lists several hostnames, `turnstile({ secretKey, hostnames: ['docs.example.com'] })` also checks where each token was solved, and refuses one from any other hostname with `challenge_failed`.

## Cache repeated questions

`answerCache: true` answers a question asked again from memory, without embedding it or calling the model, so the questions everyone asks cost nothing after the first time. Questions match when they are the same apart from case, spacing and trailing punctuation, and the cache starts fresh when the index is rebuilt. `{ store: upstashAnswerCache(Redis.fromEnv()) }` shares it between instances.

## Cross-origin requests

The endpoint only accepts `application/json` bodies and answers anything else with a 415. Browsers send a cross-origin JSON POST only after a CORS preflight, which fails unless you allow the origin, so another site cannot make its visitors' browsers spend your model budget. To call the endpoint from another origin on purpose, list it in the handler's `allowedOrigins`, as `allowedOrigins: ['https://blog.example.com']`, and in Next.js also `export const OPTIONS = POST`.

Each listed origin gets `access-control-allow-origin` with its own origin and `vary: origin`, its preflight is told it may post JSON, and the dialog on it can read `Retry-After` when a question is rate-limited. Any other origin gets no CORS headers. Its requests are still answered, so the site's own pages and clients outside a browser are never turned away, but a browser on it cannot get past the preflight. `'*'` allows every origin, and every site's visitors can then spend your budget. [This site's endpoint](https://github.com/dgesteves/ondocs/blob/main/examples/nextjs/lib/ask-handler.ts) lists its three live demos this way. When the pages on the other origin are a copy of the site's, `sourceUrls` sends the citations to their own pages; see [The ask dialog](/reference/ask-dialog/#citations-and-navigation).

## MCP on a private network

The [MCP endpoint](/integrations/mcp/) answers any `Origin` by default, with CORS headers for none, and with `allowedOrigins` it refuses the origins it does not list. A page on another site can still reach docs served on an intranet or on your machine through DNS rebinding: a name of its own that it points at the server's address. Its requests then carry that name as `Host`, and as `Origin`, which reads as the endpoint's own. `allowedHosts: ['docs.internal.example']` on `createMcpHandler` answers only requests for the hosts it lists, and gives any other a 403. Set `siteUrl` too, or result URLs are built from `Host`. `ondocs dev` checks `Host` by itself.

## Input limits

Questions are limited to 500 characters (`maxQuestionLength`), and request bodies to 64 KiB (`maxBodyBytes`), counted while the body is read so a chunked upload cannot exhaust memory. The body is validated with zod, and malformed requests get a 400 with a JSON error.

## Prompt injection

Sources and the question reach the model verbatim, inside tags that end in a random suffix drawn per request, such as `<sources-3f9a…>`. No text on your site or in a question can close the sources block or pose as the question, however it spells a tag, and the instructions tell the model to treat both as data. That stops injected text from forging structure, not from being read: index only content you trust.

Text a reader never sees is the easiest to slip past a review of the rendered page, so the HTML loader leaves out elements hidden from readers: those with the `hidden` attribute, or an inline `display: none` or `visibility: hidden`. It keeps the inactive tabs' panels, `hidden="until-found"` and what a collapsed `<details>` holds, which readers open, and `aria-hidden` text, which sighted readers see. The Markdown loader indexes the text of raw HTML in a page, hidden or not, so review raw HTML in the source.

## How answers are rendered

The answer is rendered from a small Markdown subset into React nodes, never as HTML. Links are allow-listed to http(s), mailto and relative URLs, and `[n]` becomes a link only if the server actually sent source `n`. By default (`links: 'sources'`), a link in an answer stays a link only when it points at one of the answer's source pages, at any anchor, so a model talked into it cannot show visitors another site's login page; any other link shows as its text. `links: 'all'` (`data-links="all"` on the script tag) keeps every allow-listed link, and opens other sites' in a new tab. Up to ondocs 0.15 that was the default: set it to keep answers' links to pages they do not cite. Model errors are masked in the stream, so provider details never reach the browser, and reported to `onError`.

## Pin the script tag

`ondocs@0.16` in the script tag's URL follows that minor version's patches, so a new patch reaches your pages without a change on your side. In production, pin an exact version and check both files with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity): the browser then runs them only if they are the bytes you checked. `integrity` covers `embed.global.js`, and `data-dialog-integrity` (read from ondocs 0.16 on) the dialog's file, `embed-dialog.global.js`, which the script adds to the page when the dialog is first wanted:

```html
<script
  src="https://cdn.jsdelivr.net/npm/ondocs@0.16.0/dist/embed.global.js"
  integrity="sha384-…"
  data-dialog-integrity="sha384-…"
  crossorigin="anonymous"
  data-endpoint="/api/ask"
  defer
></script>
```

Get the two hashes for the version you pin:

```sh
for file in embed.global.js embed-dialog.global.js; do
  hash=$(set -o pipefail; curl -fsSL "https://cdn.jsdelivr.net/npm/ondocs@0.16.0/dist/$file" | openssl dgst -sha384 -binary | openssl base64 -A) || break
  echo "$file sha384-$hash"
done
```

A version that does not exist stops it with curl's error, rather than hashing jsDelivr's error page.

`crossorigin="anonymous"` is required: a browser checks a script from another origin only when it fetches it with CORS, which jsDelivr allows. The dialog's file is fetched the same way. Each release is also published to npm with a provenance attestation, which `npm view ondocs dist.attestations` points to: it says which commit and workflow built each version.

## Content-Security-Policy

On a page with a Content-Security-Policy, the dialog needs:

| Directive                 | Add                                 | For                                                                                                                               |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`              | `https://cdn.jsdelivr.net`          | The script tag, when it loads from jsDelivr.                                                                                      |
| `connect-src`             | The endpoint's origin               | The questions, when the endpoint is on another origin than the page.                                                              |
| `style-src`               | `'unsafe-inline'`                   | The `<style>` elements the script tag adds for the button and the dialog, and the dialog's scroll lock adds with any integration. |
| `script-src`, `frame-src` | `https://challenges.cloudflare.com` | Turnstile's script and frame, with a [bot check](/guides/bot-challenge/).                                                         |

For a page that loads the script tag from jsDelivr, asks an endpoint on another origin, and checks for bots:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com; connect-src 'self' https://ask.example.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com
```

The dialog runs no inline script and no `eval`, so `script-src` needs neither `'unsafe-inline'` nor `'unsafe-eval'`.

## Privacy: what leaves your servers

ondocs has no service of its own and sends no telemetry, so no third party sees your docs or your visitors' questions except the model provider you choose. The browser sends questions only to your endpoint. It also loads the script tag's files from jsDelivr when you use the script tag from its CDN, and Turnstile's script and frame from Cloudflare when the dialog has a `challenge`; neither gets the questions. Your endpoint sends the question to your embedding provider, and the question with the retrieved excerpts to your language model provider, under your own API keys and their terms. Nothing else is sent anywhere. `onFinish` gives you each question and answer, and `onFeedback` each rating, if you want to log them; nothing is stored by default, and the dialog offers ratings only when `onFeedback` is set. See [Measure and improve answers](/guides/quality/).
