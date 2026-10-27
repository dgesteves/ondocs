---
# Generated from examples/nextjs/content/docs/nextra.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Nextra'
description: "Index Nextra's content folder with the CLI, write llms.txt with it, add the ask and MCP routes, and render AskDialog in the docs theme."
---

# Nextra

Nextra has no `llms.txt` or MCP server of its own, and for Ask AI its docs point to [Inkeep](https://nextra.site/docs/guide/search/ai), a hosted service. ondocs adds all three, self-hosted, from one index built from your content: the Ask box answers on your own model key, agents search the same index over [MCP](/mcp) with no model call, and the CLI writes `llms.txt` with a Markdown copy of each page.

A Nextra site is a Next.js app, so ondocs is the same three pieces as in [Next.js](/nextjs): an index built by the CLI from your content folder, route handlers for the ask and MCP endpoints, and the `<AskDialog />` component. This page follows Nextra 4 with the docs theme and a `content` folder served under `/docs` (`contentDirBasePath: '/docs'`). In a project with a `src` folder, the folders are `src/content` and `src/app`.

## Install for Nextra

Nextra 4 has no command that creates a site. To start one, copy the docs starter from Nextra's own repository at the 4.6.1 release, the one this page was checked with and CI builds with ondocs:

```sh
git clone --depth 1 --branch nextra@4.6.1 --filter blob:none --sparse https://github.com/shuding/nextra.git nextra
git -C nextra sparse-checkout set examples/docs
cp -R nextra/examples/docs my-docs
```

In `my-docs/package.json`, change `nextra` and `nextra-theme-docs` from `workspace:*`, a link into Nextra's own repository, to `4.6.1`. The starter has a `src` folder: its pages are in `src/content` and its app in `src/app`.

In the site's folder, install ondocs, the AI SDK and the dialog's two dependencies:

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

Nextra 4.6.1's starter fails `next build` with zod 4.6 ("Invalid input: expected nonoptional, received undefined"), with or without ondocs. Pin zod 4.1.13 for `nextra` and `nextra-theme-docs` only, so ondocs keeps the zod it needs. With npm, in `package.json`:

```json
{
  "overrides": {
    "nextra": { "zod": "4.1.13" },
    "nextra-theme-docs": { "zod": "4.1.13" }
  }
}
```

With pnpm, in `pnpm-workspace.yaml`:

```yaml
overrides:
  nextra>zod: 4.1.13
  nextra-theme-docs>zod: 4.1.13
```

## Index your content

Build the index before every build, and commit `ask-index.json`:

```json
{
  "scripts": {
    "index": "ondocs index content --base-url /docs -e openai:text-embedding-3-small --dimensions 512 --llms-txt public",
    "prebuild": "npm run index"
  }
}
```

`--base-url` is your `contentDirBasePath`; leave it out when the content folder is served at the root. The CLI finds `next.config.mjs`, sees `nextra` in `package.json`, and follows Nextra's rules:

- `index.mdx` is its folder's page: `content/index.mdx` is `/docs`.
- Every other file is a page of its own, as Nextra serves it, `page.mdx` and `_`-prefixed files included.
- Folders keep their names in the URL, `(group)` folders too: `content/(group)/setup.mdx` is `/docs/(group)/setup`.
- `_meta` files order the sidebar and can hide a page from it, but the page is still served, so it is still indexed. Leave one out with `ask: false` in its frontmatter or with `--ignore`.
- A heading written `## Use Docker [#docker]` is cited at `#docker`, as Nextra anchors it.

Without an API key, replace `-e openai:text-embedding-3-small --dimensions 512` with `-e none` to build a keyword-only index, and leave `embeddingModel` out of the ask handler below.

## Mount the route handlers

The ask endpoint and the MCP endpoint are two route handlers that import the same index:

```js
// app/api/ask/route.js
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import index from '../../../ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  siteName: 'Acme Docs',
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
```

```js
// app/api/mcp/route.js
import { createMcpHandler } from 'ondocs/server';
import index from '../../../ask-index.json';

const handler = createMcpHandler({ index, siteName: 'the Acme docs' });

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

In a project with a `src` folder, the routes are in `src/app/api` and import `../../../../ask-index.json`. Set `OPENAI_API_KEY` in your deployment's environment. The MCP endpoint calls no model, so agents can search the docs with no key at all: see [MCP server](/mcp).

## Render the dialog

Render the dialog from a client component. Nextra's search box takes ⌘K, so `shortcut="i"` gives the dialog ⌘I. The docs theme switches between light and dark with next-themes, which sets a `dark` class on `<html>` that the dialog does not read, so the component passes it the theme from `useTheme`, which `nextra-theme-docs` exports:

```jsx
// components/ask.jsx
'use client';
import { useEffect, useState } from 'react';
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';
import { useTheme } from 'nextra-theme-docs';
import { useRouter } from 'next/navigation';

export function Ask() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  // next-themes knows the theme only once the page runs; until then, follow the system's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <AskDialog
      launcher
      shortcut="i"
      title="Ask Acme Docs"
      theme={mounted ? (resolvedTheme === 'dark' ? 'dark' : 'light') : undefined}
      suggestions={['How do I install it?']}
      onNavigate={(url, event) => {
        event.preventDefault();
        router.push(url);
      }}
    />
  );
}
```

Then render `<Ask />` inside the theme's `<Layout>` in `app/layout.jsx`, after `{children}`, where next-themes is set up. `launcher` shows a floating "Ask AI" button, and `onNavigate` sends citations through the Next.js router instead of a full page load. `title` names the dialog after your docs; without it, it is "Ask this site", as the endpoint's `siteName` stays on the server.

## Add to your editor

`McpInstall` from `ondocs/react` shows readers how to connect their AI tool to the MCP endpoint: "Add to Cursor", "Add to VS Code" and "Add to Claude" links, and the commands for Claude Code, Codex and Gemini CLI. Put it on a page of the docs, such as `content/mcp.mdx`, with the endpoint's absolute URL and the name clients list it under:

```mdx
import { McpInstall } from 'ondocs/react';

