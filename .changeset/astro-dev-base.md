---
'ondocs': patch
---

`astro dev` on a site with an SSR adapter and a `base` answers from the last build's index. The dev server serves that index for the routes the integration adds, and looked for its request at `<base>/ask-index.json` in `request.url`. Astro's own base middleware, which runs first, has already stripped `base` from that URL, so the request fell through to a 404 and every question failed. It now matches the path as requested.
