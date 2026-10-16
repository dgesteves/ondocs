---
# Generated from examples/nextjs/content/docs/bot-challenge.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Bot check with Turnstile'
description: "Ask visitors' browsers to pass a Cloudflare Turnstile check before each question, so a fleet of bots cannot spend your model budget."
---

# Bot check with Turnstile

A rate limit is per client, and a daily `budget` caps the whole endpoint, but a fleet of addresses can still use up the day's budget, leaving none for your readers. A bot check stops that: the dialog gets a token from [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) before each question, and the endpoint checks the token with Cloudflare before it spends anything on the question. For most visitors the check is invisible.

It is off by default. Turn it on in two places: the dialog, with the widget's site key, and the endpoint, with its secret key.

## Create a widget

In the Cloudflare dashboard, under Turnstile, add a widget for your site's hostnames. Choose the "Invisible" widget mode: visitors see nothing. With "Managed", Turnstile sometimes asks a visitor to click a checkbox, and the dialog shows it in place. You get a site key, which is public, and a secret key, which stays on the server.

## The endpoint

Pass `challenge: turnstile({ secretKey })` to `createAskHandler`:

```ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler, turnstile } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  challenge: turnstile({ secretKey: process.env.TURNSTILE_SECRET_KEY! }),
});
```

Each question must then carry a token, as `challenge` in its JSON body. The endpoint checks it after the rate limit and before anything else: before the answer cache, the embedding and the model.

| Request                                             | Response                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| No token                                            | 403, code `challenge_required`                                        |
| A token Turnstile rejects (bad, used, expired)      | 403, code `challenge_failed`                                          |
| Turnstile cannot be reached, or the secret is wrong | 503, reported to `onError`; with `rateLimitFailure: 'open'`, answered |
| A good token                                        | the answer                                                            |

A token is good for one question and five minutes. Ratings sent to `onFeedback` need no token: they cost nothing.

The endpoints `ondocs init` writes turn the check on by themselves once `TURNSTILE_SECRET_KEY` is set where they run, and so does the [Cloudflare Worker template](/workers-ai): `npx wrangler secret put TURNSTILE_SECRET_KEY`.

## The dialog

Give the dialog the widget's site key with `challenge: { turnstile: '<site key>' }`, wherever you set its options:

```ts
// docusaurus.config.ts
plugins: [['ondocs/docusaurus', { dialog: { challenge: { turnstile: '0x4AAAAAAA…' } } }]],
// astro.config.mjs, for Astro, and for Starlight in its plugins
ondocs({ dialog: { challenge: { turnstile: '0x4AAAAAAA…' } } }),
// .vitepress/config.mts
export default withOndocs(defineConfig({ … }), { dialog: { challenge: { turnstile: '0x4AAAAAAA…' } } });
```

```tsx
// React
<AskDialog launcher challenge={{ turnstile: '0x4AAAAAAA…' }} />
```

```html
<!-- The script tag -->
<script
  src="https://cdn.jsdelivr.net/npm/ondocs@0.12/dist/embed.global.js"
  data-endpoint="/api/ask"
  data-turnstile-site-key="0x4AAAAAAA…"
  defer
></script>
```

When the dialog opens, it loads Turnstile's script from `challenges.cloudflare.com` and solves a token, so the first question rarely waits for one. It sends a fresh token with each question and solves the next one meanwhile. Pages load nothing of Turnstile until the dialog is opened, and nothing at all without `challenge`.

If Turnstile's script cannot load, the question goes without a token and the dialog says the check did not load, in the words of its `challengeRequired` label; a rejected token shows `challengeFailed`. Both are labels like the others, for your language.

A site with a Content-Security-Policy must allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`.

## Astro and Starlight

When the integration serves the endpoint itself, setting `dialog.challenge.turnstile` turns the check on there too. The route reads the secret from `TURNSTILE_SECRET_KEY` through `astro:env`; without it, questions get a 503 and the server log says why.

## Your own client

With `useAsk`, pass `challengeToken`: a function that returns a fresh token before each question, from a Turnstile widget you render yourself. A plain `useChat` client sends no token, so it cannot ask an endpoint with `challenge` set.

## Agents and MCP

The [MCP endpoint](/mcp) is not checked: agents cannot solve a challenge, and their searches are keyword-only, so they call no model. It keeps its own rate limit, `rateLimit` on `createMcpHandler`.

## Testing

Cloudflare's test keys work on any hostname, `localhost` included, and always give the same result. The site key `1x00000000000000000000BB` always passes, invisibly, and `2x00000000000000000000BB` always fails. The secret key `1x0000000000000000000000000000000AA` accepts their token, `2x0000000000000000000000000000000AA` rejects it, and `3x0000000000000000000000000000000AA` says it was used before. Test secret keys accept only the test token, and real ones reject it, so use test keys on both sides in development.
