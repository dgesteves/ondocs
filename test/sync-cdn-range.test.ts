// scripts/sync-cdn-range.mjs moves the docs' jsDelivr pins to package.json's version. The release
// pull request runs it after `changeset version` (test/release-workflow.test.ts), so its version
// and its docs agree, and test/package.test.ts passes on it without a commit by hand.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import { moveCdnRange, pinnedFiles, syncCdnRange } from '../scripts/sync-cdn-range.mjs';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const { version } = JSON.parse(read('package.json')) as { version: string };
const minorOf = (v: string) => /^\d+\.\d+/.exec(v)?.[0];
const ranges = (text: string) =>
  [...text.matchAll(/cdn\.jsdelivr\.net\/npm\/ondocs@([\d.]+)\/dist/g)].map((m) => m[1]);

/** The Docusaurus, Starlight and VitePress pages that scripts/sync-example-docs.mjs writes. */
const generated = [
  'examples/docusaurus/docs',
  'examples/starlight/src/content/docs',
  'examples/vitepress/docs',
].flatMap((dir) =>
  readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((file) => read(file).includes('# Generated from examples/nextjs/content/docs/')),
);

describe('the jsDelivr pins in the docs', () => {
  it('are at this version on all four sites, bot-challenge.md included', () => {
    const files = [...pinnedFiles(root), ...generated];
    for (const file of files) expect(moveCdnRange(read(file), version), file).toBe(read(file));
    const pinned = files.filter((file) => ranges(read(file)).length > 0);
    expect(pinned.filter((file) => file.endsWith('bot-challenge.md'))).toHaveLength(4);
  });

  it('leave other packages and major-only ranges alone', () => {
    const text = [
      'https://cdn.jsdelivr.net/npm/ask-my-site@0.6/dist/embed.global.js',
      'such as `ask-my-site@0.6.0`',
      'https://cdn.jsdelivr.net/npm/ondocs@0/dist/embed.global.js',
    ].join('\n');
    expect(moveCdnRange(text, '0.11.0')).toBe(text);
  });

  // The next minor, a patch of it, the next major, and a minor with one more digit, whose wider
  // pins the migration page's table has to be realigned for to pass `prettier --check`.
  const [major = 0, minor = 0] = version.split('.').map(Number);
  it.each([
    `${major}.${minor + 1}.0`,
    `${major}.${minor + 1}.2`,
    `${major + 1}.0.0`,
    `${major}.${(minor + 1) * 10}.0`,
  ])('move to %s when package.json does, and stay formatted', async (next) => {
    const dir = mkdtempSync(join(tmpdir(), 'ondocs-cdn-range-'));
    try {
      const manifest = JSON.parse(read('package.json')) as Record<string, unknown>;
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, version: next }));
      for (const file of pinnedFiles(root)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), read(file));
      }

      const changed = await syncCdnRange(dir);

      const moved = (file: string) => readFileSync(join(dir, file), 'utf8');
      expect(changed).toEqual(
        expect.arrayContaining([
          'README.md',
          'examples/nextjs/app/(home)/page.tsx',
          'examples/nextjs/content/docs/bot-challenge.md',
          'examples/nextjs/content/docs/migrating.md',
          'examples/nextjs/content/docs/script-tag.md',
        ]),
      );
      const config = (await resolveConfig(join(root, 'package.json'))) ?? {};
      for (const file of changed) {
        const text = moved(file);
        for (const range of ranges(text)) expect(range, file).toBe(minorOf(next));
        expect(text, file).toBe(await format(text, { ...config, filepath: join(dir, file) }));
      }
      // What test/package.test.ts checks on the release pull request.
      expect(ranges(moved('README.md'))).toEqual([minorOf(next)]);
      const migrating = moved('examples/nextjs/content/docs/migrating.md');
      expect(/\{\$1\/ondocs\\@([\d.]+)\}g/.exec(migrating)?.[1]).toBe(minorOf(next));
      expect(migrating).toContain(`comes out as \`ondocs@${String(minorOf(next))}\``);
      expect(migrating).toContain('https://cdn.jsdelivr.net/npm/ask-my-site@0.6/dist');
      expect(moved('examples/nextjs/content/docs/script-tag.md')).toContain(
        `Pin an exact version, such as \`ondocs@${next}\`, in production.`,
      );
      // Run again, it has nothing left to move.
      expect(await syncCdnRange(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
