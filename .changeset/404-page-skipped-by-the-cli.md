---
'ondocs': patch
---

`ondocs index` skips the 404 page a generator writes (`404.html`, `404.htm` or `404/index.html`, at any depth) instead of indexing it as a page, as the plugins already did. A page such as `docs/404-errors.html` is still indexed.