---
# Generated from examples/nextjs/content/docs/ask-endpoint.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'The ask endpoint'
description: 'createAskHandler options, the request and response, errors and the streaming protocol.'
---

# The ask endpoint

`createAskHandler(options)` from `ondocs/server` returns the endpoint: a function that takes a Web `Request` and returns a `Promise<Response>`. It runs in Next.js route handlers, Hono, Bun, Deno, Cloudflare Workers and Vercel or Netlify Functions.

## What happens per request

1. The body must be JSON (`content-type: application/json`); anything else gets a 415.
2. The rate limiter runs: 10 questions a minute per client IP unless you pass your own, or `false`.
3. The body is validated: `{ "question": string }` of up to 500 characters, or the conversation as `{ messages }`, in at most 64 KiB.
4. With `challenge`, the question's [bot check](/bot-challenge) token is checked with Turnstile, and a question without a good one gets a 403.
5. A follow-up that does not stand on its own is rewritten into a question that does, with one short model call, and counts against the `budget` first. Everything after works from the rewritten question.
6. With `answerCache`, a question asked before is answered from the cache, and nothing else runs.
7. With `budget`, the question counts against the day's questions.
8. The question is embedded, and hybrid retrieval runs over the in-memory index.
9. If nothing clears the relevance gate, the "I don't know" message streams back and the model is never called.
10. Otherwise the top sources are numbered and, if the answer's worst case fits in the day's token `budget`, sent to the model with grounding instructions, and the answer streams back with its citations.

## Handler options

