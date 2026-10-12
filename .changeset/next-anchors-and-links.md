---
'ondocs': patch
---

`ondocs index` now cites Nextra and Fumadocs headings at the ids those sites render (a mixed-case `[#id]` in a Nextra `app` page is lowercased, and footnote references such as `[^1]` are left out of the anchor and the heading's text, as on Docusaurus), resolves relative links in the `.md` copy of a page in a Nextra `(group)` folder from that folder, and `frameworkUrl` takes an optional `routing`, so it gives the URL `loadDirectory` gives for a content folder's `page.mdx`.
