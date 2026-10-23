---
'ondocs': patch
---

`ondocs dev` lists VitePress with Docusaurus, Astro and Starlight where it says to start the site with `ASK_ENDPOINT`, and in its message when it finds no index to serve. The VitePress plugin reads `ASK_ENDPOINT` as the others do.
