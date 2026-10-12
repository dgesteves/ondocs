---
# Generated from examples/nextjs/content/docs/nextra.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Nextra'
description: "Index Nextra's content folder with the CLI, write llms.txt with it, add the ask and MCP routes, and render AskDialog in the docs theme."
sidebar:
  order: 13.2
---

A Nextra site is a Next.js app, so ondocs is the same three pieces as in [Next.js](/integrations/nextjs/): an index built by the CLI from your content folder, route handlers for the ask and MCP endpoints, and the `<AskDialog />` component. Nextra has no `llms.txt` of its own, so the CLI writes it, with a Markdown copy of each page. This page follows Nextra 4 with the docs theme and a `content` folder served under `/docs` (`contentDirBasePath: '/docs'`). In a project with a `src` folder, the folders are `src/content` and `src/app`.

## Install for Nextra

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
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

```ts
// app/api/ask/route.ts
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

```ts
// app/api/mcp/route.ts
import { createMcpHandler } from 'ondocs/server';
import index from '../../../ask-index.json';

const handler = createMcpHandler({ index, siteName: 'the Acme docs' });

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

In a project with a `src` folder, the routes are in `src/app/api` and import `../../../../ask-index.json`. Set `OPENAI_API_KEY` in your deployment's environment. The MCP endpoint calls no model, so agents can search the docs with no key at all: see [MCP server](/integrations/mcp/).

## Render the dialog

Render the dialog from a client component. Nextra's search box takes ⌘K, so `shortcut="i"` gives the dialog ⌘I. The docs theme switches between light and dark with next-themes, which sets a `dark` class on `<html>` that the dialog does not read, so the component passes it the theme from `useTheme`, which `nextra-theme-docs` exports:

```tsx
// components/ask.tsx
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
      theme={mounted ? (resolvedTheme === 'dark' ? 'dark' : 'light') : 'system'}
      suggestions={['How do I install it?']}
      onNavigate={(url, event) => {
        event.preventDefault();
        router.push(url);
      }}
    />
  );
}
```

Then render `<Ask />` inside the theme's `<Layout>` in `app/layout.jsx`, after `{children}`, where next-themes is set up. `launcher` shows a floating "Ask AI" button, and `onNavigate` sends citations through the Next.js router instead of a full page load.

## llms.txt and Markdown pages

`--llms-txt public` writes `llms.txt`, `llms-full.txt` and a Markdown copy of each page at its URL plus `.md` into `public/`, which Next.js serves as they are: `/docs/get-started.md` for `/docs/get-started`, and `/docs.md` for `/docs`. A copy keeps the page's Markdown, without MDX imports and components. Name the site and point agents at the MCP endpoint with `--llms-title "Acme Docs" --site-url https://docs.acme.dev --mcp-url https://docs.acme.dev/api/mcp`; see [llms.txt and Markdown pages](/integrations/llms-txt/#with-the-cli). The files are written again on every build, so you can leave them out of git.

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
