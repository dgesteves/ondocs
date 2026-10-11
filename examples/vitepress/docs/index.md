---
# Generated from examples/nextjs/content/docs/introduction.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Introduction'
description: 'What ondocs is, who it is for, and when it is the wrong tool.'
---

# Introduction

ondocs is a self-hosted "Ask AI" box for documentation sites. A visitor types a question and gets a short answer written from your own pages, with numbered citations that link to the exact section each claim came from. It is an open-source npm package under the MIT license, not a hosted service.

It was published as `ask-my-site` until 0.6.0: [Migrating from ask-my-site](/migrating) lists what was renamed.

## How it works

At build time, `ondocs index` (or the Docusaurus, Astro, Starlight or VitePress plugin) splits your pages into chunks at every heading, embeds each chunk and writes one static JSON file, `ask-index.json`. Vectors are stored as int8, so a site of 1,000 chunks makes an index of about 1.6 MB.

At request time, a function you deploy loads that file into memory once and searches it for each question: BM25 keyword search and cosine similarity over the vectors, merged with reciprocal rank fusion. A relevance gate then decides whether anything found is good enough to answer from. If it is, your model streams an answer that cites its sources as `[1]`, `[2]`. If it is not, the answer is "I don't know", and the model is never called.

The same index is also an [MCP server](/mcp) for agents, such as Claude Code, Cursor and ChatGPT: they search and read your docs with their own model, so that traffic costs you no model call.

## What you need

- Content in Markdown, MDX or HTML: a docs folder, or the HTML your static site generator builds.
- One serverless function to answer questions, on Vercel, Netlify, Cloudflare or any runtime that speaks Web `Request` and `Response`.
- A key for a model provider you choose: OpenAI, Anthropic, or any other provider the Vercel AI SDK supports. Trying it needs no key at all, because mock mode runs offline.

## What you don't need

There is no vector database, no ingestion pipeline to keep in sync, and no account with a search or chat vendor. The index is a file that ships with your site. The only data that leaves your infrastructure is what you send to your own model provider: the question and the excerpts retrieved to answer it.

## How it compares

Hosted assistants such as Kapa, Inkeep, Algolia Ask AI, Biel.ai and Markprompt ingest your docs into their platform and answer from there. Search-only tools such as Pagefind and Orama's local index need no server, but they return links, not answers. ondocs sits between the two: a local index like Pagefind's, plus cited answers from a model you pick, with no cloud account. The [FAQ](/faq#how-is-it-different-from-kapa-inkeep-or-algolia-ask-ai) has the longer comparison.

## When it fits

ondocs fits documentation sites, product sites, blogs and changelogs: content of up to tens of thousands of chunks that changes when you deploy. It ships a plugin for Docusaurus, a plugin for Starlight, an integration for Astro, a plugin for VitePress, React components for Next.js and other React apps, and a script tag for everything else, such as Hugo, Jekyll, Eleventy or MkDocs.

## When it is the wrong tool

It is the wrong tool for content that changes per user or per request, for corpora much larger than 50,000 chunks, and for open-ended chat: it answers questions from your pages, and a follow-up leans on the last three questions and their answers, nothing older. If you want search results without running any server code, use Pagefind. [Limits and trade-offs](/limits) has the details.
