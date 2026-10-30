---
title: Astro and Starlight
description: The Starlight plugin and the Astro integration, which index the built site and add the dialog.
section: Integrations
order: 11
---

`ondocs/starlight` is a Starlight plugin, and `ondocs/astro` is the Astro integration under it, for any other Astro site. Like the Docusaurus plugin, they build the index with the site and add the dialog to every page. They work with Astro 5, 6 and 7, and Starlight 0.32 and later.

Live demo: [these docs as a Starlight site](https://ondocs-starlight.vercel.app), with the plugin, on Vercel ([source](https://github.com/dgesteves/ondocs/tree/main/examples/starlight)).

## Install for Astro

Install ondocs and the AI SDK. The dialog comes with its own React, so your site needs none:

```sh
npm i ondocs ai @ai-sdk/openai
```

With ondocs 0.11.0 or earlier, the dialog renders with the site's React: also install `react`, `react-dom`, `@radix-ui/react-dialog` and `cmdk`.

In a monorepo, run the install for the site's package from the repository's root, where `<site-package>` is the `name` in the site's `package.json`:

```sh
pnpm --filter <site-package> add ondocs ai @ai-sdk/openai
yarn workspace <site-package> add ondocs ai @ai-sdk/openai
npm install ondocs ai @ai-sdk/openai -w <site-package>
```

## Add it to Starlight

To add ondocs to Starlight, put the plugin in Starlight's `plugins` array in `astro.config.mjs`:

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import ondocs from 'ondocs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [starlight({ title: 'Acme Docs', plugins: [ondocs()] })],
});
```

Put it in Starlight's `plugins`, not in Astro's `integrations`: a Starlight plugin does nothing there, so the build stops with an error that says to move it. `npx astro add starlight-ondocs` puts it in `integrations`, so add it by hand instead.

## Add it to any Astro site

Without Starlight, add the integration from `ondocs/astro` to `integrations`:

```js
// astro.config.mjs
import ondocs from 'ondocs/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [ondocs()] });
```

## See it working in Starlight or Astro, with no key

With the plugin in the config, three commands show the dialog answering on your machine, with no API key: build the site, start `ondocs dev`, which answers from the index the build wrote, and, in a second terminal, start `astro dev` pointed at it.

```sh
npm run build                                            # writes dist/ask-index.json
npx ondocs dev                                           # serves http://localhost:8787/api/ask
ASK_ENDPOINT=http://localhost:8787/api/ask npm run dev   # in a second terminal
```

Then press ⌘I (Ctrl+I outside macOS), or click "Ask AI", and ask in words from your pages. Without a key, the build makes a keyword-only index unless you set `embedding: 'mock'`, and says so ("No embedding model: building a keyword-only index"), which is expected here. `ondocs dev` answers with the mock model either way: it quotes your pages, with citations. With an SSR adapter the build writes `dist/client/ask-index.json`, where `ondocs dev` finds it too; with `OPENAI_API_KEY` set as well, plain `npm run dev` answers from the integration's own routes. For answers on the live site, [deploy the endpoint](/docs/astro#deploy-the-endpoint-for-astro).

## What Astro and Starlight index

After `astro build`, the index is written to `dist/ask-index.json`, or to `dist/client/ask-index.json` on a site with an adapter, where Astro puts the static files it serves. It is at the URLs Astro serves: with your `base`, and with or without a trailing slash as `trailingSlash` and `build.format` have it.

The Starlight plugin reads what Starlight's own search reads: the part of each page marked `data-pagefind-body`, which is the title and the Markdown, notes and tips included, without the header, sidebar, table of contents, edit link or pagination. Pages Starlight's search leaves out are left out too, such as the 404 page and pages with `pagefind: false`, and so are pages with `<meta name="robots" content="noindex">`. Mark anything else with `data-pagefind-ignore`. To keep a site out of search engines and still index it, send an `X-Robots-Tag: noindex` header from the host rather than the meta tag, such as from `headers` in `vercel.json`.

The Astro integration reads each page's `<main>`. Choose another part with `contentSelector: '.prose'` (a tag, `#id`, `.class` or `[attribute]`, or a comma-separated list) and leave parts out with `ignoreSelector: '.toc'`. 404 and 500 pages, redirects and `noindex` pages are skipped. Unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ondocs`.

## Already using starlight-llms-txt?

