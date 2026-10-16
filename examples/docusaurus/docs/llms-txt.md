---
# Generated from examples/nextjs/content/docs/llms-txt.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'llms.txt and Markdown pages'
description: 'Write llms.txt, llms-full.txt and a Markdown copy of every page at build time, from the pages the index is built from.'
---

Agents read docs as Markdown. With the same pages it indexes, ondocs writes three files that agents look for:

- **`llms.txt`**, as [llmstxt.org](https://llmstxt.org) describes it: the site's name, its summary, and a section of links per part of the site, each to the page's Markdown copy. It also names the [MCP server](./mcp.md): the plugin's `mcp` option, or the route the Astro integration serves with an adapter.
- **`llms-full.txt`**: every page in one file, for a model to read in one request.
- **A Markdown copy of each page**, at its URL plus `.md`: `/docs/intro.md` for `/docs/intro` or `/docs/intro/`, and `/index.md` for the site's root. That is where Mintlify, GitBook, Fumadocs and the Docusaurus and Starlight llms plugins put them. Each starts with a line pointing to `llms.txt`.

The pages are the ones in the index, so `exclude` leaves a page out of both. Built from the HTML the site serves, a copy keeps the page's links, emphasis, code blocks with their language, numbered and nested lists, tables and quotes. The index itself is unchanged: it holds the text it always did.

This site serves its own: [/llms.txt](https://ondocs.vercel.app/llms.txt), [/llms-full.txt](https://ondocs.vercel.app/llms-full.txt), and every page plus `.md`, as [/docs/mcp.md](https://ondocs.vercel.app/docs/mcp.md).

## In Docusaurus, Astro, Starlight and VitePress

The plugins write all three after the build, into the build output next to `ask-index.json`, with nothing to set: `build/` for Docusaurus, `dist/` for Astro (`dist/client/` with an adapter) and `.vitepress/dist/` for VitePress. Each locale gets its own, as the index does. `llms.txt` takes its title and summary from the site's title and its tagline (Docusaurus) or description (Starlight and VitePress), and links absolutely when the site has a URL: `url` in Docusaurus, `site` in Astro, `sitemap.hostname` or the plugin's `siteUrl` in VitePress.

Each page with a copy also links to it from its `<head>`, so an agent that fetches the page finds the Markdown without guessing the URL:

```html
<link rel="alternate" type="text/markdown" href="/docs/intro.md" />
```

The plugins add the link to the HTML they built, after the build, with the site's base path and the page's locale; it goes away with the copies. A page whose head already links a Markdown copy keeps its own, and when another plugin writes the copies, linking them is left to it. The link is in the HTML each page is served with, which is what an agent that fetches the page reads. Docusaurus and VitePress change pages in the browser without loading them, and there the head keeps the link of the page that was loaded.

Turn them off with `llmsTxt: false`, or one at a time:

```ts
plugins: [['ondocs/docusaurus', { llmsTxt: { full: false, markdown: false } }]],
```

`llmsTxt` takes `index`, `full` and `markdown` (each on by default), and `title` and `description` to name the site.

## Alongside other llms plugins

A site that already uses an llms plugin keeps it. The plugins never replace a file the build already has, from `static/` or `public/` or another plugin, and say so. They also leave out what a known plugin writes, by its name and options:

| Plugin                                                          | Leaves to it                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docusaurus-plugin-llms`                                        | `llms.txt`, `llms-full.txt`, and the `.md` copies with `generateMarkdownFiles` |
| `@signalwire/docusaurus-plugin-llms-txt` (and the unscoped one) | `llms.txt`, the `.md` copies unless turned off, and `llms-full.txt` when on    |
| `docusaurus-plugin-copy-page-button`                            | the `.md` copies, with `generateMarkdownRoutes`                                |
| `starlight-llms-txt`                                            | `llms.txt` and `llms-full.txt`                                                 |
| `starlight-page-actions`, `starlight-llm-actions`               | the `.md` copies                                                               |
| `vitepress-plugin-llms`                                         | `llms.txt`, `llms-full.txt` and the `.md` copies                               |

## With the CLI

`--llms-txt <dir>` writes the three files into `dir`, the folder your site serves at its root, such as `public/` in Next.js. A page's copy goes at its URL there: `/docs/intro` is `public/docs/intro.md`. Unlike the plugins, the CLI replaces what is there, since you named the folder.

```sh
npx ondocs index content/docs --base-url /docs --llms-txt public \
  --llms-title "Acme Docs" --llms-description "Docs for Acme." \
  --site-url https://docs.acme.dev --mcp-url https://docs.acme.dev/api/mcp
```

`--no-llms-index`, `--no-llms-full` and `--no-llms-markdown` leave one out, and a config module can set the same under `llmsTxt`. From Markdown sources, a copy keeps the Markdown as written, links and images included, without MDX imports and components. Relative links and images are resolved from the file's folder, so they work from the copy and from `llms-full.txt`: in `content/index.md`, copied to `/docs.md`, `./setup.md` becomes `/docs/setup.md`. This site runs it with `--no-llms-index`, because it curates its own `llms.txt` in its sidebar's order.

The CLI does not change your pages, so link each one to its copy from the page itself. In Next.js, that is `alternates.types` in the page's metadata:

```ts
// app/docs/[slug]/page.tsx
export async function generateMetadata(props: PageProps<'/docs/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  return { alternates: { types: { 'text/markdown': `/docs/${slug}.md` } } };
}
```

## Serving them

Static hosts serve `.md` files as they are; check that yours sends them as `text/markdown` or `text/plain` rather than as a download. Besides the `<link>` in each page, a host can send the same as a `Link` header, `Link: </docs/intro.md>; rel="alternate"; type="text/markdown"`, which the plugins do not set.
