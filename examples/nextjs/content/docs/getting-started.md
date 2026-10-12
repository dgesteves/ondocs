---
title: Getting started
description: Install the package, build the index, deploy the endpoint and add the dialog.
section: Get started
order: 2
---

Every setup has the same two halves: an index built with your site, and an endpoint that answers from it. The integration you pick decides how much of that is done for you.

## Pick your setup

- **Docusaurus.** One line in `docusaurus.config.ts`: the plugin builds the index and adds the dialog. See [Docusaurus](/docs/docusaurus).
- **Astro or Starlight.** One plugin or integration in `astro.config.mjs`, which builds the index and adds the dialog. See [Astro and Starlight](/docs/astro).
- **VitePress.** Wrap the config in `.vitepress/config.mts` with `withOndocs`, which builds the index and adds the dialog. See [VitePress](/docs/vitepress).
- **Next.js or another React app.** Index with the CLI, mount `createAskHandler` as a route, and render `<AskDialog />`. See [Next.js and React](/docs/nextjs).
- **Fumadocs or Nextra.** The same, with the CLI following the framework's URLs. See [Fumadocs](/docs/fumadocs) and [Nextra](/docs/nextra).
- **Any other site.** Index the built HTML with the CLI, write the endpoint with `npx ondocs init`, and add one script tag. See [Script tag](/docs/script-tag).

## Install

Install the package with the Vercel AI SDK and a model provider. The two packages the dialog is built on, `@radix-ui/react-dialog` and `cmdk`, are optional peer dependencies: leave them out if you only deploy the endpoint.

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

Moving a site from `ask-my-site`, its name until 0.6.0? See [Migrating from ask-my-site](/docs/migrating).

ondocs needs Node.js 22.12 or later to build the index. The endpoint itself uses Web APIs only, so it also runs on Bun, Deno and Cloudflare Workers.

## Build the index

Point the CLI at your content. It reads Markdown, MDX and HTML, splits pages at every heading, embeds the chunks and writes `ask-index.json`:

```sh
npx ondocs index ./docs --base-url /docs -e openai:text-embedding-3-small --dimensions 512
```

With the Docusaurus, Astro, Starlight or VitePress plugin you skip this step: the plugin indexes the built site after every build.

## Add the endpoint

The endpoint is one function. It takes a Web `Request` and returns a streaming `Response`, and it must embed questions with the same model the index was built with:

```ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'), // at the index's 512 dimensions
});
```

`npx ondocs init` writes this for your host, with a rate limit and a daily budget: Vercel, Netlify, Cloudflare, or a Cloudflare Worker with Workers AI and no API key for a site on GitHub Pages. An Astro site with an SSR adapter needs nothing: the integration serves it. See [Deploying](/docs/deployment).

## Add the dialog

In a React app, render the dialog once near the root and import its two stylesheets:

```tsx
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';

<AskDialog launcher suggestions={['How do I install it?']} />;
```

`launcher` adds a floating "Ask AI" button. The dialog also opens with ⌘K on macOS and Ctrl+K elsewhere. The plugins and the script tag add the same dialog for you, opened with ⌘I or Ctrl+I so that ⌘K stays with your site's search.

## Try it without an API key

Mock mode runs the whole pipeline offline: a deterministic embedding model and a scripted model that answers by quoting the best-matching sentences, with citations. Build with `-e mock` and serve the endpoint locally with `npx ondocs dev`. [Try it locally](/docs/local-development) walks through it.
