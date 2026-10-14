---
# Generated from examples/nextjs/content/docs/model-providers.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Model providers'
description: 'Bring your own key for OpenAI, Anthropic, Google, xAI, AI Gateway or any AI SDK provider, and configure the embedding model.'
---

ondocs uses the Vercel AI SDK for every model call, so it works with OpenAI, Anthropic, Google and xAI, and with any other provider the AI SDK supports. You bring your own API key: requests go from your function straight to your provider, and ondocs never sees or proxies them.

## Two models, two jobs

ondocs uses two models. The embedding model turns chunks into vectors at build time and each question into a vector at request time; it must be the same model in both places. The language model writes the answer from the retrieved sources; you can change it at any time without rebuilding the index.

The index records which embedding model built it, and the handler checks it: a handler that embeds questions with another model fails with an error that names both, instead of returning poor answers.

## OpenAI

OpenAI is the default. Install `@ai-sdk/openai`, set `OPENAI_API_KEY` at build time and in your deployment, and pass both models to the handler:

```ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  embeddingProviderOptions: { openai: { dimensions: 512 } },
});
```

At 512 dimensions each vector is 512 bytes, stored as 684 characters of base64: a third of what the model's default 1,536 dimensions take. The CLI builds the matching index with `-e openai:text-embedding-3-small --dimensions 512`.

## Anthropic and Claude

To answer with Claude, install `@ai-sdk/anthropic`, set `ANTHROPIC_API_KEY`, and pass an Anthropic model as `model`. Anthropic does not offer an embedding model, so keep embeddings on another provider, such as OpenAI:

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createAskHandler } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: anthropic('claude-haiku-4-5'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  embeddingProviderOptions: { openai: { dimensions: 512 } },
});
```

Or build a keyword-only index with `-e none` and leave `embeddingModel` out, so the only key you need is Anthropic's.

## Google Gemini

Google offers both a chat model and an embedding model, so one `GOOGLE_GENERATIVE_AI_API_KEY` covers answers and vectors. Install `@ai-sdk/google`, and build the index from a [config file](./cli.md#the-config-file), since the CLI's `-e` specs name OpenAI and AI Gateway models:

```js
// ondocs.config.mjs
import { google } from '@ai-sdk/google';

/** @type {import('ondocs/node').AskConfig} */
export default {
  embeddingModel: google.embedding('gemini-embedding-001'),
  embeddingProviderOptions: { google: { outputDimensionality: 768 } },
};
```

Then give the handler the same embedding model and options, with a Gemini model for answers:

```ts
import { google } from '@ai-sdk/google';
import { createAskHandler } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: google('gemini-3.5-flash'),
  embeddingModel: google.embedding('gemini-embedding-001'),
  embeddingProviderOptions: { google: { outputDimensionality: 768 } },
});
```

`outputDimensionality` shrinks Gemini's vectors, as `dimensions` does OpenAI's; leave it out to keep the model's full size. The relevance gate's similarity threshold is chosen for OpenAI, so [check it](#tuning-for-another-embedding-model) against Gemini's scores.

## xAI and Grok

xAI's Grok writes answers, but xAI has no embedding model in the AI SDK. Install `@ai-sdk/xai`, set `XAI_API_KEY`, and pair Grok with another provider's embeddings, such as OpenAI's:

```ts
import { openai } from '@ai-sdk/openai';
import { xai } from '@ai-sdk/xai';
import { createAskHandler } from 'ondocs/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: xai('grok-4.20-non-reasoning'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  embeddingProviderOptions: { openai: { dimensions: 512 } },
});
```

Or build a keyword-only index with `-e none` and leave `embeddingModel` out, so the only key you need is xAI's. Through AI Gateway the model is a string, under the name AI Gateway lists xAI's models with: `model: 'spacexai/grok-4.20-non-reasoning'`.

## Workers AI

Cloudflare's Workers AI runs in a Cloudflare Worker through an `AI` binding, with no API key, and the `workers-ai-provider` package makes its models AI SDK models. The [Workers AI guide](./workers-ai.md) has a Worker that answers any static site with it, from the template or from `npx ondocs init --host github-pages`:

```ts
import { createWorkersAI } from 'workers-ai-provider';

