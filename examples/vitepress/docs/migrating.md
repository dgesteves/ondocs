---
# Generated from examples/nextjs/content/docs/migrating.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Migrating from ask-my-site'
description: 'ask-my-site is now ondocs. What was renamed, what stays, and the commands to move a site over.'
---

# Migrating from ask-my-site

`ask-my-site` is now `ondocs`. Version 0.7.0 is the first release under the new name; `ask-my-site` stays at 0.6.0 and gets no new releases. The options, the endpoints and their paths, `ask-index.json` and its format are the same, and the rename changes nothing in what the dialog and the endpoint send each other. The old names of the Docusaurus theme components, the script tag's global and the types still work, with a notice where there is one to give, until you rename them.

## What changed

| What                              | Before                                                              | Now                                                                      |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| npm package                       | `ask-my-site`                                                       | `ondocs`                                                                 |
| Command                           | `npx ask-my-site index`, `init`, `dev`, `eval`                      | `npx ondocs index`, `init`, `dev`, `eval`                                |
| Imports                           | `ask-my-site/server`, `/react`, `/docusaurus`, `/starlight`, …      | `ondocs/server`, `/react`, `/docusaurus`, `/starlight`, …                |
| Stylesheets                       | `ask-my-site/react/styles.css`, `ask-my-site/embed/launcher.css`    | `ondocs/react/styles.css`, `ondocs/embed/launcher.css`                   |
| Script tag                        | `https://cdn.jsdelivr.net/npm/ask-my-site@0.6/dist/embed.global.js` | `https://cdn.jsdelivr.net/npm/ondocs@0.16/dist/embed.global.js`          |
| Script tag's global               | `window.AskMySite.mount()`                                          | `window.Ondocs.mount()` (the old name still works)                       |
| Docusaurus theme components       | `@theme/AskMySite`, `@theme/AskMySiteMcp`                           | `@theme/Ondocs`, `@theme/OndocsMcp` (the old names still work)           |
| Docusaurus plugin's name          | `ask-my-site`                                                       | `ondocs`, as in `useAllPluginInstancesData('ondocs')`                    |
| Astro integration's name          | `ask-my-site`                                                       | `ondocs`, which Astro's log lines start with                             |
| Types                             | `AskMySiteOptions`, `AskMySiteDialogOptions`, `AskMySiteTheme`, …   | `OndocsOptions`, `OndocsDialogOptions`, `OndocsTheme`, … (old ones work) |
| The button's class                | `.ask-my-site-launcher`                                             | `.ondocs-launcher`                                                       |
| The script tag's container        | `<div class="ask-my-site">`                                         | `<div class="ondocs">`                                                   |
| Build cache                       | `node_modules/.cache/ask-my-site`                                   | `node_modules/.cache/ondocs`                                             |
| Log lines and errors              | `[ask-my-site]`, `ask-my-site:`                                     | `[ondocs]`, `ondocs:`                                                    |
| MCP server's name in `initialize` | `ask-my-site`                                                       | `ondocs` (the `name` option still sets your own)                         |
| Plugins under their own names     | none                                                                | `docusaurus-plugin-ondocs` and `starlight-ondocs`, new                   |
| Repository                        | `github.com/dgesteves/ask-my-site`                                  | `github.com/dgesteves/ondocs` (old links redirect)                       |

## What stays the same

- `ask-index.json`, and the format it records, `ask-my-site/index@1`: an index built by either package is read by both.
- `createAskHandler`, `createMcpHandler`, `AskDialog`, `useAsk`, `mountAskDialog` and every other export, with the same options.
- `/api/ask`, `/api/mcp` and `ASK_ENDPOINT`.
- The dialog's `ask-*` classes and `--ask-*` CSS variables, including `--ask-launcher-*`, and the script tag's `data-*` attributes.
- The keys `budget` and `answerCache` write to a shared store, which start `ask-my-site:budget:`, `ask-my-site:answer:` and `ask-my-site:mcp-budget:`, so an Upstash store keeps the day's counts and its answers across the upgrade.

## Move a site over

Swap the package:

```sh
npm uninstall ask-my-site
npm install ondocs
```

With pnpm, Yarn or Bun, use `pnpm remove` and `pnpm add`, `yarn remove` and `yarn add`, or `bun remove` and `bun add`. If the site installed the plugin's peers for the dialog (`ai`, `@ai-sdk/openai`, `@radix-ui/react-dialog`, `cmdk`), they stay as they are.

