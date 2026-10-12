import { getSections } from '../../lib/docs';
import { GITHUB_URL, MCP_URL, SITE_URL } from '../../lib/site';

export const dynamic = 'force-static';

/**
 * The docs as an llms.txt index (llmstxt.org): one link per page, to its Markdown copy, grouped
 * as in the sidebar. The copies and llms-full.txt are written into public/ by `pnpm index`
 * (ondocs index --llms-txt public); this file is curated here, in the sidebar's order.
 */
export async function GET() {
  const sections = await getSections();
  const lines = [
    '# ondocs',
    '',
    '> Make your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor. Agent traffic costs you no model tokens. Plugins for Docusaurus, Astro, Starlight and VitePress, React components for Next.js, and a script tag for any other site.',
    '',
    `Install with \`npm i ondocs\`. Source: ${GITHUB_URL}.`,
    '',
    'Each page links to its Markdown copy: its URL plus `.md`.',
    '',
    `Every page in one file: ${SITE_URL}/llms-full.txt`,
    '',
    `Agents can search these docs over MCP, with search, fetch and list_pages tools: ${MCP_URL}`,
    '',
    ...sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.docs.map(
        (doc) => `- [${doc.title}](${SITE_URL}/docs/${doc.slug}.md): ${doc.description}`,
      ),
      '',
    ]),
  ];
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
