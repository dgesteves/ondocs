// Long runs of slashes and whitespace. `/\/+$/`, `/^\/+|\/+$/g` and the Markdown lists' leading
// `\s*` started a match at each character of such a run that failed at its end: 14 to 31 s each at
// 100,000 characters. The same work is now linear, and returns what the expressions did.
import { describe, expect, it } from 'vitest';

import { buildIndex, fromHtml, loadIndex, markdownPath, serializeIndexFile } from '../src';
import { excluder, launcherScript } from '../src/integration';
import { rootedPath } from '../src/llms';
import { trimSlashes, trimTrailingSlashes } from '../src/text/slashes';
import { seeded } from './helpers';

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

const n = 100_000;
const slashes = `/a${'/'.repeat(n)}x`;

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
