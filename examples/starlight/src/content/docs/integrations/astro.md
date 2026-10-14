---
# Generated from examples/nextjs/content/docs/astro.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Astro and Starlight'
description: 'The Starlight plugin and the Astro integration, which index the built site and add the dialog.'
sidebar:
  order: 11
---

`ondocs/starlight` is a Starlight plugin, and `ondocs/astro` is the Astro integration under it, for any other Astro site. Like the Docusaurus plugin, they build the index with the site and add the dialog to every page. They work with Astro 5, 6 and 7, and Starlight 0.32 and later.

Live demo: [these docs as a Starlight site](https://ondocs-starlight.vercel.app), with the plugin, on Vercel.

## Install for Astro

The dialog is a React component, so install React and its two dependencies along with the AI SDK:

```sh
npm i ondocs ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk
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

## Add it to any Astro site

Without Starlight, add the integration from `ondocs/astro` to `integrations`:

```js
// astro.config.mjs
import ondocs from 'ondocs/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [ondocs()] });
```

## What Astro and Starlight index

After `astro build`, the index is written to `dist/ask-index.json`, or to `dist/client/ask-index.json` on a site with an adapter, where Astro puts the static files it serves. It is at the URLs Astro serves: with your `base`, and with or without a trailing slash as `trailingSlash` and `build.format` have it.

The Starlight plugin reads what Starlight's own search reads: the part of each page marked `data-pagefind-body`, which is the title and the Markdown, notes and tips included, without the header, sidebar, table of contents, edit link or pagination. Pages Starlight's search leaves out are left out too, such as the 404 page and pages with `pagefind: false`, and so are pages with `<meta name="robots" content="noindex">`. Mark anything else with `data-pagefind-ignore`. To keep a site out of search engines and still index it, send an `X-Robots-Tag: noindex` header from the host rather than the meta tag, such as from `headers` in `vercel.json`.

The Astro integration reads each page's `<main>`. Choose another part with `content: '.prose'` (a tag, `#id`, `.class` or `[attribute]`, or a comma-separated list) and leave parts out with `ignore: '.toc'`. 404 and 500 pages, redirects and `noindex` pages are skipped. Unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ondocs`.

## The dialog in Astro

Both add a floating "Ask AI" button and open the dialog with ⌘I or Ctrl+I, so ⌘K stays with Starlight's search. In Starlight the button sits in the corner of the table of contents column, in Starlight's colors, and the dialog follows its light or dark theme. On other Astro sites the dialog follows `data-theme` on `<html>`, or the system setting. Vite bundles the dialog with your pages, so it shares React with your own islands. With `<ClientRouter />`, the dialog stays across navigations and citations navigate through the router.

Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `launcher: false`. `dialog: { links: 'sources' }` keeps only the answer's links to its source pages.

## Ask AI in the Starlight header

In Starlight, `dialog: { navbar: true }` puts the "Ask AI" button in the header instead of the corner: after the search box, filled with Starlight's accent color and with the shortcut on it, ⌘I on a Mac and Ctrl I elsewhere. On a phone it is an icon beside the search icon. Pass a string for another label, as in `navbar: 'Ask the docs'`; by default it is `labels.launcher`, in each locale. The floating button is off with it, unless you also set `launcher: true`.

```js
starlight({ title: 'Acme Docs', plugins: [ondocs({ dialog: { navbar: true } })] });
```

The plugin puts its own `Search` component in place of the site's, and renders the site's inside it, so your search stays as it is, Pagefind's, your own override's or another plugin's. List ondocs after any plugin that replaces `Search`, such as `@astrojs/starlight-docsearch`, or that plugin replaces the button too. On any other Astro site, give a button in your header the `data-ondocs-open` attribute and it opens the dialog: see [Open it from your own button](/reference/ask-dialog/#open-it-from-your-own-button).

## Embeddings in Astro

Embeddings work as in the Docusaurus plugin. OpenAI's `text-embedding-3-small` at 512 dimensions is the default when `OPENAI_API_KEY` is set at build time, or the same model through AI Gateway with `AI_GATEWAY_API_KEY`; without either key, the index is keyword-only and the build prints a warning. Choose the model with `embedding` and `dimensions`, for example `ondocs({ embedding: 'openai:text-embedding-3-small', dimensions: 512 })`, `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` for the [Workers AI Worker](/guides/workers-ai/), or `embedding: 'mock'` to build without a key.

## Deploy the endpoint for Astro

With an SSR adapter, there is nothing to deploy apart from the site: the integration serves `POST /api/ask` and `/api/mcp` itself, from the index it builds, and the dialog posts there. Set `OPENAI_API_KEY` where the site builds and where it runs. `route` changes the model and the limits, and `route: false` turns the routes off; see [Astro with an adapter](/guides/deployment/#astro-with-an-adapter). With `dialog.challenge.turnstile`, the ask route checks each question's [bot check](/guides/bot-challenge/) token, with the secret in `TURNSTILE_SECRET_KEY`.

With the Node adapter, the server reads the index from the build's `dist/client/`, which it finds as the adapter does, so `dist` can move. It never fetches the index from the request's Host, which Astro 5 takes from the Host or X-Forwarded-Host header the client sends. On Vercel and Netlify, which route each request by its Host, the routes fetch it from the site's own URL, and on Cloudflare through the `ASSETS` binding.

The routes limit each visitor by the client address the adapter reports, an IPv6 address by its /64. Astro's Node adapter reports the first `X-Forwarded-For` entry, which the client sends: on Astro 5 always, and on later versions for a Host in `security.allowedDomains`. Behind a proxy, name the header it sets, as in `route: { trustedHeader: 'x-real-ip' }`, or `'x-forwarded-for'` behind one proxy that appends to it, and the routes key visitors by its last entry.

A static site, without an adapter, needs the endpoint as a function on its host, or `endpoint` set to one on another origin that sends CORS headers for the site's origin (see [Cross-origin requests](/guides/security/#cross-origin-requests)). Write it with `npx ondocs init`, which reads `dist/ask-index.json` on Vercel, Netlify or Cloudflare, or writes a Cloudflare Worker for GitHub Pages; see [Deploying](/guides/deployment/). Astro writes `base` into URLs, not folders, so with `base: '/docs'` the file is still `dist/ask-index.json` and is served at `/docs/ask-index.json`.

To try it locally, build the site once and start `astro dev`: with an adapter, the integration's routes answer from the index the build wrote. Without one, run `npx ondocs dev`, which answers from `dist/ask-index.json` or `dist/client/ask-index.json`, and start `astro dev` with `ASK_ENDPOINT=http://localhost:8787/api/ask`.

## Astro and Starlight options

| Option                                       | Default                            | What it does                                                                                                       |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `endpoint`                                   | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.                                                     |
| `embedding`, `dimensions`                    | OpenAI when a key is set           | The embedding model, named as the CLI names it.                                                                    |
| `embeddingModel`, `embeddingProviderOptions` | none                               | An AI SDK model object and its options, instead of `embedding`.                                                    |
| `chunking`                                   | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                                                                             |
| `indexFile`                                  | `ask-index.json`                   | Where the index is written in `dist/` and served from.                                                             |
| `exclude`                                    | `[]`                               | Path prefixes to leave out, relative to `base` and the locale.                                                     |
| `dialog`                                     |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `launcher`, `navbar` (Starlight), `theme`, `labels`, `locales`. |
| `route`                                      | on with an SSR adapter             | The endpoints the integration serves: `{ model, rateLimit, trustedHeader, budget, mcp }`, or `false`.              |
| `content`, `ignore`                          | `main`                             | Astro integration only: what to read from each page, and what to skip.                                             |
| `mcp`                                        | none                               | The [MCP endpoint](/integrations/mcp/)'s URL or path, for `McpInstall.astro`.                                      |
| `llmsTxt`                                    | on                                 | Write [llms.txt, llms-full.txt and .md copies](/integrations/llms-txt/); `false` turns them off.                   |

## Locales in Starlight

Starlight builds every locale at once, so the plugin writes one index per locale: `dist/ask-index.json` for the root locale and `dist/fr/ask-index.json` for French, served at `/fr/ask-index.json`. A page not yet translated is indexed with the fallback content Starlight shows for it, as Starlight's search does. The Astro integration splits the index the same way along Astro's `i18n` locales. With every locale under its own path, as with Starlight's `defaultLocale: 'en'` and no `root` locale, or Astro's `prefixDefaultLocale`, the root has no pages of its own, so it gets a copy of the default locale's `ask-index.json`, `llms.txt` and `llms-full.txt`, for the endpoints and agents that read them there.

On a locale's pages, the dialog takes the locale from the page's path and sends it with each question, and the endpoint answers from that locale's index: the routes the integration serves with an adapter do, and so do the endpoints `npx ondocs init` writes, which read the locales from the config. Give the dialog its words in each language with `dialog.locales`, by the locale's path (`fr`, `pt-br`), over the dialog's own options: `ondocs({ dialog: { locales: { fr: { title: 'Demander à Acme', labels: { launcher: 'Demander' } } } } })`. Without a `title` of its own, a locale's dialog is named after the site's title in its language. Every label is listed in [The ask dialog](/reference/ask-dialog/#labels-and-languages).
