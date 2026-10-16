---
title: Try it locally
description: Run the whole pipeline on your machine with mock mode and ondocs dev, no API key.
section: Get started
order: 3
---

You can try ondocs on your own content in about two minutes, without an API key. Mock mode replaces both models with offline stand-ins, and `ondocs dev` serves the endpoint on your machine.

## Run the endpoint locally

To run the endpoint locally, index a folder of Markdown, MDX or HTML with the mock embedder, then start `ondocs dev`:

```sh
npm i ondocs
npx ondocs index ./docs -e mock   # writes ask-index.json
npx ondocs dev                    # serves POST http://localhost:8787/api/ask
```

`ondocs dev` answers from `ask-index.json`, or from `build/ask-index.json`, `dist/ask-index.json` or `.vitepress/dist/ask-index.json`, where the Docusaurus, Astro and VitePress plugins write theirs. It listens on 127.0.0.1 port 8787 (`--port`), answers pages on this machine only (`--allow-origin` adds another origin), and picks up a rebuilt index on the next question.

## Point the dialog at it

The plugins post to the `ASK_ENDPOINT` environment variable whenever it is set, over any `endpoint` option, so you don't edit any config:

```sh
ASK_ENDPOINT=http://localhost:8787/api/ask npm start
```

With React, render `<AskDialog endpoint="http://localhost:8787/api/ask" launcher />`. With the script tag, set `data-endpoint="http://localhost:8787/api/ask"`. Then press ⌘I (Ctrl+I outside macOS) and ask.

## What mock mode does

`mockEmbeddingModel()` hashes words and word pairs into 512-dimension vectors, so similarity tracks shared vocabulary. `mockLanguageModel()` answers extractively: it picks the sentences from the retrieved sources that best match the question and cites each one, and it never writes text of its own. Everything else is the production code path: chunking, the int8 index, hybrid retrieval, the relevance gate, streaming and citations.

Both models come from `ondocs/mock`. They are for demos, tests and local development. Retrieval over a mock index is lexical, so a question has to share words with the page that answers it. Its "I don't know" is lexical too, and more permissive than a real model's: an off-topic question that shares two words with a page, or half of its keyword weight, gets an answer quoted from that page. On docusaurus.io's docs, 6 of 15 off-topic Stack Overflow titles about git, Bash, SQL and Java still did, as many as from a keyword-only index. To see the gate your readers get, index with the embedding model you deploy, as in [Use a real model locally](#use-a-real-model-locally).

## Use a real model locally

With `OPENAI_API_KEY` set, `ondocs dev` answers with OpenAI's `gpt-5.4-mini` (`--model` picks another) instead of the mock model. With only `AI_GATEWAY_API_KEY` set, it answers through AI Gateway. Questions are always embedded with the model the index was built with: an index embedded with OpenAI needs one of the two keys, and an index it cannot match is refused with a message saying what to change.

The CLI and `ondocs dev` read `.env` and `.env.local` in the working directory, without overriding variables that are already set.

## The demo website

The ondocs website is a Next.js app that indexes these pages with `ondocs index` at build time and answers through `createAskHandler`. In production it answers with OpenAI, under a rate limit. Its preview deployments, and the example when you run it without a key, use mock mode: `mockLanguageModel()` answers with quotes from these docs, picked by the words they share with the question, where a real model writes full sentences from the same sources. The Docusaurus, Starlight and VitePress examples in the repository answer the same way through `ondocs dev`.
