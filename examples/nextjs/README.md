# The ondocs site

The site at [ondocs.vercel.app](https://ondocs.vercel.app): a landing page and the docs, which index their own pages at build time and answer questions about them with ⌘K. The docs are about ondocs itself, so you can ask it how it works.

This is the project's website, not a starter: it depends on ondocs as `workspace:*`, this repository's own build, and on the repository's lint config, so it runs only inside the repository. To add ondocs to your own app, follow [the Next.js guide](https://ondocs.vercel.app/docs/nextjs), or [Fumadocs](https://ondocs.vercel.app/docs/fumadocs) and [Nextra](https://ondocs.vercel.app/docs/nextra) for those.

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

| File                   | What it does                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `content/docs/*.md`    | The pages, with `title`, `description`, `section` and `order` frontmatter (`group` and `label` are this site's).        |
| `ondocs.config.mjs`    | The embedding model, shared by the CLI and the route so the index and queries always agree.                             |
| `lib/ask-handler.ts`   | `createAskHandler` with an in-memory rate limit, mounted as `POST /api/ask` in `app/api/ask`.                           |
| `components/ask.tsx`   | `<AskDialog />` with suggestions, opened by ⌘K or any `AskButton`, routing citations client-side.                       |
| `components/landing/*` | The home page's live demo (`useAsk` and `AskAnswer`), setup tabs and diagram.                                           |
| `lib/docs.ts`          | Reads the pages and groups them for the sidebar.                                                                        |
| `lib/markdown.ts`      | Renders pages with ondocs's slugger, so citation anchors match heading ids; adds callouts, steps, tabs and code titles. |
| `lib/highlight.ts`     | Highlights code with Shiki at build time, in light and dark colors; pages ship plain HTML.                              |
| `lib/theme.ts`         | The theme script that runs before paint; `components/theme-switch.tsx` is System, Light, Dark.                          |

`pnpm index` writes `ask-index.json` (git-ignored here) and runs before `dev` and `build`. In a real project, commit the index and run `pnpm index:check` in CI instead.
