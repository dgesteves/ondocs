---
'ondocs': patch
---

`ondocs dev` and `ondocs eval` find an index in `public/`, `site/` or `_site/` without `--index`. These are where `ondocs init` has `ondocs index -o` write it on a Hugo site or a Next.js site on GitHub Pages (`public/ask-index.json`), an MkDocs site (`site/`) and a Jekyll or Eleventy site (`_site/`), so following init's steps and then running `npx ondocs dev` said "No index found". They are looked in after the folders the plugins write to.
