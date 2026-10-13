---
# Generated from examples/nextjs/content/docs/api.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Package API'
description: "The package's imports, the core functions for building and searching an index, and what each entry point exports."
sidebar:
  order: 29
---

The package has one CLI and these imports. Each is tree-shakeable, and only `ondocs/node`, `ondocs/integration`, the framework plugins and the CLI touch Node.js built-ins, so the rest runs on edge runtimes, in workers and in browsers.

| Import                          | For                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ondocs`                        | Loaders, chunking, `buildIndex`, `checkIndex`, `loadIndex`, `retrieve`, `buildLlmsFiles`, `mcpInstallLinks`     |
| `ondocs/node`                   | `loadDirectory`, `readIndexFile`, `writeIndexFile`, and the config module's types                               |
| `ondocs/integration`            | The build helpers the plugins are made of, for [writing an integration](/integrations/writing-an-integration/)  |
| `ondocs/server`                 | `createAskHandler`, `createMcpHandler`, `remoteIndex`, the rate limiters, the budget and answer cache stores    |
| `ondocs/react`                  | `AskDialog`, `useAsk`, `AskAnswer`, `McpInstall` and `loadAskDialog`; needs `@radix-ui/react-dialog` and `cmdk` |
| `ondocs/embed`                  | `mountAskDialog`: the dialog and its button without writing React; `openAskDialog`, to open any page's dialog   |
| `ondocs/docusaurus`             | The [Docusaurus plugin](/integrations/docusaurus/)                                                              |
| `ondocs/astro`                  | The [Astro integration](/integrations/astro/)                                                                   |
| `ondocs/starlight`              | The [Starlight plugin](/integrations/astro/)                                                                    |
| `ondocs/vitepress`              | The [VitePress plugin](/integrations/vitepress/): `withOndocs`                                                  |
| `ondocs/astro/McpInstall.astro` | The "Add to Cursor / VS Code / Claude" block for an Astro or Starlight page                                     |
| `ondocs/mock`                   | `mockEmbeddingModel` and `mockLanguageModel`, for tests and offline demos                                       |
| `ondocs` (bin)                  | [`ondocs index`, `init`, `dev` and `eval`](/reference/cli/)                                                     |

The handlers are documented in [The ask endpoint](/reference/ask-endpoint/) and [MCP server](/integrations/mcp/), and the React components in [The ask dialog](/reference/ask-dialog/).

## Build and search an index yourself

The plugins and the CLI are built on these functions, which work on content from anywhere:

```ts
import { buildIndex, fromMarkdown, loadIndex, retrieve, serializeIndexFile } from 'ondocs';

const doc = fromMarkdown(source, { id: 'guide.md', url: '/guide' });
const { index, stats } = await buildIndex({ documents: [doc], embeddingModel, previous });
const loaded = loadIndex(serializeIndexFile(index));
const { hits, answerable, best } = retrieve(loaded, { text: question, vector });
```

`buildIndex` takes the previous index as `previous`, to reuse the vectors of chunks whose text is unchanged. `retrieve` returns the hits that passed the [relevance gate](/guides/retrieval/), whether any did, and the best raw signals, for tuning the gate's thresholds.

## Also exported

- **Loaders:** `fromHtml` (`root` picks the part of a page to read, as a selector such as `[data-pagefind-body]`, `ignore` what to leave out, and `markdown` keeps links and tables for a Markdown copy), `fromMarkdown` (`mdx`, `markdown`) and `fromDocuments`.
- **The index file:** `chunkDocument`, `checkIndex`, `parseIndexFile`, `validateIndexFile` and `serializeIndexFile`.
- **The relevance gate:** `gateHits`, which checks hits from anywhere (a reranker, a retriever of your own) against the index, as `createAskHandler` does after its [retrieval hooks](/guides/retrieval/#rerank-or-retrieve-your-own-way).
- **Text:** `tokenize`, and `createSlugger`, to use in your renderer so citations' anchors always match your headings.
- **Search's building blocks:** `Bm25Index`, `VectorIndex`, `reciprocalRankFusion`, `quantizeInt8`, `encodeVector` and `decodeVector`.
- **Bot check:** `turnstile` from `ondocs/server`, for the ask endpoint's `challenge`: see [Bot check with Turnstile](/guides/bot-challenge/).
- **For agents:** `buildLlmsFiles` and `markdownPath`, which build `llms.txt`, `llms-full.txt` and the pages' `.md` copies from any list of pages, and `mcpInstallLinks`, the install links and commands for an MCP server's URL.
