---
title: FAQ
description: Short answers to the questions people ask first, with links to the details.
section: Reference
order: 36
---

## What is ondocs?

ondocs is a self-hosted "Ask AI" box for documentation sites: a build-time index, in-memory hybrid search, and streamed answers with citations from a model you choose. It is an open-source npm package, not a hosted service. See the [introduction](/docs/introduction).

## Is it free?

Yes. ondocs is free and open source under the MIT license, with no paid tier and no hosted service. You pay only your model provider for the calls your endpoint makes, under your own API key.

## How much does it cost to run?

An answered question costs one embedding call and one model call, with at most 8,000 characters of sources in and 800 tokens out by default, and a follow-up that needs rewriting one more short call. A question the docs can't answer costs the embedding call only, because the model is never called. Hosting is one function and one static file. See [cost](/docs/deployment#cost).

## Do I need a vector database?

No. The index is a static JSON file built with your site, and the endpoint searches it in memory: 0.71 ms per query at 1,000 chunks. A vector database only pays off past about 50,000 chunks, or for content that changes between deploys.

## Do I need an API key to try it?

No. Mock mode runs the whole pipeline offline with a deterministic embedder and a model that quotes your pages: `npx ondocs index ./docs -e mock`, then `npx ondocs dev`. In production you need a key for your model provider. See [Try it locally](/docs/local-development).

## Can I use Claude or other models?

Yes. Answers come from any Vercel AI SDK language model: OpenAI's, Anthropic's Claude, Google's Gemini, xAI's Grok, Mistral's, or any model on AI Gateway. Embeddings come from any AI SDK embedding model, such as OpenAI's or Google's. Anthropic and xAI have none, so pair Claude or Grok with another provider's embeddings, or build a keyword-only index. See [Model providers](/docs/model-providers).

## Can I use my ChatGPT Plus, Claude Pro or SuperGrok subscription?

No. A site that answers its visitors calls a model through an API, and chat subscriptions such as ChatGPT Plus, Claude Pro or SuperGrok don't include API access: the API is billed on its own, per use, with an API key from the provider's developer platform. The free option is a model you run yourself, for example with Ollama or LM Studio, which serve an OpenAI-compatible endpoint the AI SDK can call; it needs a machine your endpoint can reach.

## Where are my docs and questions sent?

Only to your own model provider. Your endpoint sends the question to the embedding model, and the question with the retrieved excerpts to the language model, under your API key. ondocs runs no service and sends no telemetry. See [Privacy](/docs/security#privacy-what-leaves-your-servers).

## Where does the index live?

In `ask-index.json`, a static file next to your site: in your repository when you build it with the CLI, or in `build/` or `dist/` when a plugin builds it. The endpoint imports it, reads it from the build output, or fetches it from a URL. See [Where the index lives](/docs/deployment#where-the-index-lives).

## How large can my site be?

ondocs is comfortable on sites as large as 10,000 chunks, and workable to about 50,000. At 10,000 chunks the index is 15.7 MB, loads in 339 ms and answers a query in about 7 ms. Every section of a page makes at least one chunk, of up to 1,200 characters. See [Benchmarks](/docs/benchmarks).

## What happens when the docs don't cover a question?

The relevance gate finds nothing good enough and the endpoint answers "I don't know. I couldn't find anything about that on this site." without calling the model. That refusal is fast, free and deterministic. See [Saying "I don't know"](/docs/retrieval#saying-i-dont-know).

## Does it support follow-up questions?

Yes. The dialog sends the thread with each question, and the endpoint rewrites a follow-up such as "and on Netlify?" into a question that stands on its own before it searches, with one short model call. A question that already stands on its own is not rewritten. "New question" in the dialog starts over. See [Follow-up questions](/docs/ask-endpoint#follow-up-questions).

## Does it work for docs that aren't in English?

Yes, through the embedding model: a multilingual model such as Cohere's `embed-multilingual-v3.0` matches questions and pages across languages. The keyword side uses English stopwords, so it is weaker in other languages. The plugins build one index per locale, the dialog sends the page's locale so the endpoint answers from that locale's index, and every string the dialog shows can be given in your language with `labels`. See [Labels and languages](/docs/ask-dialog#labels-and-languages).

## How is it different from Kapa, Inkeep or Algolia Ask AI?

Those are hosted services: your docs are ingested into their platform, and answers come from their infrastructure under their pricing. ondocs is a library. The index is a file in your build, the endpoint is a function on your host, and the model is one you choose under your own key. You give up their dashboards and analytics: you get `ondocs eval`, readers' ratings and a log of unanswered questions to wire as you like instead, and no account, no vendor, and nothing to keep in sync.

## How is it different from Pagefind?

Pagefind is static search: it builds an index at build time and returns matching pages, with no server at all. ondocs builds a similar static index, then adds an endpoint that answers in sentences with citations. It needs one function and a model key that Pagefind doesn't. They can run side by side: Pagefind on ⌘K, ondocs on ⌘I.

## Can I host the endpoint somewhere other than my site?

Yes. `npx ondocs init --host github-pages` writes a Cloudflare Worker that reads the index from the live site and answers it across origins with Workers AI, with no API key and CORS for the site's origin only; point the dialog's `endpoint`, or the script tag's `data-endpoint`, at it. See [Deploying](/docs/deployment#github-pages-and-other-static-hosts). An endpoint on Vercel or Netlify works the same way: set `access-control-allow-origin` for your site's origin in the handler's `headers`.

## Does it work with versioned docs and several languages?

Yes. Docusaurus, Starlight and VitePress sites get one index per locale, and the dialog on a locale's pages is answered from it. Versioned Docusaurus docs index every version; leave old ones out with `exclude: ['/docs/1.0']`. See [Docusaurus](/docs/docusaurus#locales-and-versions).

## How is the ondocs website built?

The website is a Next.js app that uses ondocs on these docs. `ondocs index` builds the index from the Markdown pages before every build, `createAskHandler` serves `/api/ask`, and `<AskDialog />` is the dialog. In production it answers with OpenAI; its preview deployments, and the example run locally without a key, use mock mode, where answers are quotes picked from the pages rather than written by a model. The repository's Docusaurus, Starlight and VitePress examples build the same pages with their plugins.

## Was ondocs called ask-my-site?

Yes. It was published as `ask-my-site` until 0.6.0, and 0.7.0 is its first release as `ondocs`. The options, the endpoints and the index file are the same; the package, the command and the import paths are renamed. [Migrating from ask-my-site](/docs/migrating) lists every rename and the commands to move a site over.
