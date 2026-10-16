---
# Generated from examples/nextjs/content/docs/script-tag.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Script tag'
description: 'Add the dialog to Hugo, Jekyll, Eleventy, MkDocs or plain HTML with one script tag.'
---

For a site that does not build with React, such as Hugo, Jekyll, Eleventy, MkDocs or plain HTML, one script tag adds the dialog and its "Ask AI" button.

## Add the script tag

Add this tag to your base template, before `</body>` or in `<head>`:

```html
<script
  src="https://cdn.jsdelivr.net/npm/ondocs@0.11/dist/embed.global.js"
  data-endpoint="/api/ask"
  defer
></script>
```

The script mounts itself once the page has loaded. It opens the dialog from a floating "Ask AI" button and with ⌘I or Ctrl+I, so ⌘K stays with your site's search. Pin an exact version, such as `ondocs@0.11.0`, in production.

## Script size

The embed script, `embed.global.js`, is 3.2 KB gzipped: the button, the shortcut and their styles. The dialog, with React and its styles, is a second file next to it, `embed-dialog.global.js` (97 KB gzipped), which the script loads the first time the dialog is wanted: a pointer over or focus on the button, the shortcut, or `open()`. A shortcut pressed while it loads still opens the dialog once it arrives. The page needs nothing else, and `defer` loads the script without blocking the page.

If you host the script yourself, copy both files to the same folder, or point at the dialog's file with `data-dialog-src`.

## Index a static site

The script only adds the dialog; the answers come from an endpoint that reads your index. Build the index with the CLI, either from your Markdown or from the HTML your generator built, which has the URLs it actually serves:

```sh
hugo && npx ondocs index public -o public/ask-index.json \
  -e openai:text-embedding-3-small
```

`-o public/ask-index.json` puts the index in the folder the site deploys, where the endpoint reads it. The OpenAI embedding needs `OPENAI_API_KEY` set. Without a key, `-e none` builds a keyword-only index, which works too.

A site served under a path, such as a GitHub Pages project site at `https://user.github.io/repo`, needs `--base-url /repo` too. Citations and the MCP endpoint's results then link to `/repo/guide.html`, where the page is, rather than `/guide.html`, which is not found. `npx ondocs init --host github-pages` adds it to the command it prints, from the site's URL.

The output folder is `public` after `hugo`, `_site` after Jekyll or Eleventy, and `site` after `mkdocs build`. HTML is read from each page's `<main>`, and citations link to the headings' own `id`s. `index.html` stands for its folder, and other HTML files keep `.html` in their URLs unless you pass `--clean-urls`, for hosts that serve `/guide.html` at `/guide`.

## Deploy the endpoint for a static site

Write the endpoint with `npx ondocs init` in the site's folder. It finds Hugo, Jekyll, MkDocs and Eleventy from their config files. Plain HTML has none, so name the folder of HTML files with `--out`, as in `npx ondocs init --out public`. It writes a Vercel, Netlify or Cloudflare function that reads the index next to the site's files, or, for GitHub Pages, S3 or any host that only serves files, a Cloudflare Worker of its own that reads the index from the live site, answers it across origins and needs no API key: see [Workers AI](./workers-ai.md). Then set `data-endpoint` to the Worker's URL plus `/api/ask`. On Vercel, Netlify and Cloudflare, the functions import `ondocs`, `ai` and `@ai-sdk/openai`, and init prints the command that installs them, with `npm init -y` first for a site that has no `package.json`. See [Deploying](./deployment.md).

To try it first, run `npx ondocs dev` beside the index and set `data-endpoint="http://localhost:8787/api/ask"`.

## Script tag attributes

| Attribute                 | Default            | What it does                                                                          |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `data-endpoint`           | `/api/ask`         | Where the dialog posts questions.                                                     |
| `data-title`              | "Ask this site"    | The dialog's accessible name.                                                         |
| `data-placeholder`        | "Ask a question…"  | The input's placeholder.                                                              |
| `data-suggestions`        | none               | A JSON array, as in `data-suggestions='["How do I install it?"]'`.                    |
| `data-shortcut`           | `i`                | The key used with ⌘ or Ctrl; `"false"` turns it off.                                  |
| `data-launcher`           | "Ask AI"           | The floating button's label; `"false"` hides the button.                              |
| `data-theme`              | `auto`             | `auto` follows `data-theme` on `<html>`, then the system; or `light` or `dark`.       |
| `data-links`              | `all`              | `sources` keeps only the answer's links to its source pages.                          |
| `data-labels`             | English            | The dialog's words, as a JSON object, as in `data-labels='{"launcher":"Demander"}'`.  |
| `data-label-<name>`       | English            | One label, as in `data-label-new-question="Nouvelle question"`; over `data-labels`.   |
| `data-locale`             | none               | The page's locale, sent with each question, for an endpoint with an index per locale. |
| `data-turnstile-site-key` | none               | A Turnstile site key: solve a [bot check](./bot-challenge.md) before each question.   |
| `data-manual`             | off                | Don't mount; wait for `window.Ondocs.mount()`.                                        |
| `data-dialog-src`         | next to the script | Where `embed-dialog.global.js` is, for a copy hosted elsewhere.                       |

## Open it from your own search box

Any element with a `data-ondocs-open` attribute opens the dialog, and its value, if it has one, is a question for it to ask. Put the button in your header and hide the floating one:

```html
<script
  src="https://cdn.jsdelivr.net/npm/ondocs@0.11/dist/embed.global.js"
  data-endpoint="/api/ask"
  data-launcher="false"
  defer
></script>
<button type="button" data-ondocs-open>Ask AI</button>
```

From a script, `window.Ondocs.open(question?)` opens it. With `data-manual`, the script waits for you to call `window.Ondocs.mount(options)`, which takes the same options as the attributes and returns `{ open, close, unmount }`; `open` takes a question too. See [Open it from your own button](./ask-dialog.md#open-it-from-your-own-button) for forms and the button's look.

## With a bundler

In an app with a bundler, `mountAskDialog(options)` from `ondocs/embed` does the same with your own copy of React. Install `react`, `react-dom`, `@radix-ui/react-dialog` and `cmdk`, and import `ondocs/react/styles.css` and `ondocs/embed/launcher.css` with it.
