---
title: Fumadocs
description: Index content/docs with the CLI, add the ask and MCP routes, and render AskDialog next to Fumadocs's search.
section: Integrations
order: 13.1
---

A Fumadocs site is a Next.js app, so ondocs is the same three pieces as in [Next.js](/docs/nextjs): an index built by the CLI from `content/docs`, route handlers for the ask and MCP endpoints, and the `<AskDialog />` component. The CLI reads `content/docs` as Fumadocs does, so every citation links to a page Fumadocs serves. This page follows a site made with `npm create fumadocs-app` and its Next.js template.

## Install for Fumadocs

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

## Index content/docs

Build the index before every build, and commit `ask-index.json`:

```json
{
  "scripts": {
    "index": "ondocs index content/docs --base-url /docs -e openai:text-embedding-3-small --dimensions 512",
    "prebuild": "npm run index"
  }
}
```

`--base-url /docs` is the `baseUrl` of the `loader()` in `lib/source.ts`. The CLI finds `next.config.mjs` above `content/docs` and follows Fumadocs's rules:

- `index.mdx` is its folder's page: `guides/index.mdx` is `/docs/guides`.
- `(group)` folders are left out: `(api)/reference.mdx` is `/docs/reference`.
- Every other file is a page of its own, as Fumadocs serves it, `page.mdx` and `_`-prefixed files included. If `defineDocs` leaves files out with `files`, pass the same patterns to `--ignore`.
- `meta.json` orders the sidebar but does not change URLs, so the index does not need it.
- A heading written `## Use Docker [#docker]` is cited at `#docker`, as Fumadocs anchors it.

Without an API key, replace `-e openai:text-embedding-3-small --dimensions 512` with `-e none` to build a keyword-only index, and leave `embeddingModel` out of the ask handler below.

## Mount the route handlers

The ask endpoint and the MCP endpoint are two route handlers that import the same index:

```ts
// app/api/ask/route.ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import index from '@/ask-index.json';

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
import index from '@/ask-index.json';

const handler = createMcpHandler({ index, siteName: 'the Acme docs' });

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

The template's `proxy.ts` only rewrites paths under `/docs`, so it leaves `/api/ask` and `/api/mcp` alone. Set `OPENAI_API_KEY` in your deployment's environment. The MCP endpoint calls no model, so agents can search the docs with no key at all: see [MCP server](/docs/mcp).

## Render the dialog

Render the dialog from a client component. Fumadocs's search opens with ⌘K, so `shortcut="i"` gives the dialog ⌘I. Fumadocs switches between light and dark with next-themes, which sets a `dark` class on `<html>` that the dialog does not read, so the component passes it the theme next-themes resolved. Install next-themes, the package Fumadocs already uses, with `npm i next-themes`:

```tsx
// components/ask.tsx
'use client';
import { useEffect, useState } from 'react';
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';
import { useTheme } from 'next-themes';
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

Then render `<Ask />` inside `<RootProvider>` in `app/layout.tsx`, after `{children}`, where next-themes is set up. `launcher` shows a floating "Ask AI" button, and `onNavigate` sends citations through the Next.js router instead of a full page load.

## llms.txt and Markdown pages

The template already serves `/llms.txt`, `/llms-full.txt` and a Markdown copy of each page at its URL plus `.md`, from its own routes and `proxy.ts`, in the order of your `meta.json` files. Keep them, and leave `--llms-txt` out of the index command. To point agents at the MCP endpoint, add a line to `app/llms.txt/route.ts`:

```ts
export async function GET() {
  const mcp = 'Agents can search these docs over MCP: https://docs.acme.dev/api/mcp';
  return new Response(`${await docsLlms.index()}\n\n${mcp}\n`);
}
```

To link each page to its copy from its `<head>`, add the template's own Markdown URL to the metadata of `app/docs/[[...slug]]/page.tsx`:

```ts
export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: { images: getPageImageUrl(page).url },
    alternates: { types: { 'text/markdown': getPageMarkdownUrl(page).url } },
  };
}
```

A Fumadocs site without these routes can have the CLI write the files instead, with `--llms-txt public`: see [llms.txt and Markdown pages](/docs/llms-txt#with-the-cli).

## Keep the index fresh in CI

Add the check to CI so a pull request that changes `content/docs` without rebuilding the index fails:

```sh
npx ondocs index content/docs --base-url /docs --check   # exit 1 if stale
```

The check never calls a model and needs no API key.
