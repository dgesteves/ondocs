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

ondocs works with AI SDK 7 and AI SDK 6, each with provider packages of its own major, such as `@ai-sdk/openai` 4 or 3, so a project on AI SDK 6 keeps it: [Compatibility](#compatibility) has the versions. ondocs needs Node.js 22.13 or later to build the index. The endpoint itself uses Web APIs only, so it also runs on Bun, Deno and Cloudflare Workers, and CI asks it a question on each. On Deno, allow the hostname as well as the network (`--allow-sys=hostname`): the AI SDK reads it as it loads.

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

## Compatibility

What `package.json` declares and CI runs:

| With            | Supported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js         | 22.13 or later (`engines`). CI runs the tests and the built CLI on Node.js 22.13.0 (the dialog's jsdom tests aside), 24 and 26, and asks the endpoint a question on Bun and Deno.                                                                                                                                                                                                                                                                                                                                               |
| AI SDK          | 7 (`ai@^7.0.95`) and 6 (`ai@^6.0.16`), with provider packages of the same major, such as `@ai-sdk/openai` 4 or 3. CI runs everything on the lockfile's AI SDK 7, and the typecheck and the tests on 7.0.95. On the newest AI SDK 6 and on 6.0.16 it runs the tests, but those written for AI SDK 7's own test models and types, then the built CLI, and asks the built endpoint a question. AI SDK 6 has no timeout for the model's first word, so there `generation.timeout` defaults to 90 seconds for the whole answer only. |
| React           | 18.3 and 19, for the dialog on Docusaurus, Next.js and other React sites: CI builds a Docusaurus site on React 18.3.0 and the rest on 19. The Starlight, Astro and VitePress plugins and the script tag mount a dialog that brings its own React.                                                                                                                                                                                                                                                                               |
| Site frameworks | Tier 1, built in CI: Next.js, Fumadocs, Nextra, Docusaurus 3, Starlight, Astro, VitePress, and plain HTML with the script tag. Tier 2, documented only: Hugo, Jekyll, MkDocs and Eleventy with the script tag, and other React frameworks. [Support tiers](./limits.md#support-tiers) gives the evidence for each, and the tiers of hosts, model providers and MCP clients.                                                                                                                                                     |

## When something fails

[Troubleshooting](./troubleshooting.md) lists the messages a new site shows most often, from a package manager that installs an older version to a dialog that cannot answer, with the cause and the fix of each.
