---
'ondocs': patch
---

`ondocs init` on a static site (Hugo, Jekyll, MkDocs, Eleventy or plain HTML) on Vercel, Netlify or Cloudflare now lists the packages its functions import, `ondocs ai @ai-sdk/openai`, in its next steps. A site with no `package.json` gets `npm init -y && npm i ondocs ai @ai-sdk/openai`, since the host installs the functions' packages from one. Before, the steps left out `ai` and `@ai-sdk/openai`, or said nothing without a `package.json`, and the functions failed to build.
