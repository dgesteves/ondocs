// The ondocs Starlight plugin, under the name Starlight users search for. Everything is in
// ondocs/starlight; this package only re-exports it, at the same version, and checks that the
// site has ondocs installed itself.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import plugin from 'ondocs/starlight';

export * from 'ondocs/starlight';

/** @param {import('ondocs/starlight').OndocsStarlightOptions} [options] */
export default function ondocs(options) {
  const starlightPlugin = plugin(options);
  const setup = starlightPlugin.hooks['config:setup'];
  return {
    ...starlightPlugin,
    hooks: {
      ...starlightPlugin.hooks,
      'config:setup'(params) {
        checkInstalled(params.astroConfig.root);
        return setup(params);
      },
    },
  };
}

// The plugin adds ondocs/... modules to the site's pages, which Vite resolves from the project's
// node_modules folders, as this does. npm puts the ondocs this package depends on there; pnpm
// gives a project only its direct dependencies, and the build then fails on the first of those
// modules: `Rolldown failed to resolve import "ondocs/react/styles.css"`. (Node's require would
// find it on the NODE_PATH that pnpm's `astro` command sets, where Vite does not look.)
function checkInstalled(root) {
  // Yarn's Plug'n'Play has no node_modules folders, and checks dependencies itself.
  if (process.versions.pnp) return;
  for (let dir = fileURLToPath(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', 'ondocs', 'package.json'))) return;
    if (dirname(dir) === dir) break;
  }
  const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
  throw new Error(
    `starlight-ondocs: install ondocs next to it, at the same version: pnpm add ondocs@${version} ` +
      '(or npm i, yarn add, bun add). The plugin adds ondocs/... modules to your pages, and the ' +
      `build resolves them from your project, ${fileURLToPath(root)}, where ondocs is not ` +
      'installed: pnpm gives a project only its direct dependencies. See ' +
      'https://ondocs.vercel.app/docs/troubleshooting#ondocs-command-not-found',
  );
}
