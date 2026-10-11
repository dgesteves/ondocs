---
'ondocs': minor
---

The Docusaurus, Astro, Starlight and VitePress plugins link each page to its Markdown copy. After the build, every page that has a `.md` copy gets `<link rel="alternate" type="text/markdown" href="…">` in its `<head>`, with the site's base path and the page's locale, so an agent that fetches the page finds the copy. A page whose head already links a Markdown copy keeps its own, and no page is linked when `llmsTxt` turns the copies off or another plugin writes them. Each page's HTML is replaced in one step, so a Docusaurus plugin reading it in its own `postBuild` at the same time reads all of it. In `ondocs/integration`, `writeLlmsFiles` takes `linkPages` to do the same for another framework.
