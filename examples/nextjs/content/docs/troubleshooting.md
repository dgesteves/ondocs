---
title: Troubleshooting
description: The messages a new site shows most often, from the package manager, the build, the dialog and the endpoint, what causes each one and how to fix it.
section: Get started
order: 4
---

Each section is named after what you see: a line from your package manager or your build, or what the dialog says. Search this page for its words. They are in the order a new site meets them, from installing to the first questions.

When the dialog shows an error, the endpoint's log has the cause. `createAskHandler` passes every error it handles to `onError`, which logs it with `console.error` unless you give it a function of your own. The browser never gets the details.

## An older version installs, or none does

`pnpm add ondocs` writes a version older than the latest, with no warning, or asking for the latest fails:

```
[ERR_PNPM_NO_MATURE_MATCHING_VERSION] 1 version does not meet the minimumReleaseAge constraint
```

Yarn fails with `All versions satisfying "…" are quarantined`, or picks an older version without a word.

Your package manager has a release-age gate: it skips versions published less than a set time ago, and installs the newest one older than that. pnpm 11 and later, and recent Yarn 4 releases, hold back versions younger than a day by default (pnpm's `minimumReleaseAge`, Yarn's `npmMinimalAgeGate`), and some repositories set longer gates, such as 3 or 7 days.

Wait until the version is old enough, or exempt ondocs and its two plugin packages:

```yaml
# pnpm-workspace.yaml
minimumReleaseAgeExclude:
  - ondocs
  - docusaurus-plugin-ondocs
  - starlight-ondocs
```

```yaml
# .yarnrc.yml
npmPreapprovedPackages:
  - ondocs
  - docusaurus-plugin-ondocs
  - starlight-ondocs
```

Then compare what you have, from `npm ls ondocs`, `pnpm why ondocs` or `yarn why ondocs`, with the latest, from `npm view ondocs version`.

## An option from these docs does nothing

An option on these pages changes nothing, and the build prints no warning. Or an import from these pages fails, such as `import 'ondocs/embed/button.css'`, and each bundler says so in its own words:

- webpack, in Docusaurus: `"./embed/button.css" is not exported under the conditions`. An older webpack, such as the one `next build --webpack` uses, says `Package path ./embed/button.css is not exported from package`.
- Rspack, in Docusaurus with `future: { faster: true }`: `Package subpath './embed/button.css' is not defined by "exports"`, as Node says it.
- Vite 8, in Astro 7 and VitePress 2: `"./embed/button.css" is not exported under the conditions`.
- Vite 5 to 7, in VitePress 1 and Astro 5 and 6: `Missing "./embed/button.css" specifier in "ondocs" package`.
- Turbopack, in Next.js: `Module not found: Can't resolve 'ondocs/embed/button.css'`, as for a package that is not installed.

These docs describe the newest version, and your project has an older one. The plugins check their options for ones that conflict, but not for ones they don't know, so an option newer than your version is ignored. A module newer than your version is not in its package's `exports`, which is what most of these messages say. `dialog: { navbar: true }` and `ondocs/embed/button.css`, for example, are new in 0.11. Two things keep a project on an older version: a release-age gate (see above), and the caret range. Before 1.0, `^0.10.0` allows 0.10 releases only, so `npm update` never moves it to 0.11.

