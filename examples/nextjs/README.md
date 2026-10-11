# The ondocs site

The site at [ondocs.vercel.app](https://ondocs.vercel.app): a landing page and the docs, which index their own pages at build time and answer questions about them with ⌘K. The docs are about ondocs itself, so you can ask it how it works.

## Run it

From the repository root:

```sh
pnpm install
pnpm example:dev
```

Open http://localhost:3000 and press ⌘K (Ctrl+K on Windows and Linux).

With no API key the app runs in **mock mode**: a deterministic hashing embedder for retrieval and a scripted model that answers by quoting the most relevant sentences, with citations. Retrieval, the relevance gate, streaming and the UI are the real code paths.

To use OpenAI, add a key and restart. `pnpm dev` rebuilds the index with the matching embedding model first:

```sh
echo "OPENAI_API_KEY=sk-..." > examples/nextjs/.env.local
# optional, defaults to gpt-5.4-mini
echo "OPENAI_CHAT_MODEL=gpt-5.4-mini" >> examples/nextjs/.env.local
```

## Where things are

| File                   | What it does                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `content/docs/*.md`    | The pages, with `title`, `description`, `section` and `order` frontmatter.                        |
| `ondocs.config.mjs`    | The embedding model, shared by the CLI and the route so the index and queries always agree.       |
| `lib/ask-handler.ts`   | `createAskHandler` with an in-memory rate limit, mounted as `POST /api/ask` in `app/api/ask`.     |
| `components/ask.tsx`   | `<AskDialog />` with suggestions, opened by ⌘K or any `AskButton`, routing citations client-side. |
| `components/landing/*` | The home page's live demo (`useAsk` and `AskAnswer`), setup tabs and diagram.                     |
| `lib/docs.ts`          | Renders pages with ondocs's own slugger, so every citation anchor matches a real heading id.      |
| `lib/highlight.ts`     | Highlights code with Shiki at build time; pages ship plain HTML.                                  |

`pnpm index` writes `ask-index.json` (git-ignored here) and runs before `dev` and `build`. In a real project, commit the index and run `pnpm index:check` in CI instead.