| Option                     | Default                     | Notes                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`                    | required                    | Parsed JSON, its text, a `loadIndex` result, a function returning one, or a `remoteIndex(url)`, which is checked again every five minutes. Loaded once; a failed load is retried.                                                                                                     |
| `indexes`                  | none                        | The index of each other locale, by the locale the dialog sends: `{ fr: () => readFile('build/fr/ask-index.json', 'utf8') }`.                                                                                                                                                          |
| `model`                    | required                    | Any AI SDK language model, or an AI Gateway model id.                                                                                                                                                                                                                                 |
| `embeddingModel`           | none                        | Must match the index, which is checked. Without it, retrieval is keyword-only.                                                                                                                                                                                                        |
| `embeddingProviderOptions` | none                        | Must match the build, such as `{ openai: { dimensions: 512 } }`.                                                                                                                                                                                                                      |
| `siteName`                 | `"this site"`               | Used in the instructions and the "I don't know" message.                                                                                                                                                                                                                              |
| `instructions`             | grounded defaults           | A string, or `(defaults) => string` to extend them.                                                                                                                                                                                                                                   |
| `retrieval`                | tuned                       | `{ topK, candidates, rrfK, minSimilarity, minKeywordCoverage, similarityNeedsKeyword, maxContextChars }`, and the [`rerank` and `retrieve` hooks](/retrieval#rerank-or-retrieve-your-own-way). `maxContextChars`, default 8000, caps the characters of source text sent to the model. |
| `maxQuestionLength`        | `500`                       | Longer questions get a 400.                                                                                                                                                                                                                                                           |
| `maxBodyBytes`             | 64 KiB                      | Counted while reading the body.                                                                                                                                                                                                                                                       |
| `noAnswerMessage`          | "I don't know. I couldn't…" | Streamed when nothing is relevant.                                                                                                                                                                                                                                                    |
| `rateLimit`                | 10 a minute per IP          | `memoryRateLimit()`; any `(request) => { success, … }` replaces it, and `false` turns it off.                                                                                                                                                                                         |
| `rateLimitFailure`         | `"closed"`                  | When `rateLimit` throws: `"closed"` answers 503, `"open"` answers anyway.                                                                                                                                                                                                             |
| `challenge`                | none                        | `turnstile({ secretKey })`: a [bot check](/bot-challenge) on each question, before anything is spent on it. A 403 without a good token.                                                                                                                                               |
| `generation`               | `{ maxOutputTokens: 800 }`  | Passed to `streamText`: `temperature`, `providerOptions`, `timeout`, `telemetry`… `timeout` defaults to 30 s for the first word and 90 s in all; your own replaces both.                                                                                                              |
| `budget`                   | none                        | `{ requestsPerDay, tokensPerDay, store }`: a daily cap, then a 429 with code `budget_exceeded`.                                                                                                                                                                                       |
| `answerCache`              | off                         | `true`, or `{ store, ttlSeconds }`: repeated questions are answered from the cache.                                                                                                                                                                                                   |
| `followUps`                | on                          | `{ model, always, maxTurns, instructions }` for rewriting follow-ups; `false` answers every question on its own.                                                                                                                                                                      |
| `headers`                  | none                        | Added to every response, such as CORS headers.                                                                                                                                                                                                                                        |
| `onFeedback`               | none                        | Called with a reader's rating of an answer; with it, the dialog offers thumbs up and down and a comment.                                                                                                                                                                              |
| `onFinish`                 | none                        | Called after each answer with `{ id, question, answer, sources, refused, lowConfidence, retrieval, usage, followUp }`.                                                                                                                                                                |
| `onError`                  | `console.error`             | Handled errors: embedding fallbacks, model failures, a failing limiter, misconfiguration.                                                                                                                                                                                             |

## Logging questions and answers

`onFinish` runs once per answered request, after the answer has streamed, with the answer's `id`, the question, the answer, its sources, whether it was refused, whether the model cited none of its sources (`lowConfidence`) and the token usage. Use it to log the questions your docs don't answer, as in [Measure and improve answers](/quality#questions-your-docs-do-not-answer), or to send analytics. If it throws, the error goes to `onError`, and the answer the visitor got is unaffected.

## Feedback

With `onFeedback`, the stream's metadata says `feedback: true`, and the dialog offers a rating under each answer. It posts `{ "feedback": { "rating": "up" | "down", "comment"?, "id", "question", "answer", "sources" } }` to the endpoint, which hands it to `onFeedback` and answers 204; a comment comes as a second post with the same `id`. The rating goes through the rate limit, costs no model call, and gets a 400 without `onFeedback`, or a 503 if `onFeedback` throws.

## Request body

Send `{ "question": "…" }` as `application/json` for a question on its own, or the conversation as `{ messages }`, as the dialog and the AI SDK's `useChat` send it: the last user message is the question, and the messages before it are the conversation. Either can carry the page's `locale`, which the plugins and the dialog send on a page in a locale other than the default: the handler answers it from `indexes[locale]`, and from `index` for a locale it has no index for. With `challenge`, either must also carry the [bot check](/bot-challenge)'s token as `challenge`.

## Follow-up questions

A follow-up such as "and on Netlify?" leans on the conversation, and searched on its own it finds the wrong pages or none. So before retrieval, the handler rewrites it into a question that stands on its own ("How do I deploy the endpoint to Netlify?") with one short call to the model: the last three questions and their answers in, at most 200 tokens out, with minimal reasoning. Retrieval, the relevance gate, the answer cache and the answer then work from the rewritten question, and each answer cites only its own sources.

A question that already stands on its own is not rewritten, so it costs nothing extra. That check reads English: it looks for at least four words and none that point back, such as "it", "that" or "there". For a site whose visitors ask in other languages, `followUps: { always: true }` rewrites every question asked after another. `followUps.model` makes the rewrites with a smaller model than the answers, and `followUps: false` answers every question on its own.

The rewrite counts against the `budget`: the question is admitted before it, and its tokens are reserved and settled like the answer's. If the rewrite fails, or takes longer than 20 seconds, the question is answered as it was asked, the rewrite's reservation is given back, and the error goes to `onError`. `onFinish` gets the rewritten question and the rewrite's usage as `followUp`.

## Errors

Errors are JSON, `{ "error": { "code", "message" } }`, with status 400 (invalid body or question), 403 (the bot check's token is missing, code `challenge_required`, or rejected, code `challenge_failed`), 405 (not a POST), 413 (body too large), 415 (not JSON), 429 (rate limited, or the daily `budget` spent, with `Retry-After`), 500 (misconfigured: an index that could not be loaded, or an embedding model that does not match it) or 503 (the rate limiter, the budget store or the bot check failed). A client that disconnects before the answer starts gets a bare 499 and is not reported as an error. Model errors during an answer are masked in the stream, so provider details never reach the browser: as `The ask endpoint is misconfigured.`, followed by a `message-metadata` part with `misconfigured: true`, when the endpoint cannot call the model as it is set up (no API key, or one the provider rejects with a 401 or a 403), and as `The answer could not be generated. Please try again.` otherwise. The dialog shows the first as `Answers aren’t set up on this site yet.`, without a Retry. It shows a 500 in the same words, but with Retry, as an index that failed to load can load on the next request: a `remoteIndex` that could not download the file tries again then. An answer the model has not begun after 30 seconds, or not finished after 90, is stopped (`generation.timeout`): the error goes to `onError`, and the dialog says the answer was cut off.

## Streaming protocol

The response is an AI SDK UI message stream over Server-Sent Events. It starts with metadata, then one `source-url` part per numbered source, then the answer text:

```
data: {"type":"start","messageMetadata":{"refused":false,"retrieval":"hybrid"}}
data: {"type":"source-url","sourceId":"1","url":"/docs/retrieval#saying-i-dont-know","title":"How retrieval works › Saying \"I don't know\""}
data: {"type":"text-delta","id":"…","delta":"When no chunk clears the gate, "}
data: {"type":"finish"}
data: [DONE]
```

Because sources arrive before the text, citations are clickable as soon as they appear. When the model's whole answer is "I don't know", the `finish` part carries the metadata again, with `refused: true`, so the dialog shows it as a refusal. The same stream works with `useChat` from `@ai-sdk/react`, and `readAskStream` from `ondocs/react` parses it without the AI SDK.

## Using it outside Next.js

The handler is the whole integration in any runtime: `app.post('/api/ask', (c) => handler(c.req.raw))` in Hono, `Bun.serve({ fetch: handler })` in Bun, `Deno.serve(handler)` in Deno, or `export default { fetch: handler }` in a Cloudflare Worker. It answers `OPTIONS` with a 204 and your `headers`, for CORS preflights.
