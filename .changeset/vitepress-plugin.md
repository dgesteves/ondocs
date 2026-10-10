---
'ondocs': minor
---

New VitePress plugin, `ondocs/vitepress`: wrap the config in `withOndocs(defineConfig({ ... }))` and, after `vitepress build`, it indexes the pages at the URLs VitePress serves (with `base`, `cleanUrls`, `rewrites`, `srcExclude`, dynamic routes and an index per locale, leaving out pages with `search: false`), writes `llms.txt`, `llms-full.txt` and a Markdown copy of each page, and adds the "Ask AI" button and ⌘I to every page: about 2 KB of JavaScript, in VitePress's colors and dark mode, with the dialog loaded the first time it is wanted. No theme file is needed. `npx ondocs init` now recognizes VitePress sites and writes their endpoint for the index the plugin builds, and `ondocs dev` finds `.vitepress/dist/ask-index.json`.

`ondocs/integration` adds `quietUseClient`, and `launcherScript` takes `spa: true` for a site that moves between pages without loading them.
