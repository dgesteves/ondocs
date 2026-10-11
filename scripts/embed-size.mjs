// The script embed's two files, gzipped: each against its budget, and the launcher's size as the
// docs quote it, so a change to the embed cannot leave the docs saying an old size. CI runs it
// after the build. Sizes are gzip -9, in KB of 1,024 bytes, as scripts/js-weight.mjs counts them.
//
//   pnpm build && node scripts/embed-size.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(new URL(file, `file://${root}`));

/** Each file and its budget in KB: the launcher every page loads, and the dialog it loads later. */
const BUDGETS = { 'dist/embed.global.js': 4, 'dist/embed-dialog.global.js': 110 };

const bytes = (file) => gzipSync(read(file), { level: 9 }).length;
const kb = (file) => +(bytes(file) / 1024).toFixed(1);
const problems = [];
for (const [file, budget] of Object.entries(BUDGETS)) {
  console.log(`${file}: ${String(kb(file))} KB gzipped, budget ${String(budget)}`);
  if (bytes(file) > budget * 1024) problems.push(`${file} is over its ${String(budget)} KB budget`);
}

// Where the docs quote the launcher's size. The website's landing page measures it as it builds.
const launcher = `${String(kb('dist/embed.global.js'))} KB`;
const QUOTED = [
  ['examples/nextjs/content/docs/script-tag.md', `\`embed.global.js\`, is ${launcher} gzipped`],
  ['examples/nextjs/content/docs/benchmarks.md', `| Script tag on a plain page |`, launcher],
];
for (const [file, needle, value = ''] of QUOTED) {
  const line = read(file)
    .toString()
    .split('\n')
    .find((text) => text.includes(needle));
  if (!line || !line.includes(value)) {
    problems.push(
      `${file} does not give the launcher's size as ${launcher}: ${line?.trim() ?? 'no such line'}`,
    );
  }
}
if (problems.length > 0) {
  console.error(`✗ ${problems.join('\n✗ ')}`);
  process.exit(1);
}
console.log(`✓ The docs give the launcher's size, ${launcher} gzipped.`);
