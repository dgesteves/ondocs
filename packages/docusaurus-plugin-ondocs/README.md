# docusaurus-plugin-ondocs

The [ondocs](https://github.com/dgesteves/ondocs) Docusaurus plugin, under the name Docusaurus users search for. It makes your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor.

This package only re-exports `ondocs/docusaurus`, at the same version. Everything is documented on [the ondocs website](https://ondocs.vercel.app/docs/docusaurus).

```sh
npm i docusaurus-plugin-ondocs ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

Install `ondocs` with it, as the line above does: your project needs it itself. The endpoint you deploy imports `ondocs/server`, and the `ondocs` command (`npx ondocs init`) comes from it. npm finds it as this package's dependency, but pnpm gives a project only its direct dependencies. The two are released together: keep them at the same version.

```ts
// docusaurus.config.ts
export default {
  plugins: ['docusaurus-plugin-ondocs'],
};
```

Use the full name: Docusaurus resolves the shorthand `'ondocs'` to the `ondocs` package itself, which is not the plugin. `plugins: ['ondocs/docusaurus']` is the same plugin, from the main package.

After `docusaurus build`, the plugin indexes the pages into `build/ask-index.json`, writes `llms.txt` and a `.md` copy of each page, and adds an "Ask AI" button with ⌘I. The answers come from an endpoint you deploy as one function on your host: see [Deploying](https://ondocs.vercel.app/docs/deployment).

MIT © Diogo Esteves
