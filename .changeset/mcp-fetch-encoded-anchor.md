---
'ondocs': patch
---

The MCP endpoint's `fetch` reads the section named by a URL that `search` returned for a heading that is not ASCII. `search` returns absolute URLs, which percent-encode the anchor (`#configura%C3%A7%C3%A3o-r%C3%A1pida` for `## Configuração rápida`), and `fetch` compared it with the index's `#configuração-rápida` as written, so it returned the whole page with a note that the section did not exist. Anchors are now compared decoded, from an absolute URL or a path.
