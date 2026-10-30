---
title: Getting started
description: Install the package, build the index, deploy the endpoint and add the dialog.
section: Get started
order: 2
---

Every setup has the same two halves: an index built with your site, and an endpoint that answers from it. The integration you pick decides how much of that is done for you.

## Pick your setup

- **Starlight or Astro.** One plugin or integration in `astro.config.mjs`, which builds the index and adds the dialog. See [Astro and Starlight](/docs/astro).
- **Docusaurus.** One line in `docusaurus.config.ts`: the plugin builds the index and adds the dialog. See [Docusaurus](/docs/docusaurus).
- **VitePress.** Wrap the config in `.vitepress/config.mts` with `withOndocs`, which builds the index and adds the dialog. See [VitePress](/docs/vitepress).
- **Next.js or another React app.** Index with the CLI, mount `createAskHandler` as a route, and render `<AskDialog />`. See [Next.js and React](/docs/nextjs).
- **Fumadocs or Nextra.** The same, with the CLI following the framework's URLs. See [Fumadocs](/docs/fumadocs) and [Nextra](/docs/nextra).
- **Any other site.** Index the built HTML with the CLI, write the endpoint with `npx ondocs init`, and add one script tag. See [Script tag](/docs/script-tag).

With the Starlight, Astro, Docusaurus or VitePress plugin, follow your framework's guide and skip the steps below: the plugin builds the index and adds the dialog, the guide shows it answering on your machine with no key, and `npx ondocs init` writes the endpoint for your host, unless an Astro SSR adapter serves it. The steps below are for the CLI, Next.js and other React apps, and the script tag.

## Install

Install the package with the Vercel AI SDK and a model provider. The two packages the dialog is built on, `@radix-ui/react-dialog` and `cmdk`, are optional peer dependencies: leave them out if you only deploy the endpoint.

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

ondocs works with AI SDK 6 and 7, and provider packages of the same major, such as `@ai-sdk/openai` 3 or 4: see [Compatibility](#compatibility). ondocs needs Node.js 22.13 or later to build the index. The endpoint itself uses Web APIs only, so it also runs on Bun, Deno and Cloudflare Workers, and CI asks it a question on each. On Deno, allow the hostname as well as the network (`--allow-sys=hostname`): the AI SDK reads it as it loads.

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

`npx ondocs init` writes this for your host, with a rate limit and a daily budget: Vercel, Netlify, Cloudflare, or a Cloudflare Worker with Workers AI and no API key for a site on GitHub Pages. An Astro site with an SSR adapter needs nothing: the integration serves it. See [Deploying](/docs/deployment).

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

Mock mode runs the whole pipeline offline: a deterministic embedding model and a scripted model that answers by quoting the best-matching sentences, with citations. Build with `-e mock` and serve the endpoint locally with `npx ondocs dev`. [Try it locally](/docs/local-development) walks through it. With a plugin, its guide does the same in three commands, right after adding it.

## Compatibility

What `package.json` declares and CI runs:

| With            | Supported                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js         | 22.13 or later (`engines`). CI runs the CLI and the tests on 22.13.0 (the dialog's aside), 24 and 26, and the endpoint on Bun and Deno                                                                                                  |
| AI SDK          | 7 (`ai@^7.0.95`) and 6 (`ai@^6.0.16`), with providers of the same major. CI runs everything on 7; on 6.0.16 and the newest 6, the types, the tests not written for 7 only, the CLI and the endpoint. AI SDK 6 has no first-word timeout |
| React           | 18.3 and 19, on React sites. CI builds a Docusaurus site on 18.3.0 and the others on 19                                                                                                                                                 |
| Site frameworks | Tier 1, built in CI: Next.js, Fumadocs, Nextra, Docusaurus 3, Starlight, Astro, VitePress and the script tag. [Support tiers](/docs/limits#support-tiers) has the rest                                                                  |

## When something fails

[Troubleshooting](/docs/troubleshooting) lists the messages a new site shows most often, from a package manager that installs an older version to a dialog that cannot answer, with the cause and the fix of each.
