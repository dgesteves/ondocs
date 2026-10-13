import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import ondocsPlugin, { type OndocsOptions } from 'ondocs/docusaurus';
import { themes as prismThemes } from 'prism-react-renderer';

import { sourceUrls } from './source-urls';
import { suggestions } from './suggestions';

// The live demo's address, for llms.txt and the pages' own links.
const url = process.env.SITE_URL ?? 'https://ondocs-docusaurus.vercel.app';

// With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this example uses
// the offline mock model so it builds anywhere.
const ondocs: OndocsOptions = {
  ...(process.env.OPENAI_API_KEY ? {} : { embedding: 'mock' as const }),
  // The website's endpoint answers from the same docs, with its own key, rate limit and budget,
  // and allows this demo's origin. ASK_ENDPOINT, when it is set, wins: `ondocs dev` locally.
  endpoint: 'https://ondocs.vercel.app/api/ask',
  // The same docs, served to agents by the website's MCP endpoint; src/pages/ai-tools.mdx shows
  // how to connect to it.
  mcp: { url: 'https://ondocs.vercel.app/api/mcp', name: 'ondocs' },
  dialog: {
    // "Ask AI" in the navbar, which leaves the floating button off.
    navbar: true,
    suggestions,
    // The website's citations carry its URLs: these send them to the same pages here. An
    // endpoint at ASK_ENDPOINT answers from this site's own index, at its own URLs.
    ...(process.env.ASK_ENDPOINT ? {} : { sourceUrls }),
  },
};

const config: Config = {
  title: 'ondocs',
  tagline: 'An ask box for your docs: cited answers, no vector database.',
  favicon: 'img/favicon.ico',
  url,
  baseUrl: '/',
  onBrokenLinks: 'throw',
  // The pages are generated from the website's docs (scripts/sync-example-docs.mjs); a link or an
  // anchor the generator got wrong fails the build.
  onBrokenAnchors: 'throw',
  // Plain Markdown, as on the other two sites: no MDX, so text like `{ id, url }` stays text.
  markdown: { format: 'detect' },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  future: { v4: true, faster: true },

  presets: [
    [
      'classic',
      {
        docs: { routeBasePath: '/', sidebarPath: './sidebars.ts' },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  // The plugin, with its options, as a function rather than ['ondocs/docusaurus', ondocs]: the
  // same plugin, but Docusaurus copies a plugin's options from that form into every page's
  // JavaScript, and the plugin already sends the dialog what it needs. That saves the second copy
  // of the dialog's options, sourceUrls above all: about 0.5 KB gzipped on every page.
  plugins: [(context: Parameters<typeof ondocsPlugin>[0]) => ondocsPlugin(context, ondocs)],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    // Outside the article, so the index and the pages' Markdown copies leave it out. Its button
    // opens the dialog through its data-ondocs-open attribute.
    announcementBar: {
      id: 'live-demo',
      content:
        'Live demo of ondocs on Docusaurus. <button type="button" class="demo-try" data-ondocs-open>✦ Try it: ask these docs a question</button> <span class="demo-links"><a href="https://ondocs.vercel.app">ondocs.vercel.app</a> · <a href="https://github.com/dgesteves/ondocs">GitHub</a></span>',
      backgroundColor: 'var(--ifm-color-emphasis-100)',
      textColor: 'var(--ifm-font-color-base)',
      isCloseable: false,
    },
    navbar: {
      title: 'ondocs',
      items: [{ href: 'https://github.com/dgesteves/ondocs', label: 'GitHub', position: 'right' }],
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
  } satisfies Preset.ThemeConfig,
};

export default config;
