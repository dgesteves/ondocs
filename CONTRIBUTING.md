# Contributing

Issues and pull requests are welcome. For a larger change, open an issue first so we can agree on the shape before you write it.

## Setup

Node 22.12 or later (CI uses 24) and pnpm (the version in `package.json`'s `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm example:dev   # builds the package and runs the Next.js example on http://localhost:3000
```

The examples run in mock mode, so they need no key: deterministic embeddings and scripted extractive answers.

```
src/                  the package: build and search (root), cli/, node/, server/, react/, embed/,
                      integration/, docusaurus/, astro/, starlight/, vitepress/, loaders/, mock/
test/                 Vitest: unit, robustness (linear-time parsing), plugins, dialog with axe
examples/             nextjs (the live demo), docusaurus, starlight and vitepress, built in CI
scripts/              consumer-site.mjs (fresh sites from the packed package), deploy-recipes.mjs, openai-stub.mjs, assets
bench/                retrieval and load benchmarks
packages/             docusaurus-plugin-ondocs and starlight-ondocs, which re-export
                      ondocs/docusaurus and ondocs/starlight under the names people search for
```

## Checks

`pnpm validate` runs what CI runs, except the fresh-site job:

```bash
pnpm validate   # lint, format, typecheck, test, build, publint and attw, and the four example builds
```

The `consumers` CI job packs the package, scaffolds fresh Next.js, Docusaurus, Starlight and VitePress sites, installs the tarball and builds each against a local OpenAI stub. Two more sites install the plugin through `packages/`, packed alongside it. To run one locally:

```bash
pnpm build && npm pack --pack-destination /tmp
node scripts/consumer-site.mjs docusaurus /tmp/ondocs-*.tgz /tmp/site
```

The `recipes` CI job builds what `ondocs init` writes for each host with that host's own tooling (`vercel build`, `netlify build --offline`, Wrangler's `--dry-run` and local `dev`), signed in to nothing, and asks it questions against the stub; the `astro-*` recipes build an Astro site with an SSR adapter and no route file. The host CLIs run with a HOME of their own, so they see no credentials. To run one locally:

```bash
pnpm build && npm pack --pack-destination /tmp
node scripts/deploy-recipes.mjs github-pages /tmp/ondocs-*.tgz /tmp/recipe
```

The docs live in `examples/nextjs/content/docs`, and the Docusaurus, Starlight and VitePress examples' pages are generated from them: after editing a page, run `pnpm build && pnpm examples:sync` and commit the result. CI fails when they drift.

`test/corpus.test.ts` checks search on real docs: docusaurus.io's, at a pinned commit. Fetch them once with `node scripts/corpus.mjs` (a few MB, into the git-ignored `.corpus/`); without them the file is skipped locally, and CI always fetches them. A change that moves its counts has to say why.

`.github/workflows/retrieval-eval.yml` measures the same docs with OpenAI's embeddings. It runs by hand only, with the `OPENAI_API_KEY` repository secret: `scripts/retrieval-eval.mjs` indexes them with `text-embedding-3-small` at 512 dimensions, stops first if they are more chunks than its cap, and runs `ondocs eval` at a sweep of the similarity gate. `node scripts/retrieval-eval.mjs --stub` runs the same steps against the local OpenAI stub, with no key; CI does that on every pull request.

`node scripts/js-weight.mjs --check` loads a docs page of each example in headless Chrome (build them first) and checks the JavaScript it carries before any interaction against each site's budget, and that the dialog opens from a shortcut pressed while its code loads and gives focus back when it closes. CI runs it.

Parsers must stay linear on hostile input: if you touch `src/loaders` or `src/chunk.ts`, add a case to `test/robustness.test.ts`.

## Changesets

A change to the published package needs a changeset: run `pnpm changeset`, choose patch for a fix or minor for a feature, and write a line or two for the changelog from a user's point of view. Docs, the examples and CI need none. Merging to `main` opens a release pull request, and merging that publishes to npm.

The packages in `packages/` are in a fixed group with `ondocs`, so each release gives all three the same version, and a changeset for `ondocs` is enough. Each re-exports one entry, so a change to it needs nothing there unless the entry needs a new peer dependency; `test/plugin-packages.test.ts` keeps their ranges equal to those of `ondocs`.

By contributing, you agree that your work is released under the [MIT license](./LICENSE) and that you follow the [code of conduct](./CODE_OF_CONDUCT.md).

## Retiring the old name (one-off, after ondocs 0.7.0 is on npm)

The package was `ask-my-site` until 0.6.0. Once `ondocs@0.7.0` is published, the maintainer points the old package at the new one, from a machine logged in to npm:

```sh
npm deprecate ask-my-site "Renamed to ondocs: npm install ondocs. See https://ask-my-site-demo.vercel.app/docs/migrating"
```

It is not in a workflow: it runs once. A version installed before keeps working; npm prints the message on each install.
