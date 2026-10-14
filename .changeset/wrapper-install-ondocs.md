---
'starlight-ondocs': patch
'docusaurus-plugin-ondocs': patch
---

`starlight-ondocs` now stops `astro build` and `astro dev` with a message that says what to do when the project has no `ondocs` of its own: "install ondocs next to it, at the same version: pnpm add ondocs@…". pnpm gives a project only its direct dependencies, so a Starlight site that installed only `starlight-ondocs`, as its README said, failed with `Rolldown failed to resolve import "ondocs/react/styles.css"`. A project where npm put `ondocs` next to it keeps building as before. The READMEs of both plugin packages now install `ondocs` with them, which also gives the project the `ondocs` command and `ondocs/server` for the endpoint.