Check the version you have with `npm ls ondocs`, and install the latest with `npm i ondocs@latest`, with the plugin package at the same version if you use one. [Upgrading](/docs/upgrading) lists the options a minor version renames, and the [changelog](https://github.com/dgesteves/ondocs/blob/main/CHANGELOG.md) what each version adds.

## ondocs: command not found

With `docusaurus-plugin-ondocs` or `starlight-ondocs` installed by pnpm, `pnpm exec ondocs init` fails with `Command "ondocs" not found`, and `npx ondocs init` can print `sh: ondocs: command not found`. With `starlight-ondocs`, `astro build` can fail with `Rolldown failed to resolve import "ondocs/react/styles.css"`.

The two packages are the plugins under the names people search for, and they depend on `ondocs`. pnpm gives a project only its direct dependencies, so the `ondocs` command, and the `ondocs/...` modules the plugin adds to your site, are not found from it. npm installs dependencies of dependencies where your project finds them, so the same install works there.

Install `ondocs` itself. Use it in place of the plugin package, as these docs do (`'ondocs/docusaurus'` in `plugins`, `import ondocs from 'ondocs/starlight'`), or next to it at the same version: the three packages are released together. The functions `init` writes import `ondocs/server`, so they need it too.

```sh
pnpm add ondocs
```

## No embedding model: building a keyword-only index

The plugins print this as the site builds:

```
No embedding model: building a keyword-only index. Set OPENAI_API_KEY or AI_GATEWAY_API_KEY at build time, or pass `embedding`, for semantic search.
```

The build had no model key, so the index has no vectors and search matches words only. The site builds, and the MCP endpoint `init` writes searches by keywords anyway. The Ask box answers questions that use the docs' own words, but refuses more of the ones put in other words. It still needs a model key where the endpoint runs: see [Answers aren't set up on this site yet](#answers-arent-set-up-on-this-site-yet).

- To search by meaning too, set `OPENAI_API_KEY` where the site builds. The plugins then embed the pages with OpenAI's `text-embedding-3-small`, the model the endpoints `init` writes embed questions with. On Vercel and Netlify, one variable serves the build and the functions.
- With the [Workers AI Worker](/docs/workers-ai), pass `embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'` and set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` where the site builds.
- To build a keyword-only index on purpose, pass `embedding: 'none'`, which builds the same index without the warning.

`ondocs index` stops instead, with `No embedding model. Set OPENAI_API_KEY or pass --embedding <spec>.` Pass `-e none` for a keyword-only index, or `-e mock` to try it on your machine. A mock index is for local testing only: see [The ask endpoint is misconfigured](#the-ask-endpoint-is-misconfigured).

## Answers aren't available here right now

The dialog shows `Answers aren’t available here right now.` when it posts the question to its endpoint, `/api/ask` unless you set `endpoint`, and gets a 404: nothing answers there. On a page served from your machine, or in a development build, the browser console says so too:

```
[ondocs] POST http://localhost:3000/api/ask returned 404: no ask endpoint answers there.
```

The plugins and the script tag add the dialog, not the endpoint. The endpoint is a function you deploy, and a host or a preview that only serves files, such as GitHub Pages or `docusaurus serve`, has none.

- To deploy one, run `npx ondocs init`, which writes it for your host. See [Deploying](/docs/deployment). An Astro site with an SSR adapter serves it itself.
- On your machine, run `npx ondocs dev` and start the site with `ASK_ENDPOINT=http://localhost:8787/api/ask npm start`. Keep that address out of the `endpoint` option, or the site you deploy posts to it too. See [Try it locally](/docs/local-development#point-the-dialog-at-it).
- If the endpoint has another address, such as the Worker `init --host github-pages` writes, set the dialog's `endpoint`, or the script tag's `data-endpoint`, to it.

A host that turns the question away with another status, such as a 405, shows `Something went wrong (405). Please try again.` with that status instead. The cause and the fix are the same.

## Answers aren't set up on this site yet

The sources appear, then `Answers aren’t set up on this site yet.`, with no Retry button. The endpoint found the sources, and then it could not call the model that writes the answer, as it is set up: asking again cannot fix that. On a page served from your machine, or in a development build, the browser console points at the endpoint's log, which has the cause.

Most often, the endpoint has no key for the model, and the log has an `AI_LoadAPIKeyError`: `OpenAI API key is missing`. A key the provider rejects, with a 401 or a 403, or AI Gateway with no key or OIDC token, shows the same message.

- Set the key, such as `OPENAI_API_KEY`, where the endpoint runs: the project's environment variables on Vercel and Netlify, `npx wrangler pages secret put OPENAI_API_KEY` on Cloudflare Pages, or `npx wrangler secret put OPENAI_API_KEY` for a Worker. On Vercel and Netlify, deploy again: a new variable reaches only the deployments made after it. `init` prints where the key goes on your host.
- A keyword-only index does not make the key optional. Built without a key, the index is searched by keywords, which works, but a model still writes every answer. Without a key, only the MCP endpoint, whose search calls no model, and the questions the endpoint refuses before it would call one, work.
- To answer with no key at all, use Workers AI: `npx ondocs init --host github-pages` writes a Cloudflare Worker that answers for any static site with it. See [Workers AI](/docs/workers-ai).

The dialog shows the same message when the endpoint answers with a 500, but without the sources and with a Retry button: see [The ask endpoint is misconfigured](#the-ask-endpoint-is-misconfigured). Other clients, such as `useChat`, get `The ask endpoint is misconfigured.` instead: as the stream's error here, and as the 500's message there.

## The ask endpoint is misconfigured

The endpoint answers with a 500, code `internal_error`, and the message `The ask endpoint is misconfigured.`, and the dialog shows `Answers aren’t set up on this site yet.` with a Retry button. It could not load its index, or the index and the endpoint do not match. A mismatch fails every question until you fix it, but a load can fail for a moment, which is what Retry is for. The log says which:

| The log says                                                                                                                                                   | What to do                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The index was embedded with "mock-hash-512" but the handler embeds queries with "text-embedding-3-small". Rebuild the index or pass the same embeddingModel.` | The index was built with `embedding: 'mock'` or `-e mock`, which is for local testing. Remove it and build again: with `OPENAI_API_KEY` set the plugins embed with `text-embedding-3-small`, and without it they build a keyword-only index. If the log names two other models, build the index with the endpoint's `embeddingModel`, or set `embeddingModel` to the index's. |
| `ENOENT: no such file or directory`, with the index's path                                                                                                     | The function's bundle does not include the index. `init` adds it with `includeFiles` in `vercel.json` or `included_files` in `netlify.toml`: check that the path is your build's output folder.                                                                                                                                                                               |
| `Index is not valid JSON`                                                                                                                                      | `index` takes the index, not its path: `import index from './ask-index.json'`, or `index: () => readFile(path, 'utf8')`.                                                                                                                                                                                                                                                      |
| `Could not fetch the index at https://example.com/ask-index.json: HTTP 502.`                                                                                   | A `remoteIndex`, as in the Worker `init --host github-pages` writes, had no copy of the index yet and could not download it from the site. It tries again on the next request, so Retry may answer. If it keeps failing, open that URL: the site must be deployed with its index, and `SITE_URL` in the Worker's wrangler config must be the site's URL with its base path.   |

## The answer could not be generated

The sources appear, then `The answer could not be generated. Please try again.` and a Retry button. The endpoint found the sources, and then the call to the model that writes the answer failed for another reason, such as the provider's rate limit, an outage, a timeout, a model the provider does not know or an account out of credit. Some of these pass, so the dialog offers Retry. The log says which; on a page served from your machine, or in a development build, the browser console points at it.

## It says "I don't know" when the docs have the answer

The dialog answers `I don't know. I couldn't find anything about that on this site.`, with your site's name if the endpoint has one, to a question your docs answer.

The endpoint's relevance gate found no source close enough to the question, and answered without calling the model, or the model found no answer in the sources it got. On a keyword-only index, the gate goes by how many of the question's words a page has, so a question in other words than the docs' is refused more often.

Embed the pages, as in [No embedding model](#no-embedding-model-building-a-keyword-only-index), so that the gate matches meaning too. To tune it, score real questions from your readers with `ondocs eval`, then set `retrieval.minKeywordCoverage` or `retrieval.minSimilarity`. See [How retrieval works](/docs/retrieval#saying-i-dont-know) and [Measure and improve answers](/docs/quality).

## Too many questions

The dialog shows `Too many questions. Try again shortly.` when the endpoint's rate limit answers with a 429. By default it allows 10 questions a minute per visitor, by the client IP in `X-Forwarded-For`. On a host that does not set that header, all visitors share one limit, and the log says which setting to change: see [Which client IP header to trust](/docs/security#which-client-ip-header-to-trust). The endpoints `init` writes already read their host's header.

`The assistant has reached its daily limit. Please try again later.` is the daily `budget`, also a 429. Raise it in the endpoint's code, or wait for it to reset: see [Cap the daily spend](/docs/security#cap-the-daily-spend).

## Could not reach the server

The dialog shows `Could not reach the server. Check your connection.` when the request fails in the browser, before the endpoint answers. Besides a network failure, a CORS refusal does this: for an endpoint on another origin than the page, the browser console then shows a CORS error for the endpoint's URL.

An endpoint on another origin has to allow the page's origin. The Worker `init --host github-pages` writes allows the site's origin only, from `SITE_URL` in its wrangler config, so a preview deployment or a copy of the site on your machine is turned away. On your machine, use `ondocs dev`, which answers pages on this machine. For another origin of your own, add it to the endpoint's CORS headers: see [Cross-origin requests](/docs/security#cross-origin-requests).

## Still stuck

[Open an issue](https://github.com/dgesteves/ondocs/issues) with the version from `npm ls ondocs`, your framework and host, the message, and the line from the endpoint's log.
