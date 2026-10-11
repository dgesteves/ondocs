import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import type { OndocsOptions } from 'ondocs/docusaurus';
import { themes as prismThemes } from 'prism-react-renderer';

// With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this example uses
// the offline mock model so it builds anywhere. The ask endpoint must use the same model. The
// dialog posts to ASK_ENDPOINT when it is set, else to /api/ask.
const ondocs: OndocsOptions = {
  ...(process.env.OPENAI_API_KEY ? {} : { embedding: 'mock' as const }),
  // The same docs, served to agents by the website's MCP endpoint; src/pages/ai-tools.mdx shows
  // how to connect to it.
  mcp: { url: 'https://ondocs.vercel.app/api/mcp', name: 'ondocs' },
  dialog: {
    suggestions: ['How do I add it to Docusaurus?', 'Do I need a vector database?'],
  },
};

const config: Config = {
  title: 'ondocs',
  tagline: 'An ask box for your docs: cited answers, no vector database.',
  favicon: 'img/favicon.ico',
  url: 'https://ask-my-site-docusaurus.vercel.app',
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

  plugins: [['ondocs/docusaurus', ondocs]],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'ondocs',
      items: [{ href: 'https://github.com/dgesteves/ondocs', label: 'GitHub', position: 'right' }],
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
  } satisfies Preset.ThemeConfig,
};

export default config;
