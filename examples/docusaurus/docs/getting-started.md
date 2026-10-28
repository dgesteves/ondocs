---
# Generated from examples/nextjs/content/docs/getting-started.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Getting started'
description: 'Install the package, build the index, deploy the endpoint and add the dialog.'
---

Every setup has the same two halves: an index built with your site, and an endpoint that answers from it. The integration you pick decides how much of that is done for you.

## Pick your setup

- **Starlight or Astro.** One plugin or integration in `astro.config.mjs`, which builds the index and adds the dialog. See [Astro and Starlight](./astro.md).
- **Docusaurus.** One line in `docusaurus.config.ts`: the plugin builds the index and adds the dialog. See [Docusaurus](./docusaurus.md).
- **VitePress.** Wrap the config in `.vitepress/config.mts` with `withOndocs`, which builds the index and adds the dialog. See [VitePress](./vitepress.md).
- **Next.js or another React app.** Index with the CLI, mount `createAskHandler` as a route, and render `<AskDialog />`. See [Next.js and React](./nextjs.md).
- **Fumadocs or Nextra.** The same, with the CLI following the framework's URLs. See [Fumadocs](./fumadocs.md) and [Nextra](./nextra.md).
- **Any other site.** Index the built HTML with the CLI, write the endpoint with `npx ondocs init`, and add one script tag. See [Script tag](./script-tag.md).

With the Starlight, Astro, Docusaurus or VitePress plugin, follow your framework's guide and skip the steps below: the plugin builds the index and adds the dialog, the guide shows it answering on your machine with no key, and `npx ondocs init` writes the endpoint for your host, unless an Astro SSR adapter serves it. The steps below are for the CLI, Next.js and other React apps, and the script tag.

## Install

Install the package with the Vercel AI SDK and a model provider. The two packages the dialog is built on, `@radix-ui/react-dialog` and `cmdk`, are optional peer dependencies: leave them out if you only deploy the endpoint.

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

ondocs is built on AI SDK 7: install `ai` 7 and its provider packages, such as `@ai-sdk/openai` 4. A project still on AI SDK 6 has to move to 7 first. ondocs needs Node.js 22.12 or later to build the index. The endpoint itself uses Web APIs only, so it also runs on Bun, Deno and Cloudflare Workers, and CI asks it a question on each. On Deno, allow the hostname as well as the network (`--allow-sys=hostname`): the AI SDK reads it as it loads.

## Build the index

Point the CLI at your content. It reads Markdown, MDX and HTML, splits pages at every heading, embeds the chunks and writes `ask-index.json`:

```sh
npx ondocs index ./docs --base-url /docs \
  -e openai:text-embedding-3-small --dimensions 512
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
  // The index's model, at the index's 512 dimensions.
  embeddingModel: openai.embedding('text-embedding-3-small'),
});
```

`npx ondocs init` writes this for your host, with a rate limit and a daily budget: Vercel, Netlify, Cloudflare, or a Cloudflare Worker with Workers AI and no API key for a site on GitHub Pages. An Astro site with an SSR adapter needs nothing: the integration serves it. See [Deploying](./deployment.md).

## Add the dialog

In a React app, render the dialog once near the root and import its two stylesheets:

```tsx
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';

<AskDialog launcher suggestions={['How do I install it?']} />;
```

`launcher` adds a floating "Ask AI" button. The dialog also opens with ⌘I on macOS and Ctrl+I elsewhere, so ⌘K stays with your site's search. The plugins and the script tag add the same dialog for you, with the same shortcut.

## Try it without an API key

Mock mode runs the whole pipeline offline: a deterministic embedding model and a scripted model that answers by quoting the best-matching sentences, with citations. Build with `-e mock` and serve the endpoint locally with `npx ondocs dev`. [Try it locally](./local-development.md) walks through it. With a plugin, its guide does the same in three commands, right after adding it.

## When something fails

[Troubleshooting](./troubleshooting.md) lists the messages a new site shows most often, from a package manager that installs an older version to a dialog that cannot answer, with the cause and the fix of each.
