// Sizes the landing page quotes, measured from the ondocs package as the site builds, or read from
// the benchmarks page, so they always match what it ships and what the docs say. Server only: it
// reads the package's files and the docs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * A file of the package's build, gzipped at level 9, in KB of 1,024 bytes, as
 * scripts/js-weight.mjs and the docs count them: `embed.global.js` → "2.7 KB".
 */
export function gzippedSize(file: string): string {
  const path = join(process.cwd(), 'node_modules', 'ondocs', 'dist', file);
  const bytes = gzipSync(readFileSync(path), { level: 9 }).length;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * The most JavaScript ondocs adds to a page before the dialog opens, gzipped, from the bundle
 * size table on the benchmarks page, which scripts/js-weight.mjs measures in headless Chrome:
 * each row's "With ondocs" less "The site on its own", and the largest of those, as "N.N KB".
 * Throws when the table is gone, so the claim can't outlive its source.
 */
export function largestPageAddition(): string {
  const page = readFileSync(join(process.cwd(), 'content', 'docs', 'benchmarks.md'), 'utf8');
  const table = page.split('## Bundle size')[1]?.split('\n## ')[0] ?? '';
  const added = table
    .split('\n')
    // The rows: not the header, nor the line of dashes under it.
    .filter((line) => /^\|\s*[^\s-]/.test(line) && !line.includes('With ondocs'))
    .map((line) => {
      const [own = NaN, withOndocs = NaN] = line
        .split('|')
        .slice(2, 4)
        .map((cell) => Number(/[\d.]+/.exec(cell)?.[0]));
      return withOndocs - own;
    });
  if (added.length === 0 || added.some((kb) => Number.isNaN(kb))) {
    throw new Error(
      'The benchmarks page has no bundle size table to quote: restore its "## Bundle size" table in content/docs/benchmarks.md, or change the landing’s proof row.',
    );
  }
  return `${Math.max(...added).toFixed(1)} KB`;
}
