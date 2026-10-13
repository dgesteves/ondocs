---
'ondocs': minor
---

The dialog takes a `sourceUrls` option, for an endpoint that answers from another site's index, such as a copy of that site's docs. `pages` maps a page's URL in that index to the same page on this site, keeping the anchor, and `base` is the other site's address, which any other relative link opens on. Citations, the sources list and the links in an answer follow it. `AskDialog`, `AskAnswer`, `mountAskDialog` and the Docusaurus, Astro, Starlight and VitePress plugins' `dialog` option take it; without it, nothing changes.
