// Long runs of slashes and whitespace. `/\/+$/`, `/^\/+|\/+$/g` and the Markdown lists' leading
// `\s*` started a match at each character of such a run that failed at its end: 14 to 31 s each at
// 100,000 characters. The same work is now linear, and returns what the expressions did. The MCP
// endpoint's `prefix` and `id`, and the ask endpoint's conversation and question, come from
// whoever calls them.
import { describe, expect, it } from 'vitest';

import { buildIndex, fromHtml, loadIndex, markdownPath, serializeIndexFile } from '../src';
import { excluder, launcherScript } from '../src/integration';
import { rootedPath } from '../src/llms';
import { mockLanguageModel } from '../src/mock';
import { createAskHandler, createMcpHandler, normalizeQuestion } from '../src/server';
import { withoutCitations } from '../src/server/follow-up';
import { fetchPage, listPages } from '../src/server/mcp-tools';
import { trimSlashes, trimTrailingSlashes } from '../src/text/slashes';
import { corpus, seeded } from './helpers';

/**
 * The budget for one input. The quadratic cases took seconds; a busy CI runner can take a few
 * hundred milliseconds on a linear one, so 1 s still tells them apart.
 */
const BUDGET_MS = 1000;

/** Runs `fn` three times and returns the fastest, in milliseconds, past a GC pause. */
function timed(fn: () => unknown): number {
  let fastest = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

/** {@link timed}, for a function that returns a Promise. */
async function timedAsync(fn: () => Promise<unknown>): Promise<number> {
  let fastest = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    await fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

const n = 100_000;
const slashes = `/a${'/'.repeat(n)}x`;
const index = loadIndex((await buildIndex({ documents: corpus, embeddingModel: null })).index);

/** Random strings of `parts`, with `values` first. */
function samples(seed: number, parts: readonly string[], values: string[]): string[] {
  const random = seeded(seed);
  for (let i = 0; i < 2000; i += 1) {
    let value = '';
    for (let j = Math.floor(random() * 8); j >= 0; j -= 1) {
      value += parts[Math.floor(random() * parts.length)] ?? '';
    }
    values.push(value);
  }
  return values;
}

describe('trimSlashes and trimTrailingSlashes', () => {
  it('trim exactly as the regular expressions did', () => {
    const random = seeded(11);
    const parts = ['/', '//', 'a', 'b/c', ' ', '#', '.', '\\'];
    const values = ['', '/', '///', 'a', '/a', 'a/', '//a//', '/a//b/', 'a/b', ' /a/ '];
    for (let i = 0; i < 2000; i += 1) {
      let value = '';
      for (let j = Math.floor(random() * 8); j >= 0; j -= 1) {
        value += parts[Math.floor(random() * parts.length)] ?? '';
      }
      values.push(value);
    }
    for (const value of values) {
      expect([value, trimTrailingSlashes(value)]).toEqual([value, value.replace(/\/+$/, '')]);
      expect([value, trimSlashes(value)]).toEqual([value, value.replace(/^\/+|\/+$/g, '')]);
    }
  });
});

describe('withoutCitations and normalizeQuestion', () => {
  it('give what the regular expressions they replace gave', () => {
    const citations = samples(
      12,
      [' ', '\n', '\t', 'a', '[1]', '[2, 13]', '[', ']', ',', '1', ' [1]', '[1 ,2]'],
      ['', '[1]', ' [1]', 'a [1].', 'a  [1, 2] b [3]', 'a [x] [1', '[1][2]  [3]'],
    );
    for (const value of citations) {
      expect([value, withoutCitations(value)]).toEqual([
        value,
        value.replace(/\s*\[\d{1,3}(?:\s*,\s*\d{1,3})*\]/g, ''),
      ]);
    }
    const questions = samples(
      13,
      [' ', '\n', 'a', 'B', '?', '!', '.', '。', '？', '！', ',', 'ｈ'],
      ['', '?', ' How? ', 'How do I install it?! ', 'ｈｏｗ？', 'a. b.', '。。a'],
    );
    for (const value of questions) {
      expect([value, normalizeQuestion(value)]).toEqual([
        value,
        value
          .normalize('NFKC')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[\s?!.。？！]+$/u, '')
          .trim(),
      ]);
    }
  });
});

describe('linear time on 100,000 slashes or spaces', () => {
  it.each([
    ['trimTrailingSlashes', () => trimTrailingSlashes(slashes)],
    ['trimSlashes', () => trimSlashes(slashes)],
    ['markdownPath, on a page URL', () => markdownPath(slashes)],
    ['markdownPath, on a base', () => markdownPath('/x', slashes)],
    ['rootedPath', () => rootedPath('x.md', slashes)],
    ['excluder', () => excluder([slashes])(slashes)],
    [
      'launcherScript, on a base',
      () => launcherScript({ endpoint: '/api/ask', locales: ['fr'], base: slashes }),
    ],
    ['list_pages, on a prefix', () => listPages(index, slashes, undefined)],
    ['fetch, on an id', () => fetchPage(index, slashes, undefined)],
    ['withoutCitations', () => withoutCitations(`a${' '.repeat(n)}x`)],
    ['normalizeQuestion', () => normalizeQuestion(`a${'?'.repeat(n)}x`)],
    [
      'the Markdown copy of a code block with a long run of blank lines',
      () =>
        fromHtml(`<main><pre><code>a${'\n'.repeat(n)}b</code></pre></main>`, {
          id: 'x',
          url: '/x',
          markdown: true,
        }),
    ],
    [
      'the Markdown copy of a page with a long run of spaces before a list',
      () =>
        fromHtml(`<main><p>a${' '.repeat(n)}x</p><ul><li>b</li></ul></main>`, {
          id: 'x',
          url: '/x',
          markdown: true,
        }),
    ],
  ])('%s', (_, run) => {
    expect(timed(run)).toBeLessThan(BUDGET_MS);
  });

  it('list_pages and fetch, through the MCP endpoint, on a run of slashes as long as a body holds', async () => {
    // The default body limit is 64 KiB. Past the 2,048 characters the tools' schema allows, the
    // endpoint refuses `prefix` and `id` before it reads them.
    const long = `/a${'/'.repeat(60_000)}x`;
    for (const [tool, args, key] of [
      ['list_pages', { prefix: long }, 'prefix'],
      ['fetch', { id: long }, 'id'],
    ] as const) {
      const handler = createMcpHandler({ index, onError: () => undefined });
      let text = '';
      const ms = await timedAsync(async () => {
        const response = await handler(
          new Request('https://docs.example.com/api/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: tool, arguments: args },
            }),
          }),
        );
        const body = (await response.json()) as { result?: { content: { text: string }[] } };
        text = body.result?.content[0]?.text ?? '';
      });
      expect(ms, tool).toBeLessThan(BUDGET_MS);
      expect(text).toBe(`${key} is limited to 2048 characters.`);
    }
  });

  it('a follow-up after an answer with a long run of whitespace, through the ask endpoint', async () => {
    // The rewrite takes the citations out of each earlier answer, before it cuts the answer short.
    const handler = createAskHandler({
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      rateLimit: false,
      onError: () => undefined,
    });
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'How do I install the package?' }] },
      { role: 'assistant', parts: [{ type: 'text', text: `a${' '.repeat(60_000)}x` }] },
      { role: 'user', parts: [{ type: 'text', text: 'And with pnpm?' }] },
    ];
    const ms = await timedAsync(async () => {
      const response = await handler(
        new Request('http://localhost/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages }),
        }),
      );
      expect(response.status).toBe(200);
      await response.text();
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('loadIndex, on copies of a chunk at a long URL', async () => {
    // The same title, heading and text at two URLs are copies: the one at fewer path segments is
    // cited.
    const { index } = await buildIndex({
      documents: [
        { id: 'a', url: slashes, title: 'Same', content: 'Same text.' },
        { id: 'b', url: '/b', title: 'Same', content: 'Same text.' },
      ],
      embeddingModel: null,
    });
    const text = serializeIndexFile(index);
    expect(timed(() => loadIndex(text))).toBeLessThan(BUDGET_MS);
  });
});
