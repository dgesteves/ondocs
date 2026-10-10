---
'ondocs': minor
---

New entry, `ondocs/integration`: the build helpers the Docusaurus, Astro and Starlight plugins are made of, for a plugin for another framework. It reads the pages a build wrote (`readBuiltHtml`, `loadBuiltPage`), builds the embedding model (`buildEmbedding`), writes the index with the previous build's vectors (`writeSiteIndex`, `indexCache`) and the llms files (`writeLlmsFiles`), and adds the launcher to every page (`launcherScript`, `LAUNCHER_STYLESHEETS`). The plugins now build with it alone. See "Writing an integration" in the docs.
