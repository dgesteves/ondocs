// A VitePress site with each setting that moves pages: base, cleanUrls, rewrites, srcExclude,
// locales and dynamic routes, and with a page that has search: false. test/vitepress.test.ts
// builds it with VitePress, and the plugin from its source.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitepress';

import { withOndocs } from '../../../../src/vitepress';

const src = (path: string) => fileURLToPath(new URL(`../../../../src/${path}`, import.meta.url));

export default withOndocs(
  defineConfig({
    title: 'Acme',
    description: 'Docs for Acme.',
    base: '/docs/',
    cleanUrls: true,
    srcExclude: ['drafts/**'],
    rewrites: { 'guide/:page': 'manual/:page' },
    sitemap: { hostname: 'https://acme.dev' },
    locales: {
      root: { label: 'English', lang: 'en' },
      fr: { label: 'Français', lang: 'fr', title: 'Acme FR', description: 'La doc d’Acme.' },
    },
    vite: {
      logLevel: 'silent',
      // ondocs's modules from their source, as the tests run before a build.
      resolve: {
        alias: [
          { find: /^ondocs\/embed$/, replacement: src('embed/index.ts') },
          { find: /^ondocs\/react\/styles\.css$/, replacement: src('react/styles.css') },
          { find: /^ondocs\/embed\/launcher\.css$/, replacement: src('embed/launcher.css') },
          {
            find: /^ondocs\/vitepress\/launcher\.css$/,
            replacement: src('vitepress/launcher.css'),
          },
        ],
      },
    },
    // The site's own hooks, which must still run.
    transformHtml: (html) => html.replace('</body>', '<!-- own transformHtml --></body>'),
    async buildEnd({ outDir }) {
      const indexed = existsSync(join(outDir, 'ask-index.json'));
      await writeFile(join(outDir, 'own-build-end.txt'), indexed ? 'after the index' : 'first');
    },
  }),
  {
    embedding: 'mock:32',
    exclude: ['/manual/old'],
    mcp: '/api/mcp',
    dialog: { suggestions: ['How do I install it?'] },
  },
);
