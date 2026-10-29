---
'ondocs': patch
---

`ondocs index` and the Docusaurus, Astro, Starlight and VitePress plugins warn when they write an index over 20 MiB. Cloudflare Pages and Workers refuse a static asset over 25 MiB, which is how the endpoints `ondocs init` writes for them read the index, and a Worker has 128 MB of memory to load it in. Until now the first sign was a failed deploy: 12,000 chunks at 1,536 dimensions make a 34.8 MiB index, and the CLI printed only its size. The warning names the ways to make the index smaller that it does not take already: 512 dimensions (`--dimensions 512` or `dimensions: 512`, not offered for a Workers AI model or a model of your own, whose vector size is fixed), keyword-only (`--embedding none` or `embedding: 'none'`), fewer pages (`--ignore` or `exclude`), and, with the CLI, one index per locale. [Limits](https://ondocs.vercel.app/docs/limits#index-size) has the sizes.
