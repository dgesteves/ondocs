---
'ondocs': patch
---

An endpoint that cannot answer as it is set up now says so, instead of telling every reader to try again:

- When the model has no API key, or the provider rejects the key (a 401 or a 403, or AI Gateway with no key or OIDC token), the stream's error is now `The ask endpoint is misconfigured.`, followed by a `message-metadata` part with `misconfigured: true`. The dialog shows "Answers aren’t set up on this site yet." with no Retry button, where before it showed "The answer could not be generated. Please try again." with a Retry that could not fix it. The endpoint's 500 (an index it could not load, or one embedded with another model) now shows the same words, but keeps Retry: an index that failed to load, such as a `remoteIndex` the site did not serve, is loaded again on the next request. The new `errorMisconfigured` label changes the words, and `useAsk` reports both with `reason: 'misconfigured'`: the first with `kind: 'stream'`, the 500 with `kind: 'http'`. Other model failures still say to try again.
- On a page served from your machine, or in a development build, the console now says the endpoint's log has the cause of these errors and of a failed answer, with a link to Troubleshooting.
- The console's hint for a 404 now says to start the site with `ASK_ENDPOINT=http://localhost:8787/api/ask`, as the docs do, rather than to point the dialog's `endpoint` at it, which a deployed site would then post to. It links to the deployment guide instead of the README.
- `ondocs init` no longer calls `OPENAI_API_KEY` optional where one variable serves the build and the functions (Vercel, Netlify, and Next.js on any host). It says that without the key the MCP endpoint works and off-topic questions are refused, but the Ask box cannot answer, and that `init --host github-pages` answers with Workers AI and no key.
- A plugin build with `embedding: 'mock'` now says the index is for local testing only: the Vercel, Netlify and Cloudflare endpoints `init` writes refuse it with a 500, and the GitHub Pages Worker ignores its vectors.
