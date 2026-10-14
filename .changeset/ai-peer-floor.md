---
'ondocs': patch
'docusaurus-plugin-ondocs': patch
'starlight-ondocs': patch
---

The `ai` peer range is now `^7.0.95`, up from `^7.0.0`. A project that already had ai 7.0.0 to 7.0.50 kept it when it installed ondocs, as it was in range, and the Docusaurus plugin, which Docusaurus loads through jiti, then failed with `TypeError: Cannot read properties of undefined (reading 'discriminatedUnion')`. Update an older ai 7 with `npm i ai@7`. ondocs needs AI SDK 7, as before, and the README now says so.
