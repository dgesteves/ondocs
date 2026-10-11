---
'ondocs': patch
---

`docusaurus-plugin-ondocs` and `starlight-ondocs` now publish to npm, at the same version as `ondocs`. They re-export `ondocs/docusaurus` and `ondocs/starlight` under the names Docusaurus and Starlight users search for, as the 0.7.0 release notes and the migration guide said, but until now they were left out of the publish, so `npm i docusaurus-plugin-ondocs` or `npm i starlight-ondocs` found nothing.