Keep it. ondocs leaves `llms.txt` and `llms-full.txt` to it, and says so in the build, then adds what it does not write, from the same build: a Markdown copy of each page at its URL plus `.md`, the Ask AI dialog, and the index an [MCP endpoint](/docs/mcp) serves to agents, the integration's own with an SSR adapter or the one `npx ondocs init` writes. starlight-llms-txt's `llms.txt` does not name that endpoint, so show it on a page with `McpInstall.astro`: see [Show it on your site](/docs/mcp#show-it-on-your-site). The other llms plugins ondocs leaves files to are in [Alongside other llms plugins](/docs/llms-txt#alongside-other-llms-plugins).

## The dialog in Astro

Both add a floating "Ask AI" button and open the dialog with ⌘I or Ctrl+I, so ⌘K stays with Starlight's search. In Starlight the button sits in the corner of the table of contents column, in Starlight's colors, and the dialog follows its light or dark theme. On other Astro sites the dialog follows `data-theme` on `<html>`, or the system setting. With `<ClientRouter />`, the dialog stays across navigations and citations navigate through the router.

The dialog comes prebuilt with its own React, Radix and cmdk, from `ondocs/embed/standalone`, also on a site with React islands of its own. Vite splits it off into a chunk that loads the first time it is wanted: 92.6 KB of JavaScript, gzipped, on the Starlight example. Before then, a page carries only the button and the shortcut, and the dialog's stylesheet, 3.5 KB gzipped, which the plugin adds to the site's CSS. Measured on an Apple M1 Max with `node scripts/js-weight.mjs starlight`, in headless Chrome, and `gzip -9` of `ondocs/react/styles.css`.

Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `launcher: false`. Answers link only to their source pages; `dialog: { links: 'all' }` keeps every safe link.

## Ask AI in the Starlight header

In Starlight, `dialog: { navbar: true }` puts the "Ask AI" button in the header instead of the corner: after the search box, filled with Starlight's accent color and with the shortcut on it, ⌘I on a Mac and Ctrl I elsewhere. On a phone it is an icon beside the search icon. Pass a string for another label, as in `navbar: 'Ask the docs'`; by default it is `labels.launcher`, in each locale. The floating button is off with it, unless you also set `launcher: true`.

```js
starlight({ title: 'Acme Docs', plugins: [ondocs({ dialog: { navbar: true } })] });
```

The plugin puts its own `Search` component in place of the site's, and renders the site's inside it, so your search stays as it is, Pagefind's, your own override's or another plugin's. List ondocs after any plugin that replaces `Search`, such as `@astrojs/starlight-docsearch`, or that plugin replaces the button too. On any other Astro site, give a button in your header the `data-ondocs-open` attribute and it opens the dialog: see [Open it from your own button](/docs/ask-dialog#open-it-from-your-own-button).

## Embeddings in Astro

Embeddings work as in the Docusaurus plugin. OpenAI's `text-embedding-3-small` at 512 dimensions is the default when `OPENAI_API_KEY` is set at build time, or the same model through AI Gateway with `AI_GATEWAY_API_KEY`; without either key, the index is keyword-only and the build prints a warning. Choose the model with `embedding` and `dimensions`, for example `ondocs({ embedding: 'openai:text-embedding-3-small', dimensions: 512 })`, `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` for the [Workers AI Worker](/docs/workers-ai), or `embedding: 'mock'` to build without a key.

## Deploy the endpoint for Astro

With an SSR adapter, there is nothing to deploy apart from the site: the integration serves `POST /api/ask` and `/api/mcp` itself, from the index it builds, and the dialog posts there, under `base`, as it does to a route file of the site's own at `src/pages/api/ask.ts`. Set `OPENAI_API_KEY` where the site builds and where it runs. `route` changes the model and the limits, and `route: false` turns the routes off; see [Astro with an adapter](/docs/deployment#astro-with-an-adapter). Under `astro dev`, which builds no index, they answer from the one the last `astro build` wrote, which the dev server serves at its URL under `base`. With `site` set, `llms.txt` and `McpInstall.astro` point agents at the MCP route, unless `mcp` names another endpoint. With `dialog.challenge.turnstile`, the ask route checks each question's [bot check](/docs/bot-challenge) token, with the secret in `TURNSTILE_SECRET_KEY`.

With the Node adapter, the server reads the index from the build's `dist/client/`, which it finds as the adapter does, so `dist` can move. It never fetches the index from the request's Host, which Astro 5 takes from the Host or X-Forwarded-Host header the client sends. On Vercel and Netlify, which route each request by its Host, the routes fetch it from the site's own URL, and on Cloudflare through the `ASSETS` binding.

The routes limit each visitor by the client address the adapter reports, an IPv6 address by its /64. Astro's Node adapter reports the first `X-Forwarded-For` entry, which the client sends: on Astro 5 always, and on later versions for a Host in `security.allowedDomains`. Behind a proxy, name the header it sets, as in `route: { trustedHeader: 'x-real-ip' }`, or `'x-forwarded-for'` behind one proxy that appends to it, and the routes key visitors by its last entry.

A static site, without an adapter, needs the endpoint as a function on its host, or `endpoint` set to one on another origin that sends CORS headers for the site's origin (see [Cross-origin requests](/docs/security#cross-origin-requests)). Write it with `npx ondocs init`, which reads `dist/ask-index.json` on Vercel, Netlify or Cloudflare, or writes a Cloudflare Worker for GitHub Pages; see [Deploying](/docs/deployment). Until then, a static build warns that the dialog posts to `/api/ask`, which it does not serve. The warning stops once the site has the endpoint `init` writes for Vercel, Netlify or Cloudflare (`api/ask.ts`, `netlify/functions/ask.mts`, `functions/api/ask.ts` or `worker/ondocs.ts`), or once `endpoint` is set. Astro writes `base` into URLs, not folders, so with `base: '/docs'` the file is still `dist/ask-index.json` and is served at `/docs/ask-index.json`.

## Astro and Starlight options

| Option                                       | Default                            | What it does                                                                                                                                           |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `endpoint`                                   | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.                                                                                         |
| `embedding`, `dimensions`                    | OpenAI when a key is set           | The embedding model, named as the CLI names it.                                                                                                        |
| `embeddingModel`, `embeddingProviderOptions` | none                               | An AI SDK model object and its options, instead of `embedding`.                                                                                        |
| `chunking`                                   | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                                                                                                                 |
| `indexFile`                                  | `ask-index.json`                   | Where the index is written in `dist/` and served from.                                                                                                 |
| `exclude`                                    | `[]`                               | Path prefixes to leave out, relative to `base` and the locale.                                                                                         |
| `dialog`                                     |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `launcher`, `navbar` (Starlight), `theme`, `labels`, `locales`, `links`, `sourceUrls`, `challenge`. |
| `route`                                      | on with an SSR adapter             | The endpoints the integration serves: `{ model, rateLimit, trustedHeader, budget, noAnswerMessage, mcp }`, or `false`.                                 |
| `contentSelector`, `ignoreSelector`          | `main`                             | Astro integration only: what to read from each page, and what to skip.                                                                                 |
| `mcp`                                        | the route it serves, with `site`   | The [MCP endpoint](/docs/mcp)'s URL or path, for `llms.txt` and `McpInstall.astro`.                                                                    |
| `llmsTxt`                                    | on                                 | Write [llms.txt, llms-full.txt and .md copies](/docs/llms-txt); `false` turns them off.                                                                |

## Locales in Starlight

Starlight builds every locale at once, so the plugin writes one index per locale: `dist/ask-index.json` for the root locale and `dist/fr/ask-index.json` for French, served at `/fr/ask-index.json`. A page not yet translated is indexed with the fallback content Starlight shows for it, as Starlight's search does. The Astro integration splits the index the same way along Astro's `i18n` locales. With every locale under its own path, as with Starlight's `defaultLocale: 'en'` and no `root` locale, or Astro's `prefixDefaultLocale`, the root has no pages of its own, so it gets a copy of the default locale's `ask-index.json`, `llms.txt` and `llms-full.txt`, for the endpoints and agents that read them there.

On a locale's pages, the dialog takes the locale from the page's path and sends it with each question, and the endpoint answers from that locale's index: the routes the integration serves with an adapter do, and so do the endpoints `npx ondocs init` writes, which read the locales from the config, and `ondocs dev`, which serves each locale's index beside the root one (`dist/fr/ask-index.json` next to `dist/ask-index.json`). The MCP route the integration serves takes the locale too: agents name it in `search` and `list_pages` (see [The tools](/docs/mcp#the-tools)). Give the dialog its words in each language with `dialog.locales`, by the locale's path (`fr`, `pt-br`), over the dialog's own options: `ondocs({ dialog: { locales: { fr: { title: 'Demander à Acme', labels: { launcher: 'Demander' } } } } })`. Without a `title` of its own, a locale's dialog is named after the site's title in its language. Every label is listed in [The ask dialog](/docs/ask-dialog#labels-and-languages).

In Starlight, the plugin has the dialog's words in French, German and Spanish, besides English. A locale whose `lang` is in one of them gets the button, every label, the dialog's title ("Demander à Acme Docs") and the route's "I don't know" in that language, with no labels to write; yours in `dialog.locales` go over them. A locale in another language keeps the root locale's words, as Starlight's own interface falls back to the default locale's, until you give it its own. A root locale in French, German or Spanish gets them too. The French, German and Spanish words are machine translations that native speakers have not reviewed yet: if one reads wrong, please say so in an [issue](https://github.com/dgesteves/ondocs/issues) or fix it in a pull request to `src/starlight/translations.ts`.

The route answers "I don't know" without calling the model when nothing on the site is relevant. Choose its words with `route.noAnswerMessage`: one message for every locale, or one per locale by its path, with `root` for the pages under none, as in `route: { noAnswerMessage: { root: 'Nothing on that here.', fr: 'Rien à ce sujet ici.' } }`. The dialog's `noAnswer` label replaces it on the page instead, with any endpoint.

On a right-to-left locale, such as Arabic, Hebrew or Persian, the dialog is laid out right to left, as the page is. Code blocks, inline code and the sources' URLs stay left to right, and each question and each paragraph of an answer runs in the direction of its own first words, so an English question keeps its question mark at the end.
