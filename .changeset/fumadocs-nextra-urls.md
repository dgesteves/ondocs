---
'ondocs': patch
---

`ondocs index` now cites Fumadocs and Nextra pages at the URLs those frameworks serve: in a content folder, `page.mdx` and `Index.mdx` are pages of their own and Nextra keeps `(group)` folders in the URL, an `app` folder is read as Next.js routes it (only `page.mdx` files, without `_private` folders), and a `## Title [#id]` heading is cited at `#id`.
