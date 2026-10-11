import pkg from 'ondocs/package.json';

export const SITE_URL = 'https://ondocs.vercel.app';
/** The docs as an MCP server for agents: app/api/mcp/route.ts. */
export const MCP_URL = `${SITE_URL}/api/mcp`;
export const GITHUB_URL = 'https://github.com/dgesteves/ondocs';
export const NPM_URL = 'https://www.npmjs.com/package/ondocs';
export const VERSION: string = pkg.version;
export const INSTALL = 'npm i ondocs';

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
