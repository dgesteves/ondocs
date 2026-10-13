import starlight from '@astrojs/starlight';
import ondocs from 'ondocs/starlight';
import { defineConfig } from 'astro/config';

import { sourceUrls } from './source-urls.mjs';
import { suggestions } from './suggestions.mjs';

export default defineConfig({
  // The live demo's address, for llms.txt and the pages' own links.
  site: process.env.SITE_URL ?? 'https://ondocs-starlight.vercel.app',
  integrations: [
    starlight({
      title: 'ondocs',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/dgesteves/ondocs' }],
      // The pages are generated from the website's docs (scripts/sync-example-docs.mjs), one
      // folder per section; the changelog and ai-tools pages are this site's own.
      sidebar: [
        { label: 'Get started', items: ['', { autogenerate: { directory: 'get-started' } }] },
        { label: 'Integrations', items: [{ autogenerate: { directory: 'integrations' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        'changelog',
        'ai-tools',
      ],
      // The live demo's banner on every page, and each page's canonical link on the website.
      routeMiddleware: './src/route-data.ts',
      // The first page's title, with the question box above it.
      components: { PageTitle: './src/components/PageTitle.astro' },
      customCss: ['./src/styles/demo.css'],
      plugins: [
        ondocs({
          // With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this
          // example uses the offline mock model so it builds anywhere.
          ...(process.env.OPENAI_API_KEY ? {} : { embedding: 'mock' }),
          // The website's endpoint answers from the same docs, with its own key, rate limit and
          // budget, and allows this demo's origin. ASK_ENDPOINT, when it is set, wins: `ondocs
          // dev` locally.
          endpoint: 'https://ondocs.vercel.app/api/ask',
          // The same docs, served to agents by the website's MCP endpoint; ai-tools.mdx shows how
          // to connect to it.
          mcp: { url: 'https://ondocs.vercel.app/api/mcp', name: 'ondocs' },
          dialog: {
            // "Ask AI" in the header, after the search box, which leaves the floating button off.
            navbar: true,
            suggestions,
            // The website's citations carry its URLs: these send them to the same pages here.
            // An endpoint at ASK_ENDPOINT answers from this site's own index, at its own URLs.
            ...(process.env.ASK_ENDPOINT ? {} : { sourceUrls }),
          },
        }),
      ],
    }),
  ],
});
