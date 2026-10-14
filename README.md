# ondocs

**Make your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor. Agent traffic costs you no model tokens.**

[![CI](https://img.shields.io/github/actions/workflow/status/dgesteves/ondocs/ci.yml?branch=main&label=CI&style=flat-square&labelColor=181c22)](https://github.com/dgesteves/ondocs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ondocs?style=flat-square&labelColor=181c22&color=0e7490)](https://www.npmjs.com/package/ondocs)
[![Downloads](https://img.shields.io/npm/dw/ondocs?style=flat-square&labelColor=181c22&color=0e7490)](https://www.npmjs.com/package/ondocs)
[![Script tag: 3.2 KB gzipped](https://img.shields.io/badge/script_tag-3.2_KB_gzipped-0e7490?style=flat-square&labelColor=181c22)](https://ondocs.vercel.app/docs/script-tag)
[![License: MIT](https://img.shields.io/badge/license-MIT-0e7490?style=flat-square&labelColor=181c22)](./LICENSE)
[![Types](https://img.shields.io/badge/types-included-0e7490?style=flat-square&labelColor=181c22)](https://ondocs.vercel.app/docs/api)

**Answers with**
[![OpenAI](https://img.shields.io/badge/OpenAI-181c22?style=flat-square)](https://ondocs.vercel.app/docs/model-providers#openai)
[![Anthropic](https://img.shields.io/badge/Anthropic-181c22?style=flat-square&logo=anthropic&logoColor=white)](https://ondocs.vercel.app/docs/model-providers#anthropic-and-claude)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-181c22?style=flat-square&logo=googlegemini&logoColor=white)](https://ondocs.vercel.app/docs/model-providers#google-gemini)
[![xAI Grok](https://img.shields.io/badge/xAI_Grok-181c22?style=flat-square)](https://ondocs.vercel.app/docs/model-providers#xai-and-grok)
[![Workers AI](https://img.shields.io/badge/Workers_AI-181c22?style=flat-square&logo=cloudflare&logoColor=white)](https://ondocs.vercel.app/docs/model-providers#workers-ai)
[![any AI SDK provider](https://img.shields.io/badge/any_AI_SDK_provider-181c22?style=flat-square)](https://ondocs.vercel.app/docs/model-providers#any-other-ai-sdk-provider)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dgesteves/ondocs/tree/main/templates/cloudflare-worker)

**Ask these docs from your editor**, through the MCP server this site runs on ondocs:
[![Cursor](https://img.shields.io/badge/Cursor-Add_server-181c22?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=ondocs&config=eyJ1cmwiOiJodHRwczovL29uZG9jcy52ZXJjZWwuYXBwL2FwaS9tY3AifQ%3D%3D)
[![VS Code](https://img.shields.io/badge/VS_Code-Add_server-007ACC?style=flat-square)](https://insiders.vscode.dev/redirect/mcp/install?name=ondocs&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fondocs.vercel.app%2Fapi%2Fmcp%22%7D)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Add_server-b4532a?style=flat-square&logo=claude&logoColor=white)](https://ondocs.vercel.app/docs/mcp)
[![Claude](https://img.shields.io/badge/Claude-Add_connector-b4532a?style=flat-square&logo=claude&logoColor=white)](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=ondocs&connectorUrl=https%3A%2F%2Fondocs.vercel.app%2Fapi%2Fmcp)

**Website: [ondocs.vercel.app](https://ondocs.vercel.app)**, whose [docs](https://ondocs.vercel.app/docs) answer questions about this library with OpenAI, under a rate limit and a daily budget, and serve agents at `/api/mcp`. Formerly `ask-my-site` ([what changed](https://ondocs.vercel.app/docs/migrating)).

<!-- npm-readme:video -->

https://github.com/user-attachments/assets/2491c5ea-de70-471c-b11e-30591c074e6f

<sub>The <a href="https://ondocs.vercel.app">live demo</a>: a question, a streamed answer with citations, and a citation opening the section it came from. On that docs page, the Ask button answers a setup question with the exact config. Then the one-line setup for Docusaurus, Starlight and any other site.</sub>

<!-- npm-readme:image
<p align="center">
  <a href="https://ondocs.vercel.app"><img src=".github/assets/demo.webp" width="100%" alt="The live demo: a question about the docs, a streamed answer with numbered citations, a citation opening the exact section of the FAQ page, then the Ask button on that page answering how to add it to Starlight with the exact config. Last, the one-line setup for Docusaurus, Starlight and any other site."></a>
</p>

<sub>The <a href="https://ondocs.vercel.app">live demo</a>: a question, a streamed answer with citations, and a citation opening the section it came from. On that docs page, the Ask button answers a setup question with the exact config. Then the one-line setup for Docusaurus, Starlight and any other site.</sub>
-->

## What you get

One index, `ask-index.json`, built with your site from the pages it serves, feeds three things:

- **An Ask box for people.** A ⌘I dialog that streams a short answer from your model, with numbered citations to the exact section. When nothing relevant is found, it says "I don't know" without calling the model. A page carries only its button, a few KB of JavaScript; the dialog loads the first time it is wanted.
- **An MCP server for agents.** `search`, `fetch` and `list_pages` over the same index, for Claude Code, Cursor, VS Code, ChatGPT and Claude. The agent brings its own model, and search is keyword-only by default, so it calls no model at all.
- **`llms.txt`, `llms-full.txt` and a `.md` copy of every page**, written with the build.

Search runs in memory inside one function you deploy: BM25 and vectors, merged with reciprocal rank fusion. There is no vector database, no hosted service and no account. MIT licensed.

## Pick your setup

| Your site                          | What you add                                       | Guide                                                       |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Docusaurus 3                       | A plugin                                           | [Docusaurus](https://ondocs.vercel.app/docs/docusaurus)     |
| Starlight, or any Astro site       | A plugin, or an integration                        | [Astro and Starlight](https://ondocs.vercel.app/docs/astro) |
| VitePress                          | One wrapper in its config                          | [VitePress](https://ondocs.vercel.app/docs/vitepress)       |
| Next.js or another React app       | A route and a component                            | [Next.js and React](https://ondocs.vercel.app/docs/nextjs)  |
| Fumadocs                           | A route and a component                            | [Fumadocs](https://ondocs.vercel.app/docs/fumadocs)         |
| Nextra                             | A route and a component                            | [Nextra](https://ondocs.vercel.app/docs/nextra)             |
| Hugo, Jekyll, MkDocs or plain HTML | One script tag; for plain HTML, `init --out <dir>` | [Script tag](https://ondocs.vercel.app/docs/script-tag)     |

Each answers from an endpoint you deploy as one function next to the site, rate-limited by default. `npx ondocs init` writes it for Vercel, Netlify, Cloudflare or GitHub Pages (as a Cloudflare Worker of its own, answering with Workers AI and no API key), and an Astro site with an SSR adapter needs none: see [Deploying](https://ondocs.vercel.app/docs/deployment).

**Live demos:** [Docusaurus](https://ondocs-docusaurus.vercel.app), [Starlight](https://ondocs-starlight.vercel.app), [VitePress](https://ondocs-vitepress.vercel.app).

**Docusaurus.** `npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk`, then:

```ts
// docusaurus.config.ts
export default { plugins: ['ondocs/docusaurus'] };
```

After `docusaurus build`, it indexes the pages into `build/ask-index.json`, writes `llms.txt` and the `.md` pages, and adds an "Ask AI" button with ⌘I.

**Starlight.** `npm i ondocs ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk`, then:

```js
// astro.config.mjs
integrations: [starlight({ title: 'Acme Docs', plugins: [ondocs()] })],
```

**Next.js.** With `OPENAI_API_KEY` set, index your content with `npx ondocs index ./content --base-url /docs --llms-txt public`, then:

```ts
// app/api/ask/route.ts
export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
});
```

and render the dialog in your layout, with its two stylesheets:

```tsx
// app/layout.tsx
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';
// …then <AskDialog launcher /> in the body
```

**Any other site.** Index the HTML it builds, write the endpoint with `npx ondocs init`, and add the script tag. For a site built into `public`:

```sh
npx ondocs index public -o public/ask-index.json -e none   # keyword-only; leave out -e none to embed with OPENAI_API_KEY
npx ondocs init --out public                               # plain HTML needs --out; Hugo, Jekyll, MkDocs and Eleventy are detected
```

```html
<script src="https://cdn.jsdelivr.net/npm/ondocs@0.10/dist/embed.global.js" defer></script>
```

**Try it without a key.** `npx ondocs index ./docs -e mock`, then `npx ondocs dev`, serves the ask endpoint and MCP server on localhost, with offline embeddings and a mock model that quotes your docs. See [Try it locally](https://ondocs.vercel.app/docs/local-development).

## For agents

The same index, served to agents with `createMcpHandler`:

```ts
// app/api/mcp/route.ts
const handler = createMcpHandler({ index, siteName: 'the Acme docs' });
export { handler as POST, handler as GET, handler as DELETE, handler as OPTIONS };
```

```sh
claude mcp add --transport http acme-docs https://docs.acme.dev/api/mcp
```

- **Protocol.** MCP 2026-07-28 (stateless, `server/discover`), and for clients that start with `initialize`, 2025-11-25 back to 2024-11-05. Both are tested with the official TypeScript client.
- **Tools.** `search` returns ranked sections with a snippet and a URL to the anchor, and `fetch` the page or section as Markdown: the shape ChatGPT's connectors expect.
- **Quality.** On docusaurus.io's own docs, keyword search puts the right page in the top three for 22 of 22 agent-style queries, checked in CI. An `embeddingModel` adds one embedding call per search.
- **On your docs.** With the plugins' `mcp` option, a page can show an "Add to Cursor / VS Code / Claude" block.
- **llms.txt.** The plugins write it by default, the CLI with `--llms-txt <dir>`, and they leave alone what another llms plugin already writes.

See [MCP server](https://ondocs.vercel.app/docs/mcp) and [llms.txt and Markdown pages](https://ondocs.vercel.app/docs/llms-txt).

## Cost and safety defaults

- **A question costs** one embedding call and one model call, with at most 8,000 characters of sources in and 800 tokens out, and a follow-up that leans on the conversation one more short call to rewrite it. A question your docs don't cover stops before the model.
- **An agent's search costs** no model call, or one embedding call with an `embeddingModel`.
- **Rate limits are on by default**: 10 questions and 60 tool calls a minute per client IP, per server instance. Name your platform's client IP header outside Vercel.
- **`budget`** caps questions and model tokens per UTC day for the whole endpoint, **`answerCache`** answers repeated questions without a model call, and **`challenge`** adds an optional Turnstile bot check.
- **Requests** must be JSON, which forces a CORS preflight, and bodies are capped. Model errors are masked.
- **Answers render as text,** never HTML, with links allow-listed. `links: 'sources'` keeps only links to the pages cited.
- **Set a spend limit with your model provider.** It is the only hard cap. See [Rate limits and security](https://ondocs.vercel.app/docs/security).

## How it compares

- **Algolia DocSearch Ask AI** adds answers to DocSearch's search box. Choose it if you already use DocSearch and are fine with an Algolia account and its crawler.
- **Kapa.ai and Inkeep** are hosted. They take more sources than your docs (forums, issues, chat) and come with analytics dashboards and support tooling. ondocs gives you `ondocs eval` for CI, readers' ratings and a log of unanswered questions you wire yourself, not a dashboard.
- **Fumadocs** has first-party AI chat and an MCP route. On a Fumadocs site, they fit its framework natively.
- **docusaurus-plugin-mcp-server** builds the same kind of index for an MCP endpoint, more widely used today, with no Ask box for people.
- **The llms.txt plugins** (docusaurus-plugin-llms, @signalwire/docusaurus-plugin-llms-txt, starlight-llms-txt, vitepress-plugin-llms) have more output options, such as custom sets and versions. ondocs writes the basics, and steps aside when one of them is installed.

What ondocs adds is one index you host serving both people and agents, on Docusaurus, Starlight, VitePress, Next.js or any static site, with no vendor account. See [Limits and trade-offs](https://ondocs.vercel.app/docs/limits) for where it is the wrong tool.

## Links

- [Getting started](https://ondocs.vercel.app/docs/getting-started), [Deploying](https://ondocs.vercel.app/docs/deployment), [API](https://ondocs.vercel.app/docs/api), [CLI](https://ondocs.vercel.app/docs/cli), [Benchmarks](https://ondocs.vercel.app/docs/benchmarks) and [FAQ](https://ondocs.vercel.app/docs/faq)
- [Changelog](./CHANGELOG.md), [Contributing](./CONTRIBUTING.md), [Security](./SECURITY.md)

Requires Node.js 22.12 or later, and any AI SDK provider. [MIT](./LICENSE) © Diogo Esteves
