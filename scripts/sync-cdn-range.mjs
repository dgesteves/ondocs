// Moves the docs' jsDelivr pins to this package.json's version. A range such as ondocs@0.10
// follows the minor's patches, so each minor release moves the script tags in README.md, the
// website's landing page and examples/nextjs/content/docs, the migration's perl command, and the
// exact version the docs suggest pinning, as in the security guide's snippet with Subresource
// Integrity (whose hashes are placeholders, for each site to fill in for the version it pins).
// version-packages runs it after `changeset version`, so the release pull request moves them
// with the version it publishes, and test/package.test.ts passes on it.
//
//   pnpm build && node scripts/sync-cdn-range.mjs
//
// Then it runs scripts/sync-example-docs.mjs, which needs the built package, so the Docusaurus,
// Starlight and VitePress docs move with the website's.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const root = fileURLToPath(new URL('..', import.meta.url));
const DOCS = 'examples/nextjs/content/docs';

/**
 * The files with pins, relative to `dir`: the README, the landing page and every docs page.
 * @param {string} dir
 * @returns {string[]}
 */
export function pinnedFiles(dir) {
  const pages = readdirSync(join(dir, DOCS)).filter((file) => file.endsWith('.md'));
  return [
    'README.md',
    'examples/nextjs/app/(home)/page.tsx',
    ...pages.sort().map((file) => `${DOCS}/${file}`),
  ];
}

/**
 * `text` with each ondocs pin at `version`: a range such as `ondocs@0.10` at its minor, and an
 * exact version such as `ondocs@0.10.0` at the version itself.
 * @param {string} text
 * @param {string} version
 * @returns {string}
 */
export function moveCdnRange(text, version) {
  const minor = /^\d+\.\d+/.exec(version)?.[0];
  if (!minor) throw new Error(`${version} is not a version`);
  /** @type {(match: string, before: string, pin: string) => string} */
  const move = (_, before, pin) => `${before}${pin.split('.').length > 2 ? version : minor}`;
  const pin = String.raw`\d+\.\d+(?:\.\d+(?:-[\w.]+)?)?`;
  return (
    text
      // The script tags: https://cdn.jsdelivr.net/npm/ondocs@0.10/dist/embed.global.js
      .replace(new RegExp(String.raw`(cdn\.jsdelivr\.net/npm/ondocs@)(${pin})(?=/)`, 'g'), move)
      // The text about them: "comes out as `ondocs@0.10`", "such as `ondocs@0.10.0`".
      .replace(new RegExp(`(\`ondocs@)(${pin})(?=\`)`, 'g'), move)
      // The migration's perl command: s{…/ask-my-site(?:\@[\d.]+)?}{$1/ondocs\@0.10}g
      .replace(/(\/ondocs\\@)(\d+\.\d+)(?=\})/g, move)
  );
}

/**
 * Moves the pins under `dir` to the version in its package.json, and returns the files it
 * changed. They are formatted as this repository formats them: a version of another length
 * realigns the migration page's table.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function syncCdnRange(dir) {
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const config = (await resolveConfig(join(root, 'package.json'))) ?? {};
  const changed = [];
  for (const file of pinnedFiles(dir)) {
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const moved = moveCdnRange(text, version);
    if (moved === text) continue;
    writeFileSync(path, await format(moved, { ...config, filepath: path }));
    changed.push(file);
  }
  return changed;
}

// Run as a script (the real path, so a symlinked checkout still runs it), not imported by a test.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = await syncCdnRange(root);
  console.log(
    [`✓ Moved the jsDelivr pins in ${String(changed.length)} files.`, ...changed].join('\n  '),
  );
  execFileSync(process.execPath, [join(root, 'scripts/sync-example-docs.mjs')], {
    stdio: 'inherit',
  });
}
