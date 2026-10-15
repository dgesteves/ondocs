import { describe, expect, it } from 'vitest';

import { buildIndex, chunkDocument, fromMarkdown, loadIndex, type SourceDocument } from '../src';
import {
  findPage,
  indexPages,
  pageMarkdown,
  pageSections,
  sectionChunks,
  sectionMarkdown,
  snippet,
} from '../src/search/pages';
import { corpus, seeded } from './helpers';

async function loaded(
  documents: SourceDocument[],
  chunking?: { maxChars: number; overlap: number },
) {
  const { index } = await buildIndex({ documents, ...(chunking ? { chunking } : {}) });
  return loadIndex(index);
}

/** A page with long paragraphs, lists and code, so its sections split into overlapping chunks. */
function longPage(seed: number): SourceDocument {
  const random = seeded(seed);
  const word = () =>
    ['alpha', 'beta', 'gamma', 'delta', 'index', 'chunk', 'vector'][Math.floor(random() * 7)];
  const sentence = () =>
    `${Array.from({ length: 6 + Math.floor(random() * 14) }, word).join(' ')}.`;
  const paragraph = () => Array.from({ length: 2 + Math.floor(random() * 6) }, sentence).join(' ');
  const sections = Array.from({ length: 4 }, (_, i) => {
    const code = `\`\`\`ts\n${Array.from({ length: 30 }, (_, line) => `const v${String(line)} = ${String(line)};`).join('\n')}\n\`\`\``;
    const list = Array.from({ length: 12 }, sentence)
      .map((item) => `- ${item}`)
      .join('\n');
    return `## Part ${String(i)}\n\n${paragraph()}\n\n${paragraph()}\n\n${i % 2 ? code : list}\n\n### Detail ${String(i)}\n\n${paragraph()}`;
  });
  const page = fromMarkdown(`# Long page\n\n${paragraph()}\n\n${sections.join('\n\n')}`, {
    id: `long-${String(seed)}.md`,
    url: `/docs/long-${String(seed)}`,
  });
  if (!page) throw new Error('fromMarkdown skipped the page');
  return page;
}

describe('pages read back from an index', () => {
  it('lists the pages with content, in document order', async () => {
    const index = await loaded(corpus);
    expect(indexPages(index).map((page) => page.url)).toEqual([
      '/docs/install',
      '/pricing',
      '/docs/quantization',
      '/docs/rate-limits',
    ]);
  });

  it('rebuilds a page as Markdown that chunks back into the same chunks', async () => {
    const chunking = { maxChars: 400, overlap: 120 };
    const documents = [1, 2, 3, 4, 5].map(longPage);
    const index = await loaded(documents, chunking);
    for (const page of indexPages(index)) {
      const markdown = pageMarkdown(page, chunking.overlap);
      const again = chunkDocument(
        { id: page.id, url: page.url, title: page.title, content: markdown },
        chunking,
      );
      expect(again.map((chunk) => [chunk.heading, chunk.text])).toEqual(
        page.chunks.map((chunk) => [chunk.heading, chunk.text]),
      );
      // Nothing is repeated: the overlap is gone.
      const original = documents.find((document) => document.id === page.id)?.content ?? '';
      expect(markdown.length).toBeLessThan(original.length + 200);
    }
  });

  it('writes each section under its heading path', async () => {
    const index = await loaded(corpus);
    const page = indexPages(index).find((candidate) => candidate.url === '/docs/rate-limits');
    if (!page) throw new Error('missing page');
    expect(pageMarkdown(page, 150)).toBe(
      [
        '# Rate limiting',
        'The handler accepts a rateLimit hook.',
        '## Upstash',
        'Pass upstashRateLimit with a configured Ratelimit instance for a limit shared across regions.',
        '## In memory',
        'memoryRateLimit keeps a token bucket per client IP inside one process.',
      ].join('\n\n'),
    );
    const section = sectionChunks(page, '/docs/rate-limits#upstash');
    expect(sectionMarkdown(page, section, 150)).toBe(
      '# Rate limiting\n\n## Upstash\n\nPass upstashRateLimit with a configured Ratelimit instance for a limit shared across regions.',
    );
    expect(pageSections(page)).toEqual([
      { url: '/docs/rate-limits#upstash', heading: 'Upstash' },
      { url: '/docs/rate-limits#in-memory', heading: 'In memory' },
    ]);
  });

  it('finds a page by URL, with an origin, a trailing slash, a .md ending or an anchor', async () => {
    const index = await loaded(corpus);
    const url = (reference: string) => {
      const found = findPage(index, reference);
      return found && [found.page.url, found.section];
    };
    expect(url('/docs/install')).toEqual(['/docs/install', null]);
    expect(url('/docs/install/')).toEqual(['/docs/install', null]);
    expect(url('/docs/install.md')).toEqual(['/docs/install', null]);
    expect(url('docs/install')).toEqual(['/docs/install', null]);
    expect(url('https://docs.example.com/docs/install#requirements')).toEqual([
      '/docs/install',
      '/docs/install#requirements',
    ]);
    expect(url('install.md')).toEqual(['/docs/install', null]);
    expect(url('install.md#1')).toEqual(['/docs/install', '/docs/install#requirements']);
    expect(url('/docs/missing')).toBeNull();
    expect(url('')).toBeNull();
    expect(url('https://')).toBeNull();
  });

  it('finds a section whose anchor is not ASCII, as written or percent-encoded', async () => {
    const page = fromMarkdown(
      '# Início\n\nIntro.\n\n## Configuração rápida\n\nRode o init.\n\n## 日本語の見出し\n\n本文です。',
      { id: 'i18n.md', url: '/docs/i18n' },
    );
    if (!page) throw new Error('fromMarkdown skipped the page');
    const index = await loaded([page]);
    const [i18n] = indexPages(index);
    if (!i18n) throw new Error('missing page');
    const sections = pageSections(i18n).map(({ url }) => url);
    expect(sections).toEqual(['/docs/i18n#configuração-rápida', '/docs/i18n#日本語の見出し']);
    for (const section of sections) {
      // What search returns: the section made absolute, which percent-encodes the anchor.
      const absolute = new URL(section, 'https://docs.example.com').href;
      const relative = absolute.slice('https://docs.example.com'.length);
      expect(absolute).not.toContain(section);
      for (const reference of [section, absolute, relative]) {
        expect([reference, findPage(index, reference)?.section]).toEqual([reference, section]);
      }
    }
    // An anchor that is not valid percent-encoding is kept as it is.
    expect(findPage(index, '/docs/i18n#100%')?.section).toBe('/docs/i18n#100%');
  });
});

describe('snippet', () => {
  it('picks the sentences with the most query words', () => {
    const text =
      'Install it first. Then configure the sidebar. The autogenerated sidebar reads a folder and builds its items. Deploy last.';
    expect(snippet(text, 'autogenerated sidebar folder', 80)).toBe(
      '…The autogenerated sidebar reads a folder and builds its items. Deploy last.',
    );
  });

  it('starts at the top without a match, and cuts a long sentence at a word', () => {
    const text = `${'word '.repeat(100)}end.`;
    const result = snippet(text, 'nothing', 40);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(snippet('', 'x')).toBe('');
  });
});
