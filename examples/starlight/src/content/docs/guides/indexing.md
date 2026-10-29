---
# Generated from examples/nextjs/content/docs/indexing.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Indexing content'
description: 'What gets indexed, how files become URLs, chunking, excluding pages and the --check mode.'
sidebar:
  order: 20
---

Indexing turns your pages into chunks, embeds each chunk and writes everything to one JSON file. The CLI does it for any folder; the Docusaurus, Astro, Starlight and VitePress plugins do it after every build.

## Supported content

The CLI reads `.md`, `.mdx`, `.markdown`, `.html` and `.htm` files recursively, and skips dot-folders, `node_modules` and the 404 page a generator writes: `404.html`, `404.htm` or `404/index.html`, at any depth. A page such as `404-errors.html` is still indexed. MDX is reduced to text without being evaluated, so code fences stay as they are but components that render content from props are invisible to the index. HTML is read from each page's `<main>`, then its `<article>`s, then `<body>`, with navigation, scripts, forms and other chrome stripped and heading `id`s kept.

For content that is not on disk, such as a CMS, pass `{ id, url, title, content }` records through the `documents` field of a [config file](/reference/cli/#the-config-file), or call `buildIndex` yourself.

## Frontmatter

Markdown files can set `title` and `url` (or `permalink`) in YAML frontmatter. A `url` must be a path or an http(s) URL: citations link to it, so a `javascript:` or `data:` URL fails the build. Without a title, the first `# Heading` is used, then the file name.

## Excluding pages

There are four ways to keep pages out of the index:

- Frontmatter: `draft: true`, `ask: false` or `noindex: true` leaves a page out.
- The CLI: `--ignore 'changelog/**'` skips matching files, and is repeatable. Globs support `*`, `**`, `?`, `[...]` and `{a,b}`.
- The plugins: `exclude: ['/changelog']` leaves out a path and everything under it.
- HTML: a page with `<meta name="robots" content="noindex">` is skipped, and in Starlight, anything marked `data-pagefind-ignore`.

## How files become URLs

A file path becomes a URL by dropping the extension, so `guides/setup.md` is cited as `/guides/setup`. `index.md`, `_index.md` (Hugo), `index.html` and `README.md` stand for their folder. Other HTML files keep `.html` (`docs/install.html` is `/docs/install.html`) unless you pass `--clean-urls`. `--base-url /docs` adds a prefix, or a full origin. Frontmatter `url` or `permalink` always wins.

Docs frameworks don't all map files to URLs the same way, so the CLI looks for a framework's config in or above the content folder and follows its rules:

| Framework                    | Detected from                              | Rules                                                                                                                                                           |
| ---------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docusaurus                   | `docusaurus.config.*`                      | `slug` and `id` frontmatter (an `id` is used as written), number prefixes dropped from file and folder names (`01-intro.md` is `intro`), `_` files are partials |
| Starlight                    | `astro.config.*` with `@astrojs/starlight` | `slug` frontmatter, slugified path segments, `_` files skipped                                                                                                  |
| Fumadocs, or Next.js content | `next.config.*` or `source.config.ts`      | `index.mdx` is its folder's page, `(group)` folders left out, `[#id]` heading ids                                                                               |
| Nextra                       | the same, with `nextra` in `package.json`  | `index.mdx` is its folder's page, `(group)` folders kept, `[#id]` heading ids                                                                                   |
| Next.js App Router           | the same, for an `app` or `src/app` folder | only `page.mdx` files, `(group)` folders left out, `_private` folders skipped                                                                                   |

`--framework` overrides the detection; `next` covers all three, told apart by the folder and `package.json`. Docusaurus serves docs under `/docs` by default, so pass `--base-url /docs` there. The Docusaurus rules were checked against Docusaurus's own `getSlug`: all 92 pages of docusaurus.io's docs get the URL Docusaurus serves.

## Chunking

Chunks never cross a heading, so every chunk has exactly one heading path and one anchor, and a citation links to the section, not just the page. Within a section, paragraphs are packed up to 1,200 characters (`--chunk-size`). Oversized blocks are split by line, then sentence, then word, and consecutive chunks of a section share up to 150 characters (`--chunk-overlap`). Code blocks are never split in the middle of a line.

Each chunk is embedded together with its page title and heading path, as in `Deploying › Netlify`, so a short section keeps its context. Anchors are the slugs GitHub, rehype-slug and Docusaurus generate, or your own `{#id}`, or `{/* #id */}` as Docusaurus writes it in MDX.

## Incremental rebuilds

Every chunk records a hash of exactly the text it was embedded from. On a rebuild, unchanged chunks reuse their previous vectors, so only edited sections are sent to the embedding model. The plugins keep the previous vectors in `node_modules/.cache/ondocs` between builds.

## Checking the index in CI

To fail CI when the index is stale, run the same command with `--check`. It exits with code 1 when the committed index no longer matches the content, and lists which chunks were added, changed or removed:

```sh
npx ondocs index ./docs --base-url /docs --check
```

The check re-chunks the content and compares content hashes. It never calls an embedding model and needs no API key. The plugins rebuild the index with the site, so they need no check.