const workersai = createWorkersAI({ binding: env.AI });
createAskHandler({
  index,
  model: workersai('@cf/meta/llama-4-scout-17b-16e-instruct'),
  embeddingModel: workersai.textEmbedding('@cf/baai/bge-small-en-v1.5'),
});
```

Build the index with the same embedding model, outside Cloudflare, over its REST API: `-e workers-ai:@cf/baai/bge-small-en-v1.5` for the CLI, or `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` in the plugins, with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with Workers AI Read and Edit permissions) set as the index builds.

## AI Gateway

With Vercel's AI Gateway, one `AI_GATEWAY_API_KEY` reaches every provider, and models are plain strings such as `model: 'openai/gpt-5.4-mini'` and `embeddingModel: 'openai/text-embedding-3-small'`. The CLI and the plugins take gateway ids as embedding specs, as in `-e cohere/embed-v4.0`, and use AI Gateway on their own when only `AI_GATEWAY_API_KEY` is set.

## Any other AI SDK provider

`model` takes any AI SDK language model, so Mistral, Groq, Amazon Bedrock, a local model through an OpenAI-compatible endpoint (Ollama or LM Studio, with `@ai-sdk/openai-compatible`), or any other provider package works the same way. Answers are streamed with `streamText`, and `generation` passes settings such as `temperature`, `maxOutputTokens` or `providerOptions` through to it.

## Configure the embedding model

The CLI and the plugins name the embedding model with a spec string, so a config file needs no provider import:

| Spec                    | Model                                                | Needs                |
| ----------------------- | ---------------------------------------------------- | -------------------- |
| `openai:<model>`        | An OpenAI embedding model, through `@ai-sdk/openai`  | `OPENAI_API_KEY`     |
| `<provider>/<model>`    | Any model on AI Gateway, such as `cohere/embed-v4.0` | `AI_GATEWAY_API_KEY` |
| `mock` or `mock:<dims>` | The offline mock embedder                            | nothing              |
| `none`                  | No vectors: a keyword-only index                     | nothing              |

`--dimensions 512` (or `dimensions: 512` in a plugin, its default) shrinks vectors for models that support it. For OpenAI's `text-embedding-3` models the handler reads the size from the index; for another provider's size option, pass the same value in `embeddingProviderOptions`. For a provider package the specs don't cover, export the model from a [config file](./cli.md#the-config-file):

```js
// ondocs.config.mjs
import { cohere } from '@ai-sdk/cohere';

/** @type {import('ondocs/node').AskConfig} */
export default {
  embeddingModel: cohere.embedding('embed-multilingual-v3.0'),
};
```

The handler then uses `cohere.embedding('embed-multilingual-v3.0')` as its `embeddingModel`. Changing the embedding model re-embeds every chunk on the next build.

## Keyword-only, without embeddings

An index built with `-e none` has no vectors, and retrieval is BM25 alone. It costs nothing to build and answers questions that use the docs' own words well, but it misses paraphrases. Its relevance gate relies on keyword coverage alone, so lower `retrieval.minKeywordCoverage` if it refuses reasonable questions.

## Tuning for another embedding model

The relevance gate's similarity threshold, 0.25, is chosen for OpenAI's `text-embedding-3-small`, and an index embedded with Workers AI's `@cf/baai/bge-small-en-v1.5` gets the 0.65 measured for it. Other embedding models produce other similarity ranges, so check the `best` scores that `retrieve()` reports on real questions and pass `retrieval: { minSimilarity }` to the handler. [How retrieval works](./retrieval.md#tuning) explains the gate.
