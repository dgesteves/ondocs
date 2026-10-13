---
title: Rate limits and security
description: Rate limiting, client IPs, CORS, prompt injection and what data leaves your servers.
section: Guides
group: Deploy & operate
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

`requestsPerDay` counts the questions that go on to retrieval and the model, and `tokensPerDay` the model's input and output tokens, from each answer's `usage`. Before the model is called, the answer's worst case (its prompt plus `maxOutputTokens`) is reserved, and the answer goes ahead only if that fits; once it ends, the reservation is corrected to what it really used. So concurrent answers cannot overshoot the cap. Once the day's budget is spent, questions get a 429 with code `budget_exceeded` until midnight UTC, and the dialog says the assistant has reached its daily limit.

The counts are kept in memory by default, so on a serverless platform each instance has its own budget. For one budget shared by every instance, pass `store: upstashBudgetStore(Redis.fromEnv())` with `@upstash/redis`. Either way, also set a monthly spend limit with your model provider: it is the only hard cap.

## Check for bots

A fleet of addresses gets past a per-client rate limit, and can use up the day's budget before your readers ask anything. `challenge: turnstile({ secretKey })` has each question carry a Cloudflare Turnstile token, which the dialog solves, invisibly for most visitors, and the endpoint checks before it spends anything. See [Bot check with Turnstile](/docs/bot-challenge).

## Cache repeated questions

`answerCache: true` answers a question asked again from memory, without embedding it or calling the model, so the questions everyone asks cost nothing after the first time. Questions match when they are the same apart from case, spacing and trailing punctuation, and the cache starts fresh when the index is rebuilt. `{ store: upstashAnswerCache(Redis.fromEnv()) }` shares it between instances.

## Cross-origin requests

The endpoint only accepts `application/json` bodies and answers anything else with a 415. Browsers send a cross-origin JSON POST only after a CORS preflight, which fails unless you allow the origin, so another site cannot make its visitors' browsers spend your model budget. To call the endpoint from another origin on purpose, set `access-control-allow-origin` and `access-control-allow-headers: content-type` in the handler's `headers` option, and in Next.js also `export const OPTIONS = POST`.

`headers` is the same for every request, and `access-control-allow-origin` names one origin. For several, wrap the handler and add the headers for the request's origin when it is one of yours, with `vary: origin`; [this site's route](https://github.com/dgesteves/ondocs/blob/main/examples/nextjs/app/api/ask/cors.ts) does that for its live demos. Add `access-control-expose-headers: retry-after` for the dialog to read a rate limit's wait. When the pages on the other origin are a copy of the site's, `sourceUrls` sends the citations to their own pages; see [The ask dialog](/docs/ask-dialog#citations-and-navigation).

## Input limits

Questions are limited to 500 characters (`maxQuestionLength`), and request bodies to 64 KiB (`maxBodyBytes`), counted while the body is read so a chunked upload cannot exhaust memory. The body is validated with zod, and malformed requests get a 400 with a JSON error.

## Prompt injection

Sources and the question reach the model verbatim, inside tags that end in a random suffix drawn per request, such as `<sources-3f9a…>`. No text on your site or in a question can close the sources block or pose as the question, however it spells a tag, and the instructions tell the model to treat both as data. That stops injected text from forging structure, not from being read: index only content you trust.

## How answers are rendered

The answer is rendered from a small Markdown subset into React nodes, never as HTML. Links are allow-listed to http(s), mailto and relative URLs, and `[n]` becomes a link only if the server actually sent source `n`. If your pages could carry injected text, set the dialog's `links: 'sources'` (`data-links="sources"` on the script tag): links in an answer then stay links only when they point at one of its source pages, so a model talked into it cannot show visitors another site's login page. Model errors are masked in the stream, so provider details never reach the browser, and reported to `onError`.

## Privacy: what leaves your servers

ondocs has no service of its own and sends no telemetry, so no third party sees your docs or your visitors' questions except the model provider you choose. The browser talks only to your endpoint. Your endpoint sends the question to your embedding provider, and the question with the retrieved excerpts to your language model provider, under your own API keys and their terms. Nothing else is sent anywhere. `onFinish` gives you each question and answer, and `onFeedback` each rating, if you want to log them; nothing is stored by default, and the dialog offers ratings only when `onFeedback` is set. See [Measure and improve answers](/docs/quality).
