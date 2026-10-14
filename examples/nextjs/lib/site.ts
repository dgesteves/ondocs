export const SITE_URL = 'https://ondocs.vercel.app';
/** The docs as an MCP server for agents: app/api/mcp/route.ts. */
export const MCP_URL = `${SITE_URL}/api/mcp`;
export const GITHUB_REPO = 'dgesteves/ondocs';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
/** A docs page's source on GitHub, open for editing. */
export const editUrl = (slug: string): string =>
  `${GITHUB_URL}/edit/main/examples/nextjs/content/docs/${slug}.md`;
export const NPM_URL = 'https://www.npmjs.com/package/ondocs';
export const INSTALL = 'npm i ondocs';
export const HOME_TITLE = 'ondocs: open-source Ask AI and an MCP server for your docs';
/** The home page's description: search results show about 160 characters. */
export const HOME_DESCRIPTION =
  'Open-source Ask AI for your docs: cited answers on your own model key, and an MCP server for agents, from one index built with your site. No vector database.';
/**
 * The example sites in examples/, deployed: these docs on real Starlight, Docusaurus and VitePress
 * sites, with each plugin's dialog asking this site's endpoint. Starlight first, as the home page
 * leads with it.
 */
export const DEMOS = [
  { label: 'Starlight', href: 'https://ondocs-starlight.vercel.app' },
  { label: 'Docusaurus', href: 'https://ondocs-docusaurus.vercel.app' },
  { label: 'VitePress', href: 'https://ondocs-vitepress.vercel.app' },
] as const;
/** A framework's live demo, by its name in `DEMOS`. */
export const demoUrl = (label: (typeof DEMOS)[number]['label']): string =>
  DEMOS.find((demo) => demo.label === label)?.href ?? '';
/** The docs home's description, in its metadata and on its share card. */
export const DOCS_DESCRIPTION =
  'Set up ondocs with Docusaurus, Astro, Starlight, VitePress, Next.js or a script tag, deploy the endpoint, serve the same index to agents over MCP and llms.txt, and tune retrieval.';

/**
 * Questions offered in the dialog and on the home page. Each one is checked against the mock
 * model: it must get a correct answer with citations that land on a real section.
 */
export const SUGGESTIONS = [
  'How do I add it to Docusaurus?',
  'Can I use Anthropic models?',
  'Do I need a vector database?',
  'How much does it cost to run?',
  'How do I deploy to Netlify?',
];