Then rename the imports, the commands in scripts and CI, the script tag's URL, the theme components, the types and the button's class in one go. Run this from the repository's root, after the install above, so `package.json` already names `ondocs`:

```sh
git ls-files -z -- '*.js' '*.jsx' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.mts' '*.md' '*.mdx' \
  '*.astro' '*.html' '*.css' '*.yml' '*.yaml' 'package.json' \
  | xargs -0 perl -pi -e 's{(["\x27`])ask-my-site(?=[/"\x27`])}{$1ondocs}g; s{\bask-my-site (?=index|init|dev|eval)}{ondocs }g; s{(cdn\.jsdelivr\.net/npm|unpkg\.com)/ask-my-site(?:\@[\d.]+)?}{$1/ondocs\@0.16}g; s{ask-my-site-launcher}{ondocs-launcher}g; s{\.ask-my-site(?![\w-])}{.ondocs}g; s{\bAskMySite}{Ondocs}g; s{\baskMySite\b}{ondocs}g'
```

It leaves links to `github.com/dgesteves/ask-my-site` and the demo site alone, since they still work. Check the result with `git diff` before you commit it. A script tag pinned to an exact version, such as `ask-my-site@0.6.0`, comes out as `ondocs@0.16`: pin it again, such as `ondocs@0.16.3`.

### Docusaurus

The plugin is `ondocs/docusaurus`, or `docusaurus-plugin-ondocs` under its own package, installed next to `ondocs` rather than in its place:

```ts
// docusaurus.config.ts
export default { plugins: ['ondocs/docusaurus'] };
```

- **A swizzled `Root`** that renders `<AskMySite />` from `@theme/AskMySite` keeps working, and says once, in the build's output and in the browser's console with `docusaurus start`, to import `Ondocs` from `@theme/Ondocs` instead. The command above does that.
- **A swizzled copy of the dialog,** `src/theme/AskMySite.tsx` (or `.js`, or a folder), is no longer rendered, since the plugin's `Root` renders `@theme/Ondocs`; the plugin warns when it finds one. Rename it, and any `@theme-original/AskMySite` import in it, which the command above changes to `@theme-original/Ondocs`:

  ```sh
  git mv src/theme/AskMySite.tsx src/theme/Ondocs.tsx
  ```

- **An MDX page** that imports `@theme/AskMySiteMcp` keeps working; the command above changes it to `OndocsMcp` from `@theme/OndocsMcp`.

### Astro and Starlight

Import the plugin or the integration from `ondocs/starlight` or `ondocs/astro`, or `starlight-ondocs` under its own package, installed next to `ondocs` rather than in its place: the site's build imports `ondocs/...` modules itself, and pnpm gives a project only its direct dependencies. The default export's name is yours to choose; these docs call it `ondocs`:

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import ondocs from 'ondocs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [starlight({ title: 'Acme Docs', plugins: [ondocs()] })],
});
```

The MCP block for a page is `ondocs/astro/McpInstall.astro`.

### Script tag

Point the tag at the new package:

```html
<script
  src="https://cdn.jsdelivr.net/npm/ondocs@0.16/dist/embed.global.js"
  data-endpoint="/api/ask"
  defer
></script>
```

The old URL keeps serving `ask-my-site` 0.6, so nothing breaks until you change it. A page that mounts the dialog by hand with `window.AskMySite.mount()` keeps working on the new script, which says once in the browser console to use `window.Ondocs.mount()`. Rename `.ask-my-site-launcher` to `.ondocs-launcher` in your CSS, and `.ask-my-site` to `.ondocs` if you style the script tag's container. If you host the script yourself, copy both `embed.global.js` and `embed-dialog.global.js` from the new package.

### Endpoints

Import `createAskHandler` and `createMcpHandler` from `ondocs/server`; their options are the same. An MCP client lists the server under the key in its own config, so nothing changes for people who already added it, but `initialize` now names the server `ondocs`: pass `name` to `createMcpHandler` to keep the old one.

## Clean up

The first build after the upgrade reuses the vectors in `node_modules/.cache/ask-my-site`, so it embeds only what changed, and from then on uses `node_modules/.cache/ondocs`. After that build, the old folder can be deleted:

```sh
rm -rf node_modules/.cache/ask-my-site
```
