import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Docusaurus's client modules only exist in a Docusaurus build; the theme's tests stand in.
    alias: [
      // The Cloudflare Worker template and the website's demo import the package by name; their
      // tests here run it from the source, which is all there is before a build.
      {
        find: /^ondocs\/(server|mock|react)$/,
        replacement: `${fileURLToPath(new URL('src', import.meta.url))}/$1/index.ts`,
      },
      {
        find: /^ondocs$/,
        replacement: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      },
      {
        // The theme's own components, which its other components import as Docusaurus names them.
        find: /^@theme\/(Ondocs|OndocsMcp)$/,
        replacement: `${fileURLToPath(new URL('src/docusaurus/theme', import.meta.url))}/$1.tsx`,
      },
      {
        // The theme component the plugin's Navbar/Search wraps: the classic theme's container.
        find: /^@theme-init\/Navbar\/Search$/,
        replacement: fileURLToPath(new URL('test/docusaurus-navbar-search.tsx', import.meta.url)),
      },
      {
        find: /^@docusaurus\/(BrowserOnly|router|useGlobalData)$/,
        replacement: fileURLToPath(new URL('test/docusaurus-client.tsx', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // React tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    restoreMocks: true,
    testTimeout: 20_000,
  },
});
