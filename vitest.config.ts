import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Whether this run measures coverage, which a test reads with `inject('coverage')`. */
    coverage: boolean;
  }
}

export default defineConfig({
  plugins: [
    {
      // Coverage slows the code it measures, by how much depends on the code, so
      // test/robustness.test.ts drops its time budget under it. The resolved config says whether
      // coverage is on, however it was turned on: --coverage, --coverage.enabled or a config.
      name: 'ondocs:provide-coverage',
      configureVitest({ project, vitest }) {
        project.provide('coverage', vitest.config.coverage.enabled);
      },
    },
  ],
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
    // `pnpm test:coverage`, which CI's coverage job runs: the package's source, with thresholds
    // a point or so under what the tests reach (96.2% of statements, 89.4% of branches, 96.9% of
    // functions and 97.5% of lines), so a change that leaves much new code untested fails.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { statements: 95, branches: 88, functions: 95, lines: 96 },
    },
  },
});
