---
'ondocs': patch
---

A Starlight or Astro site whose every locale has a path prefix (Starlight's `defaultLocale: 'en'` with no `root` locale, or Astro's `prefixDefaultLocale`) has no pages at its root, so the build wrote no `ask-index.json` there, and the ask and MCP routes the integration serves with an adapter answered every request with a 500. The build now copies the default locale's `ask-index.json`, `llms.txt` and `llms-full.txt` to the root, where those routes, the MCP endpoint `ondocs init` writes and agents read them. A `llms.txt` the site already has there is left as it is.
