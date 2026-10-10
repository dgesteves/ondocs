---
title: VitePress
description: The VitePress plugin, which indexes the built site and adds the dialog, with one change to the config.
section: Integrations
order: 12
---

The `ondocs/vitepress` plugin adds ondocs to a VitePress site by wrapping its config. After every `vitepress build` it indexes the pages the site serves, writes `llms.txt` and the pages' Markdown copies, and adds the dialog to every page with a floating "Ask AI" button. It works with VitePress 1 and the VitePress 2 alphas, with the default theme or a theme of your own, and needs no theme file.

## Install for VitePress

The dialog is a React component, so install React and its two dependencies along with the AI SDK. They load with the dialog, the first time a visitor opens it, and never on the rest of your Vue pages:

```sh
npm i ondocs ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk
```

## Add it to .vitepress/config.mts

To add ondocs to VitePress, wrap the config in `withOndocs`:

```ts
// .vitepress/config.mts
import { defineConfig } from 'vitepress';
import { withOndocs } from 'ondocs/vitepress';

export default withOndocs(
  defineConfig({
    title: 'Acme Docs',
    // ...the rest of your config, as it is
  }),
);
```

Options go in a second argument: `withOndocs(defineConfig({ ... }), { endpoint: 'https://ask.acme.dev/api/ask' })`. Your config's own `buildEnd`, `transformHtml` and Vite plugins keep working: `withOndocs` adds its own after them.

## What VitePress indexes

After `vitepress build`, the index is written to `.vitepress/dist/ask-index.json`, or `docs/.vitepress/dist/ask-index.json` when the site is in `docs/`. It is at the URLs VitePress serves: under `base`, with or without `.html` as `cleanUrls` has it, at the paths `rewrites` give the pages, and with a page for each path of a dynamic route. Files in `srcExclude` are not pages, so they are not indexed, and neither are pages with `search: false` in their frontmatter, which VitePress's local search leaves out too.

The plugin reads each page's Markdown as the default theme renders it, the `.vp-doc` element, without the navigation, sidebar, outline, edit link or pagination, and without the heading anchors and code blocks' language labels. A home page with only a hero has no Markdown, so it is skipped. A theme of your own that does not use `.vp-doc` names its content with `content: '.my-content'` (a tag, `#id`, `.class` or `[attribute]`, or a comma-separated list), and `ignore: '.toc'` leaves parts out. A page's title is its `<h1>`, else its title without the site's, and its description is its frontmatter `description`. Unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ondocs`.

## The dialog in VitePress

The plugin adds a floating "Ask AI" button and opens the dialog with ⌘I or Ctrl+I, so ⌘K stays with VitePress's search. The button takes the default theme's colors, and the button and the dialog follow VitePress's light and dark modes, as its appearance switch sets them. A page loads only the button, about 2 KB of JavaScript, and the dialog loads the first time it is wanted. The plugin adds the button through VitePress's own client entry, so there is no theme file to write. With `mpa: true`, VitePress ships no client entry, and pages get no button: add the [script tag](/docs/script-tag) to `head` instead.

Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `buttonLabel: false`. `dialog: { links: 'sources' }` keeps only the answer's links to its source pages.

## Locales in VitePress

Each locale in VitePress's `locales` gets an index of its own, with the pages under its key: `.vitepress/dist/ask-index.json` for the root locale and `.vitepress/dist/fr/ask-index.json` for `fr`, served at `/fr/ask-index.json`. The llms files are written per locale the same way, titled after the locale's `title` and `description`.

On a locale's pages, the dialog takes the locale from the page's path and sends it with each question, and the endpoint answers from that locale's index; the endpoints `npx ondocs init` writes read the locales from the config. VitePress moves between pages without loading them, and when a visitor switches language, the dialog switches with them. It is named after the locale's title, and `dialog.locales`, by the locale's key, gives it its words in each language: `withOndocs(config, { dialog: { locales: { fr: { title: 'Demander à Acme', labels: { launcher: 'Demander' } } } } })`. Every label is listed in [The ask dialog](/docs/ask-dialog#labels-and-languages).

## Embeddings in VitePress

Embeddings work as in the other plugins. OpenAI's `text-embedding-3-small` at 512 dimensions is the default when `OPENAI_API_KEY` is set at build time, or the same model through AI Gateway with `AI_GATEWAY_API_KEY`; without either key, the index is keyword-only and the build prints a warning. Choose the model with `embedding` and `dimensions`, for example `{ embedding: 'openai:text-embedding-3-small', dimensions: 512 }`, `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` for the [Workers AI Worker](/docs/workers-ai), or `embedding: 'mock'` to build without a key.

## Deploy the endpoint for VitePress

A VitePress site is static, so the endpoint is a function on its host. Write it with `npx ondocs init`, which reads `.vitepress/dist/ask-index.json` on Vercel, Netlify or Cloudflare, or writes a Cloudflare Worker for GitHub Pages; see [Deploying](/docs/deployment). When the endpoint is not at `/api/ask` on the site, point the dialog at it with `endpoint`. To serve the same index to agents, `init` writes the [MCP endpoint](/docs/mcp) too, and the `mcp` option puts its URL in `llms.txt`.

`llms.txt` links pages absolutely when the plugin knows the site's URL: `sitemap.hostname`, or the `siteUrl` option. When vitepress-plugin-llms is in your Vite plugins, the plugin leaves the llms files to it.

To try it locally, build the site once, run `npx ondocs dev`, which answers from `.vitepress/dist/ask-index.json` or `docs/.vitepress/dist/ask-index.json`, and start `vitepress dev` with `ASK_ENDPOINT=http://localhost:8787/api/ask`.

## VitePress options

| Option                                       | Default                            | What it does                                                                                    |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `endpoint`                                   | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.                                  |
| `embedding`, `dimensions`                    | OpenAI when a key is set           | The embedding model, named as the CLI names it.                                                 |
| `embeddingModel`, `embeddingProviderOptions` | none                               | An AI SDK model object and its options, instead of `embedding`.                                 |
| `chunking`                                   | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                                                          |
| `content`, `ignore`                          | `.vp-doc`                          | What to read from each page, and what to skip besides heading anchors and code labels.          |
| `indexFile`                                  | `ask-index.json`                   | Where the index is written in `.vitepress/dist/` and served from.                               |
| `exclude`                                    | `[]`                               | Path prefixes to leave out, relative to `base` and the locale.                                  |
| `dialog`                                     |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `buttonLabel`, `theme`, `labels`, `locales`. |
| `siteUrl`                                    | `sitemap.hostname`                 | The site's URL, for absolute links in `llms.txt` and an `mcp` path.                             |
| `mcp`                                        | none                               | The [MCP endpoint](/docs/mcp)'s URL or path, which `llms.txt` points agents at.                 |
| `llmsTxt`                                    | on                                 | Write [llms.txt, llms-full.txt and .md copies](/docs/llms-txt); `false` turns them off.         |
