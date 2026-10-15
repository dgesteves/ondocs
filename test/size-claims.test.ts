// The sizes the docs quote, against each other. scripts/js-weight.mjs measures the benchmarks
// page's table in headless Chrome, and scripts/embed-size.mjs checks the launcher's size against
// the build; the pages that repeat a figure from the table must say what the table says, so a new
// measurement cannot leave one of them behind, as react-dialog 1.2.0's did the script tag page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (page: string) =>
  readFileSync(join(import.meta.dirname, '..', 'examples/nextjs/content/docs', page), 'utf8');

/** A row of the benchmarks page's bundle size table, in KB gzipped. */
const row = (site: string) => {
  const line = read('benchmarks.md')
    .split('\n')
    .find((text) => text.startsWith(`| ${site}`));
  const [own = NaN, withOndocs = NaN, onOpen = NaN] = (line ?? '')
    .split('|')
    .slice(2, 5)
    .map((cell) => Number(/[\d.]+/.exec(cell)?.[0]));
  return { own, withOndocs, onOpen };
};

describe('the sizes the docs quote', () => {
  it('give the script tag’s dialog file the size the benchmarks table measures', () => {
    const quoted = /`embed-dialog\.global\.js` \((\d+) KB gzipped\)/.exec(read('script-tag.md'));
    expect(Number(quoted?.[1])).toBe(Math.round(row('Script tag on a plain page').onOpen));
  });

  it('give what each plugin adds to a page as the benchmarks table measures it', () => {
    const page = read('ask-dialog.md');
    for (const site of ['Docusaurus', 'Starlight']) {
      const { own, withOndocs } = row(site);
      const quoted = new RegExp(`to ([\\d.]+) KB with ${site}`).exec(page)?.[1];
      expect([site, Number(quoted)]).toEqual([site, +(withOndocs - own).toFixed(1)]);
    }
  });
});
