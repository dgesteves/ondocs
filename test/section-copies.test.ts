// A section served word for word at more than one URL: the same page in each version of
// versioned docs, or a page a site serves at two paths. Every copy scores the same on every
// question, so without collapsing them, one section fills the sources, and the copy whose URL
// sorts first, often an old version's, is cited first.
import { describe, expect, it } from 'vitest';

import { buildIndex, loadIndex, retrieve, type SourceDocument } from '../src';
import { MOCK_MIN_SIMILARITY, hashEmbedding, mockEmbeddingModel } from '../src/mock';
import { searchSections } from '../src/server/mcp-tools';

const DIMS = 256;

const deployment = `Build the site, then upload the build folder to any static host.

## Netlify

Connect the repository to Netlify, set the build command to npm run build and the publish directory to build.

## Vercel

Import the repository on Vercel, which detects the framework and its build command.`;

/** The deployment page in each version, as Docusaurus serves them, and one page of its own. */
const versions = ['3.8.1/', '3.9.2/', '', 'next/'];
const documents: SourceDocument[] = [
  ...versions.map((version) => ({
    id: `${version}deployment.md`,
    url: `/docs/${version}deployment`,
    title: 'Deployment',
    content: deployment,
  })),
  {
    id: 'netlify-functions.md',
    url: '/docs/netlify-functions',
    title: 'Netlify functions',
    content: 'Netlify runs the ask endpoint as a function next to the static site.',
  },
];

async function setup(docs: SourceDocument[], embedded: boolean) {
  const { index } = await buildIndex({
    documents: docs,
    ...(embedded ? { embeddingModel: mockEmbeddingModel({ dimensions: DIMS }) } : {}),
  });
  return loadIndex(index);
}

const query = (text: string, embedded: boolean) => ({
  text,
  vector: embedded ? hashEmbedding(text, DIMS) : null,
});

describe('copies of a section', () => {
  for (const embedded of [false, true]) {
    it(`count once, cited at the shortest URL (${embedded ? 'hybrid' : 'keyword-only'})`, async () => {
      const index = await setup(documents, embedded);
      const text = 'Which build command and publish directory does Netlify need?';
      const { hits } = retrieve(index, query(text, embedded), {
        minSimilarity: MOCK_MIN_SIMILARITY,
      });
      const urls = hits.map((hit) => hit.chunk.url);
      expect(urls[0]).toBe('/docs/deployment#netlify');
      // No other version's copy of any section.
      expect(urls.filter((url) => /^\/docs\/(next|3\.\d\.\d)\//.test(url))).toEqual([]);
      expect(new Set(hits.map((hit) => hit.chunk.text)).size).toBe(hits.length);
    });
  }

  it('leave the candidates to different sections', async () => {
    const index = await setup(documents, false);
    // Two candidates. Without collapsing, both were copies of the Netlify section.
    const { hits } = retrieve(index, { text: 'Netlify' }, { candidates: 2 });
    expect(hits.map((hit) => hit.chunk.url)).toEqual([
      '/docs/netlify-functions',
      '/docs/deployment#netlify',
    ]);
  });

  it('are all kept with collapseCopies: false, for a hook that picks a version itself', async () => {
    const index = await setup(documents, false);
    const { hits } = retrieve(index, { text: 'Netlify build command' }, { collapseCopies: false });
    expect(
      hits.filter((hit) => hit.chunk.heading === 'Netlify').map((hit) => hit.chunk.url),
    ).toEqual([
      '/docs/3.8.1/deployment#netlify',
      '/docs/3.9.2/deployment#netlify',
      '/docs/deployment#netlify',
      '/docs/next/deployment#netlify',
    ]);
  });

  it('are one result of the MCP search', async () => {
    const index = await setup(documents, false);
    const results = searchSections(index, 'Netlify build', null, {});
    expect(results.map((result) => result.id)).toEqual([
      '/docs/deployment#netlify',
      '/docs/netlify-functions',
    ]);
  });

  it('count once when a page is served at two paths', async () => {
    const page = (url: string): SourceDocument => ({
      id: url,
      url,
      title: 'AST spec',
      content: '## TSMappedType\n\nA mapped type, such as { [K in Keys]: Type }.',
    });
    const index = await setup(
      [page('/packages/ast-spec/generated/'), page('/packages/typescript-estree/ast-spec')],
      false,
    );
    const { hits } = retrieve(index, { text: 'TSMappedType mapped type' });
    // As many path segments: the shorter URL.
    expect(hits.map((hit) => hit.chunk.url)).toEqual([
      '/packages/ast-spec/generated/#tsmappedtype',
    ]);
  });

  it('are only sections with the same title, heading and text', async () => {
    // The same sentence under two headings, and on two pages: three sections, not copies.
    const index = await setup(
      [
        {
          id: 'a.md',
          url: '/docs/plugin-a',
          title: 'Plugin A',
          content:
            '## Options\n\nThis plugin takes no options.\n\n## Defaults\n\nThis plugin takes no options.',
        },
        {
          id: 'b.md',
          url: '/docs/plugin-b',
          title: 'Plugin B',
          content: '## Options\n\nThis plugin takes no options.',
        },
      ],
      false,
    );
    const { hits } = retrieve(index, { text: 'plugin options' });
    expect(hits.map((hit) => hit.chunk.url).sort()).toEqual([
      '/docs/plugin-a#defaults',
      '/docs/plugin-a#options',
      '/docs/plugin-b#options',
    ]);
  });
});
