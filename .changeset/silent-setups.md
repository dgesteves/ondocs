---
'ondocs': patch
'starlight-ondocs': patch
---

Astro, Starlight and VitePress setups that built without a word, and then could only fail, now say so or work:

- A static Astro or Starlight build, with no adapter and no `endpoint`, now warns that the dialog posts to `/api/ask`, which the build does not serve, and says to run `npx ondocs init`, add an SSR adapter or set `endpoint`. Before, the build was clean and every question got a 404 once the site was deployed. The warning stays off once the site has the endpoint `ondocs init` writes for Vercel, Netlify or Cloudflare.
- `ondocs/starlight` and `starlight-ondocs` in Astro's `integrations`, where `npx astro add starlight-ondocs` puts them, now stop the build with an error that says to move the plugin into Starlight's `plugins`. Before, Astro ran none of it: no index, no `llms.txt`, no button, and no error.
- With an SSR adapter and `base`, the dialog now posts under `base` whenever the site's own `src/pages/api/ask.ts` answers there: with route files for both `/api/ask` and `/api/mcp`, with `route: { mcp: false }`, or with `route: false`. Before, it posted to `/api/ask`, outside `base`, and every question got a 404.
- `withOndocs` now takes a VitePress config as a Promise, as `withPwa` from `@vite-pwa/vitepress` returns it, or as a function of `{ command, mode }`, and returns it in the same shape. Before, it spread either into an object, which dropped the whole config, and the build failed with an error about the site's own files.