<McpInstall url="https://docs.acme.dev/api/mcp" name="acme-docs" />
```

It is plain markup, links and code blocks with `ask-mcp-*` classes, for your theme to style. See [Show it on your site](/mcp#show-it-on-your-site).

## llms.txt and Markdown pages

`--llms-txt public` writes `llms.txt`, `llms-full.txt` and a Markdown copy of each page at its URL plus `.md` into `public/`, which Next.js serves as they are: `/docs/get-started.md` for `/docs/get-started`, and `/docs.md` for `/docs`. A copy keeps the page's Markdown, without MDX imports and components. Name the site and point agents at the MCP endpoint with `--llms-title "Acme Docs" --site-url https://docs.acme.dev --mcp-url https://docs.acme.dev/api/mcp`; see [llms.txt and Markdown pages](/llms-txt#with-the-cli). The files are written again on every build, so you can leave them out of git.

To link each page to its copy from its `<head>`, add it to the metadata of the catch-all page that renders your content:

```js
// app/docs/[[...mdxPath]]/page.jsx
export async function generateMetadata(props) {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  const markdown = ['/docs', ...(params.mdxPath ?? [])].join('/') + '.md';
  return { ...metadata, alternates: { types: { 'text/markdown': markdown } } };
}
```

## Pages in the app folder

If your pages are `page.mdx` files in `app` rather than in a content folder, index `app`, without `--base-url`. The CLI reads it as Next.js routes it: only `page.mdx` files are pages, `(group)` folders are left out of URLs, and `_private` and `[dynamic]` folders are skipped, so `app/guides/(setup)/install/page.mdx` is `/guides/install`.

## Keep the index fresh in CI

Add the check to CI so a pull request that changes your content without rebuilding the index fails:

```sh
npx ondocs index content --base-url /docs --check   # exit 1 if stale
```

The check never calls a model and needs no API key.
