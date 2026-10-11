# An ask endpoint for any static docs site, with no API key

This Cloudflare Worker answers your docs site's Ask box and serves its MCP endpoint, for a site on GitHub Pages, S3, Read the Docs or any host that only serves files. Workers AI embeds the questions and writes the answers, so there is no model key to get or set, and a small site's questions fit in Workers AI's free daily allowance.

It is what `npx ondocs init --host github-pages` writes, as a template for `npm create cloudflare`.

## Deploy it

```sh
npm create cloudflare@latest my-docs-ask -- --template=dgesteves/ondocs/templates/cloudflare-worker
```

Set `SITE_URL` in `wrangler.jsonc` to your site's URL with its base path, such as `https://acme.github.io/docs`, then:

```sh
npx wrangler deploy
```

Wrangler prints the Worker's URL. Point the dialog at it, plus `/api/ask`:

- **Docusaurus:** `plugins: [['ondocs/docusaurus', { endpoint: 'https://my-docs-ask.<subdomain>.workers.dev/api/ask' }]]`
- **Starlight:** `ondocs({ endpoint: 'https://my-docs-ask.<subdomain>.workers.dev/api/ask' })`
- **Any other site:** `data-endpoint="https://my-docs-ask.<subdomain>.workers.dev/api/ask"` on the script tag

`package.json` allows the install scripts of esbuild and workerd, which Wrangler needs to set up their binaries, and declines fsevents (macOS file watching, with a prebuilt fallback). npm 12 runs no install scripts unless they are allowed this way.

The site must serve its index at `SITE_URL/ask-index.json`. The Docusaurus and Starlight plugins write it with every build; for another generator, run `npx ondocs index <build folder> -o <build folder>/ask-index.json -e none` after the build.

## What it does

- **It reads the index from the live site,** keeps it in memory, and checks it again every five minutes with a conditional request, so it follows the site's deploys without being redeployed.
- **It answers the site's pages across origins,** with CORS headers for `SITE_URL`'s origin and no other.
- **It searches by keywords** for an index built without an embedding model, and by meaning as well for one built with a Workers AI model: `ondocs index -e workers-ai:@cf/baai/bge-small-en-v1.5`, or `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` in the plugins. That build needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, a token allowed to run Workers AI, where the site builds.
- **It says "I don't know" without calling the model** when nothing in the docs is relevant.
- **It limits each visitor** to 10 questions a minute, and the Worker to 100 questions and 300,000 model tokens a day per instance, about the free allowance with the default model. On the Workers Free plan nothing is charged past the allowance; on Workers Paid, raise the budget in `src/index.ts` to what you will spend.
- **It serves the same index to agents** at `/api/mcp`, keyword-only, calling no model.

`CHAT_MODEL` in `wrangler.jsonc` picks the Workers AI model that writes the answers. [The Workers AI guide](https://ondocs.vercel.app/docs/workers-ai) compares models by cost, and has the limits: how large an index fits in a Worker's memory, and the Free plan's CPU time.

## Test it

```sh
npm test            # the Worker in workerd, offline, with stand-ins for the site and Workers AI
npm run typecheck
```

The tests need no Cloudflare account and use none of your allowance. `npx wrangler dev` runs the Worker against the real Workers AI, which needs `wrangler login` and counts against your allowance.
