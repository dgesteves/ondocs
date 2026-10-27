import { slugify } from 'ondocs';
import { withOndocs } from 'ondocs/vitepress';
import { defineConfig } from 'vitepress';

import { sidebar } from './sidebar';
import { sourceUrls } from './source-urls';
import { suggestions } from './suggestions';

// The website's Turnstile widget's site key, which is public: with it, the dialog solves the bot
// check the website's endpoint asks for once its own keys are set (lib/ask-handler.ts there).
const turnstile = process.env.TURNSTILE_SITE_KEY;

/** The website's URL of each page here. */
const website = new Map(
  Object.entries(sourceUrls.pages).map(([there, here]) => [here, `${sourceUrls.base}${there}`]),
);

export default withOndocs(
  defineConfig({
    title: 'ondocs',
    description:
      'Open-source Ask AI for your docs: cited answers on your own model key, and an MCP server for agents, from one index built with your site. No vector database.',
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
    // Each page's canonical link goes to the website, whose docs these pages are generated from.
    transformPageData(pageData) {
      const here = `/${pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`;
      const canonical = website.get(here);
      if (canonical) {
        pageData.frontmatter.head ??= [];
        pageData.frontmatter.head.push(['link', { rel: 'canonical', href: canonical }]);
      }
    },
  }),
  {
    // With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this example
    // uses the offline mock model so it builds anywhere.
    ...(process.env.OPENAI_API_KEY ? {} : { embedding: 'mock' }),
    // The website's endpoint answers from the same docs, with its own key, rate limit and budget,
    // and allows this demo's origin. ASK_ENDPOINT, when it is set, wins: `ondocs dev` locally.
    endpoint: 'https://ondocs.vercel.app/api/ask',
    // The live demo's address, for llms.txt.
    siteUrl: process.env.SITE_URL ?? 'https://ondocs-vitepress.vercel.app',
    // The same docs, served to agents by the website's MCP endpoint: llms.txt points at it.
    mcp: { url: 'https://ondocs.vercel.app/api/mcp', name: 'ondocs' },
    dialog: {
      // "Ask AI" in the nav bar, after the search box, which leaves the floating button off.
      navbar: true,
      suggestions,
      // The website's citations carry its URLs: these send them to the same pages here. An
      // endpoint at ASK_ENDPOINT answers from this site's own index, at its own URLs, with no bot
      // check.
      ...(process.env.ASK_ENDPOINT
        ? {}
        : { sourceUrls, ...(turnstile ? { challenge: { turnstile } } : {}) }),
    },
  },
);
