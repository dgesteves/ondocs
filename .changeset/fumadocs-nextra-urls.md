---
'ondocs': patch
---

`ondocs index`, and `loadDirectory` with `framework: 'next'` or `'auto'`, now cite Fumadocs and Nextra pages at the URLs those frameworks serve. On any Next.js site, `page.mdx` and `Index.mdx` in a content folder are pages of their own, and an `app` folder is read as Next.js routes it: only `page.mdx` files, without `_private` folders. Nextra keeps `(group)` folders in the URL, and a `## Title [#id]` heading is cited at `#id`. `frameworkUrl` is unchanged.
