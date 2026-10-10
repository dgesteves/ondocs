import { slugify } from 'ondocs';
import { withOndocs } from 'ondocs/vitepress';
import { defineConfig } from 'vitepress';

import { sidebar } from './sidebar';

export default withOndocs(
  defineConfig({
    title: 'ondocs',
    description: 'Make your docs answerable by people and by agents, from one static index.',
    // The pages are generated from the website's docs (scripts/sync-example-docs.mjs).
    srcDir: 'docs',
    cleanUrls: true,
    // Headings slugged as ondocs, Docusaurus and Starlight slug them, so the links between pages
    // land on the sections they name.
    markdown: { anchor: { slugify } },
    themeConfig: {
      sidebar,
      outline: [2, 3],
      socialLinks: [{ icon: 'github', link: 'https://github.com/dgesteves/ondocs' }],
    },
  }),
  {
    // With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this example
    // uses the offline mock model so it builds anywhere. The ask endpoint must use the same
    // model. The dialog posts to ASK_ENDPOINT when it is set, else to /api/ask.
    ...(process.env.OPENAI_API_KEY ? {} : { embedding: 'mock' }),
    // The same docs, served to agents by the website's MCP endpoint: llms.txt points at it.
    mcp: { url: 'https://ask-my-site-demo.vercel.app/api/mcp', name: 'ondocs' },
    dialog: {
      suggestions: ['How do I add it to VitePress?', 'Do I need a vector database?'],
    },
  },
);
