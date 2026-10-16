---
# Generated from examples/nextjs/content/docs/nextjs.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Next.js and React'
description: 'Index with the CLI, mount createAskHandler as a route handler, and render AskDialog.'
sidebar:
  order: 13
---

In a Next.js app, or any React app with a server, ondocs is three pieces: an index built by the CLI, a route handler made with `createAskHandler`, and the `<AskDialog />` component. The ondocs website is built exactly this way.

## Install for Next.js

```sh
npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

`@radix-ui/react-dialog` and `cmdk` work with React 18.3 and 19.

## Index your content

Build the index from the folder that holds your pages, and commit `ask-index.json`. Running it before every build keeps it current, and only changed chunks are embedded again:

```json
{
  "scripts": {
    "index": "ondocs index content --base-url /docs -e openai:text-embedding-3-small --dimensions 512 --llms-txt public",
    "prebuild": "npm run index"
  }
}
```

`--base-url /docs` makes `content/setup.md` cite `/docs/setup`. The CLI detects a Next.js site and leaves `(group)` folders out of URLs. Fumadocs and Nextra have guides of their own: [Fumadocs](/integrations/fumadocs/) and [Nextra](/integrations/nextra/).

Citations link to those URLs, so the app must serve the pages there. A new `create-next-app` project has no `content/` folder and no `/docs` route: add your pages and a route under `app/docs/` that renders them, or set `--base-url` to where your pages already are.

`--llms-txt public` also writes `llms.txt`, `llms-full.txt` and a Markdown copy of each page into `public/`, which Next.js serves from the site's root: `/docs/setup.md` for `/docs/setup`. See [llms.txt and Markdown pages](/integrations/llms-txt/).

## Mount the route handler

To add the endpoint to Next.js, export the handler as `POST` from a route handler. It is a plain `(request: Request) => Promise<Response>` function:

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

Importing the JSON bundles the index with the function, and it is loaded into memory once per server instance. Set `OPENAI_API_KEY` in your deployment's environment: without it, the dialog shows `Answers aren’t set up on this site yet.` for every question it does not refuse. See [Troubleshooting](/get-started/troubleshooting/#answers-arent-set-up-on-this-site-yet).

## Serve agents over MCP

The same index answers coding agents from a second route, with `createMcpHandler`. Without an `embeddingModel`, it calls no model:

```ts
// app/api/mcp/route.ts
import { createMcpHandler } from 'ondocs/server';
import index from '../../../ask-index.json';

const handler = createMcpHandler({ index, siteName: 'Acme Docs' });

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

Agents connect to `/api/mcp`, as in `claude mcp add --transport http acme-docs https://docs.acme.dev/api/mcp`. See [MCP server](/integrations/mcp/).

## Render the dialog

Render the dialog once, near the root, from a client component. `onNavigate` sends citations through the Next.js router instead of a full page load:

```tsx
// app/ask.tsx
'use client';
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';
import { useRouter } from 'next/navigation';

export function Ask() {
  const router = useRouter();
  return (
    <AskDialog
      launcher
      suggestions={['How do I install it?', 'Which runtimes are supported?']}
      onNavigate={(url, event) => {
        event.preventDefault();
        router.push(url);
      }}
    />
  );
}
```

Then render `<Ask />` in `app/layout.tsx`. `launcher` shows a floating "Ask AI" button; the dialog also opens with ⌘I or Ctrl+I.

## Open it from your own button

For an "Ask AI" button in your header, with the shortcut on it, render [`AskButton`](/reference/ask-dialog/#the-ask-button) in place of `<AskDialog />`: it is the dialog and its button, and takes the same props. Or leave `launcher` out and pass `trigger` to open the dialog from an element of your own, such as a search box: `<AskDialog trigger={<button type="button">Ask the docs</button>} />`. Change the shortcut with `shortcut="k"`, for ⌘K on a site whose only search is this dialog, or turn it off with `shortcut={false}`.

## Other React frameworks and runtimes

`createAskHandler` returns a Web-standard handler, so it mounts anywhere that speaks `Request` and `Response`: `app.post('/api/ask', (c) => handler(c.req.raw))` in Hono, `Bun.serve({ fetch: handler })`, or `export default { fetch: handler }` in a Cloudflare Worker. React Router, Remix, SvelteKit and Astro endpoints also receive a `Request`, which you pass to the handler as it is. The dialog only needs React and the endpoint's URL.

## Build your own interface

`useAsk()` from `ondocs/react` is the hook behind the dialog. It returns `ask`, `stop` and `reset`, plus the streaming `answer`, its `sources` and a `status`, so you can render answers inline on a page instead of in a dialog. `AskAnswer` renders an answer with clickable citations. See [The ask dialog](/reference/ask-dialog/#the-useask-hook).

## Keep the index fresh in CI

Add the check to CI so a pull request that changes content without rebuilding the index fails:

```sh
npx ondocs index content --base-url /docs --check   # exit 1 if stale
```

The check never calls a model and needs no API key.
