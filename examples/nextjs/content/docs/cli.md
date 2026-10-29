---
title: CLI and config file
description: "Every flag of ondocs index, init, dev and eval, and the config module for an embedding model the flags don't cover or content that isn't on disk."
section: Reference
label: CLI
order: 30
---

The `ondocs` command has four subcommands: `index` builds or checks the index, `init` writes the endpoint for your host, `dev` serves the endpoint on your machine, and `eval` scores retrieval against questions whose answers you know. Run them with `npx ondocs`, or from a `package.json` script.

## ondocs index

`ondocs index [dir] [options]` builds `ask-index.json` from the Markdown, MDX and HTML files in `dir`.

| Flag                                                      | Default                  | What it does                                                                                 |
| --------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `-o, --out <file>`                                        | `ask-index.json`         | Where to write the index.                                                                    |
| `--check`                                                 | off                      | Exit 1 if the index is stale. Never calls a model.                                           |
| `--base-url <url>`                                        | `/`                      | URL prefix for pages, such as `/docs` or a full origin.                                      |
| `-e, --embedding <spec>`                                  | OpenAI when a key is set | `openai:<model>`, `workers-ai:@cf/<model>`, `<provider>/<model>`, `mock[:<dims>]` or `none`. |
| `--dimensions <n>`                                        | 512 for the default      | Vector size, for models that support it. With `--check`, the size the index must have.       |
| `--chunk-size <chars>`                                    | `1200`                   | Maximum characters per chunk.                                                                |
| `--chunk-overlap <chars>`                                 | `150`                    | Characters shared by consecutive chunks of a section.                                        |
| `--ignore <glob>`                                         | none                     | Skip matching files. Repeatable.                                                             |
| `--framework <name>`                                      | detected                 | `docusaurus`, `starlight`, `next` or `none`: how file paths become URLs.                     |
| `--clean-urls`                                            | off                      | Drop `.html` from HTML files' URLs.                                                          |
| `--llms-txt <dir>`                                        | off                      | Also write [llms.txt, llms-full.txt and a .md per page](/docs/llms-txt) into `dir`.          |
| `--no-llms-index`, `--no-llms-full`, `--no-llms-markdown` |                          | Leave out one of those.                                                                      |
| `--llms-title`, `--llms-description`                      | `package.json` name      | The site's name and summary, at the top of `llms.txt`.                                       |
| `--site-url`, `--mcp-url`                                 | none                     | The site's origin, for absolute links, and its MCP endpoint, for `llms.txt`.                 |
| `-c, --config <file>`                                     | none                     | A module whose default export is an `AskConfig`.                                             |
| `-q, --quiet`                                             | off                      | Only print errors.                                                                           |
| `-h, --help`, `-v, --version`                             |                          | Print the help, or the version.                                                              |

## Choosing the embedding model

