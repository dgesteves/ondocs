import starlight from '@astrojs/starlight';
import ondocs from 'ondocs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
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
      plugins: [
        ondocs({
          // With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this
          // example uses the offline mock model so it builds anywhere. The ask endpoint must use
          // the same model. The dialog posts to ASK_ENDPOINT when it is set, else to /api/ask.
          ...(process.env.OPENAI_API_KEY ? {} : { embedding: 'mock' }),
          // The same docs, served to agents by the website's MCP endpoint; ai-tools.mdx shows how
          // to connect to it.
          mcp: { url: 'https://ondocs.vercel.app/api/mcp', name: 'ondocs' },
          dialog: {
            suggestions: ['How do I add it to Starlight?', 'Do I need a vector database?'],
          },
        }),
      ],
    }),
  ],
});
