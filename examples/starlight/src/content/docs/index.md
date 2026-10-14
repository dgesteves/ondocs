---
# Generated from examples/nextjs/content/docs/introduction.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Introduction'
description: 'What ondocs is: open-source Ask AI for your docs, with an MCP server for agents, from one static index. Who it is for, and when it is the wrong tool.'
---

ondocs is open-source Ask AI for your docs, with an MCP server for agents. A visitor types a question and gets a short answer written from your own pages, with numbered citations that link to the exact section each claim came from, or "I don't know" when the pages don't say. Coding agents search and read the same pages through the MCP server, with their own model. Both are served from one static index, built with your Starlight, Docusaurus, VitePress or Next.js site, by a function you deploy, and answers use your own model key: no vendor account and no vector database. It is an npm package under the MIT license, not a hosted service.

## How it works

At build time, `ondocs index` (or the Docusaurus, Astro, Starlight or VitePress plugin) splits your pages into chunks at every heading, embeds each chunk and writes one static JSON file, `ask-index.json`. Vectors are stored as int8, so a site of 1,000 chunks makes an index of about 1.6 MB.

At request time, a function you deploy loads that file into memory once and searches it for each question: BM25 keyword search and cosine similarity over the vectors, merged with reciprocal rank fusion. A relevance gate then decides whether anything found is good enough to answer from. If it is, your model streams an answer that cites its sources as `[1]`, `[2]`. If it is not, the answer is "I don't know", and the model is never called. That stops most questions the docs don't cover, not all of them: one that shares enough words with your pages, such as a general programming question, can clear the gate and reach the model, whose instructions are to answer only from the sources and to say it doesn't know when they don't hold the answer.

The same index is also an [MCP server](/integrations/mcp/) for agents, such as Claude Code, Cursor and ChatGPT: they search and read your docs with their own model, so that traffic calls no language model of yours, and with keyword search, no model at all.

## Who it is for

ondocs is for teams that run their own developer docs, at product, API and platform companies, and want Ask AI on those docs without a hosted assistant, with an MCP server for their docs that they run themselves.

It fits a Starlight site best: one plugin in `astro.config.mjs` adds the dialog, and with an SSR adapter the integration serves `/api/ask` and `/api/mcp` itself, so there is no endpoint file to write. Docusaurus and VitePress sites get one plugin each as well.

It adds less to an open-source library whose docs already have Algolia DocSearch with Ask AI: there, what ondocs changes is mainly where the index lives, in your build instead of on Algolia's platform, with no crawler and no search account.

## What you need

- Content in Markdown, MDX or HTML: a docs folder, or the HTML your static site generator builds.
- One serverless function to answer questions, on Vercel, Netlify, Cloudflare or any runtime that speaks Web `Request` and `Response`.
- For the Ask box, a model: a key for a provider you choose, such as OpenAI, Anthropic or any other the Vercel AI SDK supports, or Workers AI in a Cloudflare Worker, with no API key. The MCP server and llms.txt need no model. Trying it needs no key at all, because mock mode runs offline.

## What you don't need

There is no vector database, no ingestion pipeline to keep in sync, and no account with a search or chat vendor. The index is a file that ships with your site. The only data that leaves your infrastructure is what you send to your own model provider: the question and the excerpts retrieved to answer it.

## How it compares

Hosted assistants such as Kapa, Inkeep, Algolia Ask AI and Biel.ai ingest your docs into their platform and answer from there, and several of them now serve an MCP endpoint for agents too, as the docs platforms Mintlify and GitBook do. Search-only tools such as Pagefind and Orama's local index need no server, but they return links, not answers. ondocs sits between the two: a local index like Pagefind's, plus cited answers from a model you pick and an MCP server you run, with no cloud account. The [FAQ](/reference/faq/#how-is-it-different-from-kapa-inkeep-or-algolia-ask-ai) has the longer comparison, and [why to serve your own MCP server](/reference/faq/#why-serve-my-own-mcp-server-when-context7-deepwiki-or-docsearch-mcp-index-docs) when aggregators such as Context7 already serve docs to agents.

## When it fits

ondocs fits documentation sites, product sites, blogs and changelogs: content of up to tens of thousands of chunks that changes when you deploy. It ships a plugin for Starlight, an integration for Astro, a plugin for Docusaurus, a plugin for VitePress, React components for Next.js and other React apps, with guides for Fumadocs and Nextra, and a script tag for everything else, such as Hugo, Jekyll, Eleventy or MkDocs.

## When it is the wrong tool

It is the wrong tool for content that changes per user or per request, for corpora much larger than 50,000 chunks, and for open-ended chat: it answers questions from your pages, and a follow-up leans on the last three questions and their answers, nothing older. If you want search results without running any server code, use Pagefind. [Limits and trade-offs](/reference/limits/) has the details.
