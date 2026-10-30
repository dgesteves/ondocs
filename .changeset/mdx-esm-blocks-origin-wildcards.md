---
'ondocs': patch
---

`ondocs index` reads MDX imports and exports more like MDX does. An `export` line inside a code fence indented in JSX is kept as code, where it was dropped, and an import or export right after a JSX tag line, a `{…}` expression, a thematic break or a setext underline is dropped, where it was kept as text. `allowedOrigins` also refuses an entry with `*` in it, such as `'https://*.example.com'`, which matched no request: list each origin.
