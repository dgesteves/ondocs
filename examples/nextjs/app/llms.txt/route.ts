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
    '> Open-source Ask AI for your docs. Cited answers on your own model key, and an MCP server for coding agents, from one index built with your Starlight, Docusaurus or VitePress site. No vendor, no vector database. Agents bring their own model, and keyword search, the default, calls no model at all. Plugins for Starlight, Docusaurus, VitePress and Astro, React components for Next.js, and a script tag for any other site.',
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
