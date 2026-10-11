import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const readme = path.join(root, 'README.md');

/**
 * What `npm pack` needs to run the README swap: the manifest with its prepack and postpack
 * scripts, the README, and the script. Packed from a copy, so the repository's README.md, which
 * other test files read at the same time, never changes while the tests run.
 */
const PACKED = ['package.json', 'README.md', 'LICENSE', 'scripts/npm-readme.mjs'];

describe('the README on npm', () => {
  it('keeps the demo video on GitHub and shows the hero image in the packed package', () => {
    const original = fs.readFileSync(readme, 'utf8');
    expect(original).toMatch(/^https:\/\/github\.com\/user-attachments\/assets\/[\da-f-]{36}$/m);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-readme-package-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-readme-'));
    // The repository's README as it is: a pack that swapped it would leave another file there.
    const stat = ({ ino, mtimeMs }: fs.Stats) => ({ ino, mtimeMs });
    const before = stat(fs.statSync(readme));
    try {
      for (const file of PACKED) {
        fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
        fs.copyFileSync(path.join(root, file), path.join(copy, file));
      }
      const packed = JSON.parse(
        execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
          cwd: copy,
          encoding: 'utf8',
        }),
      ) as { filename: string }[];
      const filename = packed[0]?.filename;
      expect(filename).toMatch(/^ondocs-\d+\.\d+\.\d+\.tgz$/);
      execFileSync('tar', [
        '-xzf',
        path.join(dir, String(filename)),
        '-C',
        dir,
        'package/README.md',
      ]);
      const npmReadme = fs.readFileSync(path.join(dir, 'package/README.md'), 'utf8');

      expect(npmReadme).not.toContain('github.com/user-attachments');
      expect(npmReadme).not.toContain('npm-readme:');
      expect(npmReadme).toContain('<img src=".github/assets/demo.webp"');
      expect(npmReadme).toContain('## What you get');
      // postpack put the GitHub version back.
      expect(fs.readFileSync(path.join(copy, 'README.md'), 'utf8')).toBe(original);
      expect(fs.existsSync(path.join(copy, '.npm-readme-backup.md'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(copy, { recursive: true, force: true });
    }
    expect(stat(fs.statSync(readme))).toEqual(before);
    expect(fs.readFileSync(readme, 'utf8')).toBe(original);
  });
});
