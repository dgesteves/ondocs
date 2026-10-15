---
'ondocs': patch
---

`llms.txt` now names the MCP endpoint that `ondocs/astro` and `ondocs/starlight` serve with an SSR adapter. The integration served `/api/mcp`, but `llms.txt` and `McpInstall.astro` only knew of it when `mcp` was set by hand. With `site` set, the route is now the default for `mcp`, under `base` and at `route.mcp`'s path; `mcp` still names another endpoint, and `route: { mcp: false }` leaves it out.

`ondocs init` now tells a Docusaurus, Astro, Starlight or VitePress site to set the plugin's `mcp` option to the MCP endpoint it writes: `mcp: '/api/mcp'`, or the Worker's URL on GitHub Pages. Before, its steps never mentioned it, so `llms.txt` and `<OndocsMcp />` said nothing of the endpoint init had just written. The plugin resolves the path against the site's URL, so when the config has none (Astro's `site`, VitePress's `sitemap.hostname`), the step says to set it first. For an Astro site with an adapter and no `site`, `init` and the integration's log say to set it, so `llms.txt` can name the route. When the config already sets `mcp`, the step leaves it out.

An `mcp` URL that does not parse, such as the GitHub Pages Worker's with `<your-subdomain>` left in, now stops the build with an error that says what to put there, rather than going into `llms.txt` as it is.
