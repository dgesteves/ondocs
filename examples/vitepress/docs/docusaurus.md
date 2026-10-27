---
# Generated from examples/nextjs/content/docs/docusaurus.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Docusaurus'
description: 'The Docusaurus 3 plugin: one line of config indexes the built site, adds the dialog behind a button and ⌘I, and writes llms.txt and .md copies.'
---

# Docusaurus

The `ondocs/docusaurus` plugin adds ondocs to a Docusaurus 3 site with one line of config. After every `docusaurus build` it indexes the pages the site serves, and in the browser it adds the dialog with a floating "Ask AI" button.

Live demo: [these docs as a Docusaurus site](https://ondocs-docusaurus.vercel.app), with the plugin, on Vercel ([source](https://github.com/dgesteves/ondocs/tree/main/examples/docusaurus)).

## Install the plugin

Install the package with the AI SDK, the OpenAI provider (the default embedding model) and the dialog's two dependencies:

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

In a monorepo, run the install for the site's package from the repository's root, where `<site-package>` is the `name` in the site's `package.json`:

```sh
pnpm --filter <site-package> add ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
yarn workspace <site-package> add ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
npm install ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk -w <site-package>
```

## Add it to docusaurus.config.ts

To add ondocs to Docusaurus, put the plugin in the `plugins` array of `docusaurus.config.ts`:

```ts
// docusaurus.config.ts
export default {
  // …
  plugins: ['ondocs/docusaurus'],
};
```

The dialog posts questions to `/api/ask` on your site. Set `endpoint` for another path or host, as in `['ondocs/docusaurus', { endpoint: 'https://ask.example.com/api/ask' }]`; an endpoint on another origin must send CORS headers for your site's origin, as in [Cross-origin requests](/security#cross-origin-requests). The `ASK_ENDPOINT` environment variable, when it is set as the site builds or starts, overrides both, which is how [local development](/local-development) points the dialog at `ondocs dev`.

## See it working in Docusaurus, with no key

With the plugin in the config, three commands show the dialog answering on your machine, with no API key: build the site, start `ondocs dev`, which answers from the index the build wrote, and, in a second terminal, start the site pointed at it.

```sh
npm run build                                          # writes build/ask-index.json
npx ondocs dev                                         # serves http://localhost:8787/api/ask
ASK_ENDPOINT=http://localhost:8787/api/ask npm start   # in a second terminal
```

Then press ⌘I (Ctrl+I outside macOS), or click "Ask AI", and ask in words from your pages. Without a key, the build makes a keyword-only index unless you set `embedding: 'mock'`, and says so ("No embedding model: building a keyword-only index"), which is expected here. `ondocs dev` answers with the mock model either way: it quotes your pages, with citations. `docusaurus start` reminds you when the dialog posts to a path it does not serve. For answers on the live site, [deploy the endpoint](/docusaurus#deploy-the-endpoint-for-docusaurus).

## What the plugin indexes

After `docusaurus build`, the plugin indexes the docs, blog posts and MDX pages into `build/ask-index.json`, at the exact URLs Docusaurus generated, so citations never guess at a URL. It reads each page's Markdown content without the navbar, breadcrumbs, table of contents, doc cards or pagination. Pages that only list other pages are left out: blog lists, tag and author pages, and generated category indexes.

A page with `<meta name="robots" content="noindex">` is left out too, so with Docusaurus's `noIndex: true` the index is empty. To keep a site out of search engines and still index it, send an `X-Robots-Tag: noindex` header from the host instead, such as from `headers` in `vercel.json`.

There is nothing to commit. The index is rebuilt with the site, and unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ondocs`, which Netlify and Vercel keep between builds. Leave sections out with `exclude`, for example `exclude: ['/changelog']`.

## The dialog and the shortcut

In the browser the plugin adds a floating "Ask AI" button beside the back-to-top button, and opens the dialog with ⌘I or Ctrl+I. ⌘K stays with your search, and text fields keep ⌘I for italic. The dialog follows the site's light or dark mode, and citations route through Docusaurus without a page reload.

DocSearch's own Ask AI panel also opens with ⌘I. Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `launcher: false`. `dialog: { links: 'sources' }` keeps only the answer's links to its source pages.

## Ask AI in the Docusaurus navbar

`dialog: { navbar: true }` puts the "Ask AI" button in the navbar instead of the corner: after the search box, or where it would be without a search plugin, filled with your primary color and with the shortcut on it, ⌘I on a Mac and Ctrl I elsewhere. On a phone it is an icon that stays in the navbar beside search, not in the menu. Pass a string for another label, as in `navbar: 'Ask the docs'`; by default it is `labels.launcher`, in each locale. The floating button is off with it, unless you also set `launcher: true`.

```ts
plugins: [['ondocs/docusaurus', { dialog: { navbar: true } }]],
```

The plugin renders the button from its own `@theme/Navbar/Search`, which wraps the classic theme's, so it works with DocSearch, a local search plugin or none. If your site swizzles `Navbar/Search`, or wants the button somewhere else, give any element the `data-ondocs-open` attribute and it opens the dialog: see [Open it from your own button](/ask-dialog#open-it-from-your-own-button).

## Embeddings in Docusaurus

The plugin embeds with OpenAI's `text-embedding-3-small` at 512 dimensions when `OPENAI_API_KEY` is set at build time, or with the same model through AI Gateway when only `AI_GATEWAY_API_KEY` is. Without either key it builds a keyword-only index and prints a warning. If a key is set but the provider cannot load, the build fails with the reason instead of quietly going keyword-only.

Choose the model with `embedding`, named the way the CLI names it, so the config imports no provider: `'openai:text-embedding-3-large'`, `'cohere/embed-v4.0'` through AI Gateway, `'workers-ai:@cf/baai/bge-small-en-v1.5'` for the [Workers AI Worker](/workers-ai), `'mock'` for offline builds, or `'none'` for keyword-only. `dimensions` sets the vector size for models that support it, and the endpoint reads it from the index.

```ts
plugins: [['ondocs/docusaurus', { embedding: 'openai:text-embedding-3-small', dimensions: 512 }]],
```

## Deploy the endpoint for Docusaurus

A Docusaurus site is static, so the endpoint runs as a function on your host and reads the index the build wrote. Write it with one command in the site's folder:

```sh
npx ondocs init
```

On Vercel it writes `api/ask.ts` and `api/mcp.ts` and bundles `build/ask-index.json` with them in `vercel.json`; on Netlify and Cloudflare, their equivalents. On GitHub Pages, where Docusaurus sites often live and nothing runs but files, it writes a Cloudflare Worker that reads the index from the live site and answers with Workers AI, with no API key, and the dialog posts to it: set `endpoint` to its URL. See [Workers AI](/workers-ai). The endpoints on Vercel, Netlify and Cloudflare embed questions with OpenAI's `text-embedding-3-small`, the plugin's default; each has a rate limit and a daily budget. See [Deploying](/deployment) for what it writes on each host.

## Docusaurus plugin options

| Option                     | Default                            | What it does                                                                                                                      |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`                 | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.                                                                    |
| `embedding`                | OpenAI when a key is set           | Model spec: `openai:<model>`, `workers-ai:@cf/<model>`, `<provider>/<model>`, `mock`, `none`.                                     |
| `dimensions`               | the model's                        | Vector size, for models that support it.                                                                                          |
| `embeddingModel`           | none                               | An AI SDK embedding model object, instead of `embedding`.                                                                         |
| `embeddingProviderOptions` | none                               | Passed to the embedding model.                                                                                                    |
| `chunking`                 | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                                                                                            |
| `indexFile`                | `ask-index.json`                   | Where the index is written in `build/` and served from.                                                                           |
| `exclude`                  | `[]`                               | Path prefixes to leave out, relative to `baseUrl`.                                                                                |
| `versions`                 | `'last'`                           | Docs versions to index: the last one, or `'all'`.                                                                                 |
| `dialog`                   |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `launcher`, `navbar`, `labels`, `locales`, `links`, `sourceUrls`, `challenge`. |
| `mcp`                      | none                               | The [MCP endpoint](/mcp)'s URL or path, for `<OndocsMcp />`.                                                                      |
| `llmsTxt`                  | on                                 | Write [llms.txt, llms-full.txt and .md copies](/llms-txt); `false` turns them off.                                                |

## Locales and versions

Docusaurus builds each locale on its own, and each gets its own index under its locale path: `build/fr/ask-index.json`, served at `/fr/ask-index.json`. On a locale's pages, the dialog sends the locale with each question, and an endpoint with `indexes` answers from that locale's index: `npx ondocs init` reads the locales from `i18n` and writes that. Give the dialog its words in each language with `dialog.locales`, by Docusaurus locale, over the dialog's own options:

```ts
plugins: [
  [
    'ondocs/docusaurus',
    {
      dialog: {
        suggestions: ['How do I install it?'],
        locales: {
          fr: {
            title: 'Demander à Acme',
            suggestions: ['Comment l’installer ?'],
            labels: { launcher: 'Demander', placeholder: 'Posez une question…', newQuestion: 'Nouvelle question' },
          },
        },
      },
    },
  ],
],
```

Every label is listed in [The ask dialog](/ask-dialog#labels-and-languages).

With versioned docs, the plugin indexes the last version, the one at `/docs` that readers land on, and leaves out the others, such as `/docs/next` and `/docs/1.0`, so answers cite the version people use. llms.txt and the `.md` copies follow the index. `versions: 'all'` indexes every version; to keep only some, add the others to `exclude`, as in `versions: 'all', exclude: ['/docs/1.0']`. When several indexed versions have a section word for word, search returns it once, from the shortest URL: see [Copies of a section](/retrieval#copies-of-a-section).

## When another plugin wraps Root

When two plugins wrap `Root`, Docusaurus uses only the last one's wrapper, so the dialog can go missing. Render it from your own `Root` instead; it shows once even if the plugin's `Root` renders it too:

```tsx
// src/theme/Root.tsx
import Ondocs from '@theme/Ondocs';
import Root from '@theme-original/Root';
import type { ReactNode } from 'react';

export default function RootWithAsk({ children }: { children: ReactNode }) {
  return (
    <Root>
      {children}
      <Ondocs />
    </Root>
  );
}
```
