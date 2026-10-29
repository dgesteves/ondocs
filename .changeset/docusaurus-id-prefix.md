---
'ondocs': patch
---

`ondocs index` cites a Docusaurus page whose front matter `id` starts with a number at the URL Docusaurus serves it at. The number prefix was dropped from the `id` as from a file name, so `id: 01-intro` was cited at `/docs/intro` and `id: 2-step` at `/docs/step`, where Docusaurus serves `/docs/01-intro` and `/docs/2-step`, and the citations led to a 404. As in Docusaurus, the prefix is now dropped from file and folder names only.
