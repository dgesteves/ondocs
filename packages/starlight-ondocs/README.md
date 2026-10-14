# starlight-ondocs

The [ondocs](https://github.com/dgesteves/ondocs) Starlight plugin, under the name Starlight users search for. It makes your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor.

This package only re-exports `ondocs/starlight`, at the same version. Everything is documented on [the ondocs website](https://ondocs.vercel.app/docs/astro).

```sh
npm i starlight-ondocs ondocs ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk
```

Install `ondocs` with it, as the line above does: your project needs it itself. The plugin adds `ondocs/...` modules to your pages, the endpoint you deploy imports `ondocs/server`, and the `ondocs` command (`npx ondocs init`) comes from it. npm finds it as this package's dependency, but pnpm gives a project only its direct dependencies, so without it `astro build` stops and says to install it. The two are released together: keep them at the same version.

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import ondocs from 'starlight-ondocs';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [starlight({ title: 'Acme Docs', plugins: [ondocs()] })],
});
```

After `astro build`, the plugin indexes what Starlight's search indexes into `dist/ask-index.json` (one per locale), writes `llms.txt` and a `.md` copy of each page, and adds an "Ask AI" button with ⌘I. The answers come from an endpoint you deploy next to the site: see [Deploying](https://ondocs.vercel.app/docs/deployment).

MIT © Diogo Esteves