Without `--embedding`, the CLI uses `openai:text-embedding-3-small` when `OPENAI_API_KEY` is set, or `openai/text-embedding-3-small` through AI Gateway when only `AI_GATEWAY_API_KEY` is, at 512 dimensions, as the plugins do. That is a third of the model's 1,536, and makes the index about half the size: 1.54 MB against 2.93 MB for docusaurus.io's 1,070 chunks. `--dimensions` sets another size. A model you name with `--embedding` is built at its own size unless `--dimensions` gives one. The endpoint reads the size from the index, so an index built at 1,536 dimensions keeps working; the next build embeds every chunk again, once, at the new size. With neither key, the CLI fails rather than quietly building a keyword-only index, and suggests `-e mock` to try it without a key. `-e none` builds a keyword-only index on purpose. It suits agents' MCP search, which `init` writes keyword-only, but the Ask box then answers only questions that use enough of the docs' own words: embed the index for it ([How retrieval works](/docs/retrieval#tuning)). `-e workers-ai:@cf/baai/bge-small-en-v1.5` embeds with Workers AI over Cloudflare's REST API, with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, for the [Workers AI Worker](/docs/workers-ai); its vector size is fixed, so `--dimensions` does not apply.

## Environment and exit codes

The CLI reads `.env` and `.env.local` from the working directory, without overriding variables that are already set. It exits with 0 on success, 1 when the build fails or `--check` finds the index stale, and 2 on a usage error.

## ondocs init

`ondocs init [options]` writes the ask endpoint and the MCP endpoint for the site in the working directory and the host it deploys to: Vercel, Netlify, Cloudflare (Pages, or a Worker with static assets) or GitHub Pages, whose endpoint is a Cloudflare Worker of its own. It detects the site from its config (Docusaurus, Starlight, Astro, Next.js, VitePress, Hugo, MkDocs, Jekyll or Eleventy) and the host from `vercel.json`, `netlify.toml`, a wrangler config or a GitHub Pages workflow, and asks for the host when it cannot tell. A plain HTML site has no config to detect: name its folder with `--out`. [Deploying](/docs/deployment#write-the-endpoint-with-init) shows what it writes for each.

| Flag                 | Default                | What it does                                                                            |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `--host <name>`      | detected, else asked   | `vercel`, `netlify`, `cloudflare` or `github-pages`.                                    |
| `--provider <name>`  | `workers-ai`           | For `github-pages`: `workers-ai`, with no API key, or `openai`.                         |
| `--site-url <url>`   | from the site's config | The site's public URL with its base path, which the GitHub Pages Worker reads.          |
| `--site-name <text>` | the site's title       | The site's name, in the model's instructions.                                           |
| `--out <dir>`        | detected               | A static site's build folder, where the index goes.                                     |
| `--no-mcp`           | the MCP endpoint is on | Write the ask endpoint only.                                                            |
| `--dry-run`          | off                    | Print every file it would write, and write nothing.                                     |
| `-y, --yes`          | asks                   | Overwrite files that differ, and use the host's config without asking: the nearest one. |
| `-h, --help`         |                        | Print the help.                                                                         |

It prints each file it created, updated or left unchanged, the environment variables to set and where, and the steps left: the packages to install, the dialog to add (or the options to give a plugin the site's config already adds) and the deploy. It exits with 0 when everything is written, 1 when it left a file as it was or an edit for you to make by hand, and 2 on a usage error. It reads no `.env` file and no credential, and it deploys nothing. An Astro site with an SSR adapter gets no file: its integration serves the endpoints.

## ondocs dev

`ondocs dev [options]` serves `POST /api/ask` on 127.0.0.1, answering from a built index, for the dialog on your site's dev server. It serves the same index as an [MCP server](/docs/mcp) at `/api/mcp`, keyword-only, for your editor's agent.

| Flag                      | Default                                                                                                        | What it does                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `--index <file>`          | `ask-index.json`, then the build output of Docusaurus, Astro or VitePress, then `public/`, `site/` or `_site/` | The index to serve.                                     |
| `--port <n>`              | `8787`                                                                                                         | Port to listen on.                                      |
| `--allow-origin <origin>` | localhost                                                                                                      | Another origin allowed to call it, or `*`. Repeatable.  |
| `--model <id>`            | `gpt-5.4-mini`                                                                                                 | OpenAI model for answers, when `OPENAI_API_KEY` is set. |
| `-h, --help`              |                                                                                                                | Print the help.                                         |

It embeds questions with the model the index records, answers with OpenAI when `OPENAI_API_KEY` is set and with the mock model otherwise, and reloads the index when the file changes. It only answers pages on this machine (localhost, 127.0.0.1 and [::1] origins, on any port) and requests addressed to localhost, so a site you visit cannot spend your key through it, and it caps request bodies at 64 KiB. [Try it locally](/docs/local-development) shows it with each integration.

## ondocs eval

`ondocs eval <questions.yaml> [options]` scores retrieval against a file of questions with the pages that answer them, and questions marked `unanswerable`: hit@1, hit@3, hit@5, MRR (mean reciprocal rank), refusal precision and refusal recall, question by question. It exits 1 when a score is under its threshold. [Measure and improve answers](/docs/quality#score-retrieval-with-eval) has the file's format.

| Flag                                                                                                                 | Default                                                                                                                        | What it does                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--index <file>`                                                                                                     | the file's `index`, then `ask-index.json`, `build/`, `dist/`, `dist/client/`, `.vitepress/dist/`, `public/`, `site/`, `_site/` | The index to score.                                                                                                                                    |
| `--min-hit-at-1`, `--min-hit-at-3`, `--min-hit-at-5`, `--min-mrr`, `--min-refusal-precision`, `--min-refusal-recall` | the file's `thresholds`                                                                                                        | Thresholds from 0 to 1.                                                                                                                                |
| `-c, --config <file>`                                                                                                | none                                                                                                                           | The config module the index was built with (`ondocs index -c`): questions are embedded with its `embedding` (at its `dimensions`) or `embeddingModel`. |
| `--keyword-only`                                                                                                     | off                                                                                                                            | Search by keywords only, embedding nothing.                                                                                                            |
| `--json`                                                                                                             | off                                                                                                                            | Print the report as JSON.                                                                                                                              |
| `-h, --help`                                                                                                         |                                                                                                                                | Print the help.                                                                                                                                        |

It embeds each question with the config's model, else with the model the index records, as `ondocs dev` does, and calls no language model. It loads `.env` and `.env.local` like `index`, and exits 2 on a usage error or a file it cannot read.

## The config file

For an embedding provider the specs don't cover, or content that is not on disk, pass a config module with `--config`. Every field is optional:

```js
// ondocs.config.mjs
import { cohere } from '@ai-sdk/cohere';
import { getPosts } from './lib/cms.mjs';

/** @type {import('ondocs/node').AskConfig} */
export default {
  embeddingModel: cohere.embedding('embed-multilingual-v3.0'),
  baseUrl: '/docs',
  documents: async () =>
    (await getPosts()).map((post) => ({
      id: post.slug,
      url: `/blog/${post.slug}`,
      title: post.title,
      content: post.markdown,
    })),
};
```

| Field                      | What it does                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `embeddingModel`           | An AI SDK embedding model, or `null` for keyword-only.                              |
| `embeddingProviderOptions` | Passed to the embedding model, such as `{ openai: { dimensions: 512 } }`.           |
| `chunking`                 | `{ maxChars, overlap }`.                                                            |
| `baseUrl`                  | URL prefix for pages loaded from the folder.                                        |
| `ignore`                   | Glob patterns of files to skip.                                                     |
| `framework`                | `'auto'` (the CLI's default), `'docusaurus'`, `'starlight'`, `'next'` or `'none'`.  |
| `cleanUrls`                | Drop `.html` from HTML files' URLs.                                                 |
| `documents`                | `{ id, url, title, content }` records from elsewhere, or a function returning them. |

`defineConfig` from `ondocs/node` types the object without a JSDoc comment. Share the config with your route handler, as the ondocs website does, so the index and the queries always use the same embedding model.
