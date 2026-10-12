---
# Generated from examples/nextjs/content/docs/astro.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Astro and Starlight'
description: 'The Starlight plugin and the Astro integration, which index the built site and add the dialog.'
---

# Astro and Starlight

`ondocs/starlight` is a Starlight plugin, and `ondocs/astro` is the Astro integration under it, for any other Astro site. Like the Docusaurus plugin, they build the index with the site and add the dialog to every page. They work with Astro 5, 6 and 7, and Starlight 0.32 and later.

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

The Starlight plugin reads what Starlight's own search reads: the part of each page marked `data-pagefind-body`, which is the title and the Markdown, notes and tips included, without the header, sidebar, table of contents, edit link or pagination. Pages Starlight's search leaves out are left out too, such as the 404 page and pages with `pagefind: false`. Mark anything else with `data-pagefind-ignore`.

The Astro integration reads each page's `<main>`. Choose another part with `content: '.prose'` (a tag, `#id`, `.class` or `[attribute]`, or a comma-separated list) and leave parts out with `ignore: '.toc'`. 404 and 500 pages, redirects and `noindex` pages are skipped. Unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ondocs`.

## The dialog in Astro

Both add a floating "Ask AI" button and open the dialog with ⌘I or Ctrl+I, so ⌘K stays with Starlight's search. In Starlight the button sits in the corner of the table of contents column, in Starlight's colors, and the dialog follows its light or dark theme. On other Astro sites the dialog follows `data-theme` on `<html>`, or the system setting. Vite bundles the dialog with your pages, so it shares React with your own islands. With `<ClientRouter />`, the dialog stays across navigations and citations navigate through the router.

Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `launcher: false`. `dialog: { links: 'sources' }` keeps only the answer's links to its source pages.

## Embeddings in Astro

Embeddings work as in the Docusaurus plugin. OpenAI's `text-embedding-3-small` at 512 dimensions is the default when `OPENAI_API_KEY` is set at build time, or the same model through AI Gateway with `AI_GATEWAY_API_KEY`; without either key, the index is keyword-only and the build prints a warning. Choose the model with `embedding` and `dimensions`, for example `ondocs({ embedding: 'openai:text-embedding-3-small', dimensions: 512 })`, `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` for the [Workers AI Worker](/workers-ai), or `embedding: 'mock'` to build without a key.

## Deploy the endpoint for Astro

With an SSR adapter, there is nothing to deploy apart from the site: the integration serves `POST /api/ask` and `/api/mcp` itself, from the index it builds, and the dialog posts there. Set `OPENAI_API_KEY` where the site builds and where it runs. `route` changes the model and the limits, and `route: false` turns the routes off; see [Astro with an adapter](/deployment#astro-with-an-adapter). With `dialog.challenge.turnstile`, the ask route checks each question's [bot check](/bot-challenge) token, with the secret in `TURNSTILE_SECRET_KEY`.

A static site, without an adapter, needs the endpoint as a function on its host. Write it with `npx ondocs init`, which reads `dist/ask-index.json` on Vercel, Netlify or Cloudflare, or writes a Cloudflare Worker for GitHub Pages; see [Deploying](/deployment). Astro writes `base` into URLs, not folders, so with `base: '/docs'` the file is still `dist/ask-index.json` and is served at `/docs/ask-index.json`.

To try it locally, build the site once and start `astro dev`: with an adapter, the integration's routes answer from the index the build wrote. Without one, run `npx ondocs dev`, which answers from `dist/ask-index.json` or `dist/client/ask-index.json`, and start `astro dev` with `ASK_ENDPOINT=http://localhost:8787/api/ask`.

## Astro and Starlight options

| Option                                       | Default                            | What it does                                                                                 |
| -------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `endpoint`                                   | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.                               |
| `embedding`, `dimensions`                    | OpenAI when a key is set           | The embedding model, named as the CLI names it.                                              |
| `embeddingModel`, `embeddingProviderOptions` | none                               | An AI SDK model object and its options, instead of `embedding`.                              |
| `chunking`                                   | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                                                       |
| `indexFile`                                  | `ask-index.json`                   | Where the index is written in `dist/` and served from.                                       |
| `exclude`                                    | `[]`                               | Path prefixes to leave out, relative to `base` and the locale.                               |
| `dialog`                                     |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `launcher`, `theme`, `labels`, `locales`. |
| `route`                                      | on with an SSR adapter             | The endpoints the integration serves: `{ model, rateLimit, budget, mcp }`, or `false`.       |
| `content`, `ignore`                          | `main`                             | Astro integration only: what to read from each page, and what to skip.                       |
| `mcp`                                        | none                               | The [MCP endpoint](/mcp)'s URL or path, for `McpInstall.astro`.                              |
| `llmsTxt`                                    | on                                 | Write [llms.txt, llms-full.txt and .md copies](/llms-txt); `false` turns them off.           |

## Locales in Starlight

Starlight builds every locale at once, so the plugin writes one index per locale: `dist/ask-index.json` for the root locale and `dist/fr/ask-index.json` for French, served at `/fr/ask-index.json`. A page not yet translated is indexed with the fallback content Starlight shows for it, as Starlight's search does. The Astro integration splits the index the same way along Astro's `i18n` locales.

On a locale's pages, the dialog takes the locale from the page's path and sends it with each question, and the endpoint answers from that locale's index: the routes the integration serves with an adapter do, and so do the endpoints `npx ondocs init` writes, which read the locales from the config. Give the dialog its words in each language with `dialog.locales`, by the locale's path (`fr`, `pt-br`), over the dialog's own options: `ondocs({ dialog: { locales: { fr: { title: 'Demander à Acme', labels: { launcher: 'Demander' } } } } })`. Without a `title` of its own, a locale's dialog is named after the site's title in its language. Every label is listed in [The ask dialog](/ask-dialog#labels-and-languages).
