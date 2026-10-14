---
'ondocs': patch
---

`ondocs init --host github-pages` works for a project site, at `https://user.github.io/repo`. For Hugo, Jekyll, MkDocs, Eleventy or plain HTML, the index command it prints now has `--base-url /repo` when the site's URL has a path, so citations and the MCP endpoint's results link to `/repo/guide.html` instead of `/guide.html`, which was not found. For VitePress, a `sitemap.hostname` that already ends with `base`, as VitePress's own sitemap needs on a project site, no longer gives a `SITE_URL` with the path twice (`https://user.github.io/repo/repo`), from which the Worker could not fetch the index and answered every question with an error.
