# ondocs Starlight example

The ondocs docs as a Starlight site, with the `ondocs/starlight` plugin. The pages are generated from the website's, in `examples/nextjs/content/docs`, by `pnpm examples:sync`: edit them there. The changelog page is this site's own. Without `OPENAI_API_KEY` it uses the offline mock models, so it runs with no key.

Live at https://ondocs-starlight.vercel.app. Its dialog asks the website's endpoint, `https://ondocs.vercel.app/api/ask`, which answers from the same docs and allows this site's origin (not localhost: locally, use `ondocs dev`, as below), and `dialog.sourceUrls` (written by `pnpm examples:sync`) sends the website's citations to the same pages here. `vercel.json` has the Vercel build. `SITE_URL` sets the site's address, for `llms.txt`; each page's canonical link goes to the website.

```sh
pnpm install && pnpm build                       # in the repository root, once
cd examples/starlight
pnpm build                                       # writes dist/ask-index.json
pnpm api                                         # ondocs dev: the ask endpoint, on :8787
ASK_ENDPOINT=http://localhost:8787/api/ask pnpm dev     # then press ⌘I or "Ask AI"
```

`pnpm api` runs `ondocs dev`, which stands in for the serverless function you would deploy; the main README has the Vercel, Netlify and Cloudflare versions. The changelog page has `pagefind: false`, so it is left out of the index, as it is out of Starlight's search.
