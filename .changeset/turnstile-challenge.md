---
'ondocs': minor
---

An optional bot check for the ask endpoint, with Cloudflare Turnstile, off by default. `createAskHandler` takes `challenge: turnstile({ secretKey })`, with `turnstile` from `ondocs/server`. Each question must then carry a Turnstile token as `challenge` in its body, which the endpoint checks with Turnstile's siteverify after the rate limit and before the answer cache, the embedding and the model. A question without a token gets a 403 with code `challenge_required`, and one with a bad or used token a 403 with `challenge_failed`. When Turnstile cannot be reached, the endpoint answers 503, or answers anyway with `rateLimitFailure: 'open'`. Feedback posts and the MCP endpoint are not checked.

The dialog solves the check with `challenge: { turnstile: '<site key>' }`: on `AskDialog`, `mountAskDialog`, and the `dialog` options of the Docusaurus, Astro, Starlight and VitePress plugins, or with `data-turnstile-site-key` on the script tag. When the dialog opens, it loads Turnstile's script from challenges.cloudflare.com and solves a token, invisibly unless Turnstile asks the visitor to click, and it sends a fresh token with each question. Pages load nothing of Turnstile until then. Two new labels, `challengeRequired` and `challengeFailed`, say when the check did not load or failed. `useAsk` takes `challengeToken`, for a widget of your own.

The Astro integration's own ask route checks tokens when `dialog.challenge.turnstile` is set, with the secret in `TURNSTILE_SECRET_KEY`. The endpoints `ondocs init` writes, and the Cloudflare Worker template, turn the check on once `TURNSTILE_SECRET_KEY` is set.
