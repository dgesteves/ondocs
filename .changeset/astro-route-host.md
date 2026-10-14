---
'ondocs': patch
---

The ask and MCP routes that `ondocs/astro` and `ondocs/starlight` serve with the Node adapter no longer fetch the index from the first request's Host. On Astro 5 before 5.18, the adapter takes that from the Host or X-Forwarded-Host header the client sends, so one forged request after a start made the routes answer every later visitor and agent from another server's index; from Astro 5.18, without `security.allowedDomains`, they fetched `http://localhost/ask-index.json` and answered every question with a 500. The server now reads the index, and each locale's, from the build's `dist/client/`, found as the adapter finds it. The Vercel bypass secret now goes with the index's fetch only on Vercel.

The routes' rate limits now key an IPv6 visitor by its /64, as `clientKey` does, instead of by each address. A new `route.trustedHeader` keys visitors by the last entry of the header your proxy sets, such as `x-real-ip`: Astro's Node adapter reports the first `X-Forwarded-For` entry, which the client sends, on Astro 5, and on later versions for a Host in `security.allowedDomains`.
