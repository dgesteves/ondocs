# ondocs VitePress example

The ondocs docs as a VitePress site, with the `ondocs/vitepress` plugin. The pages in `docs/` and the sidebar in `.vitepress/sidebar.ts` are generated from the website's, in `examples/nextjs/content/docs`, by `pnpm examples:sync`: edit them there. Without `OPENAI_API_KEY` it uses the offline mock models, so it runs with no key.

```sh
pnpm install && pnpm build                       # in the repository root, once
cd examples/vitepress
pnpm build                                       # writes .vitepress/dist/ask-index.json
pnpm api                                         # ondocs dev: the ask endpoint, on :8787
ASK_ENDPOINT=http://localhost:8787/api/ask pnpm dev     # then press ⌘I or "Ask AI"
```

`pnpm api` runs `ondocs dev`, which stands in for the serverless function you would deploy; `npx ondocs init` writes the Vercel, Netlify, Cloudflare or GitHub Pages version.
