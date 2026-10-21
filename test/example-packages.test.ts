// The examples are workspace packages named ondocs-example-<folder>, and the commands that pick
// a workspace package by name pick one that exists. pnpm runs nothing and exits 0 when a filter
// matches no package, so a stale name would turn a CI step or a script into a silent no-op.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const nameOf = (dir: string) =>
  (JSON.parse(read(join(dir, 'package.json'))) as { name: string }).name;
const folders = (dir: string) =>
  readdirSync(join(root, dir), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(root, dir, entry.name, 'package.json')),
    )
    .map((entry) => entry.name)
    .sort();

const examples = folders('examples');
const workspace = new Set(
  [
    '.',
    ...examples.map((name) => `examples/${name}`),
    ...folders('packages').map((name) => `packages/${name}`),
  ].map(nameOf),
);

describe('the example packages', () => {
  it('are named ondocs-example-<folder>', () => {
    expect(examples).toEqual(['docusaurus', 'nextjs', 'starlight', 'vitepress']);
    expect(examples.map((name) => nameOf(`examples/${name}`))).toEqual(
      examples.map((name) => `ondocs-example-${name}`),
    );
  });

  it('are the packages Changesets leaves out of releases', () => {
    const config = JSON.parse(read('.changeset/config.json')) as { ignore: string[] };
    expect([...config.ignore].sort()).toEqual(examples.map((name) => `ondocs-example-${name}`));
  });

  it('are filtered on by names that exist, in every script, workflow and guide', () => {
    const filtered = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((file) => /\.(?:json|ya?ml|mjs|js|ts|md)$/.test(file))
      .filter((file) => !file.endsWith('CHANGELOG.md') && existsSync(join(root, file)))
      .flatMap((file) =>
        read(file)
          .split('\n')
          .filter((line) => line.includes('pnpm'))
          .flatMap((line) => [...line.matchAll(/--filter[ =]['"]?([^\s'"]+)/g)].map((m) => m[1]!))
          // A path selector such as './packages/*', or a placeholder such as <example>.
          .filter((name) => !/^[.<]/.test(name))
          .map((name) => ({ file, name })),
      );
    expect(filtered.map(({ name }) => name)).toContain('ondocs-example-nextjs');
    expect(filtered.filter(({ name }) => !workspace.has(name))).toEqual([]);
  });

  it('leave the old name out of the contributor commands and guide', () => {
    for (const file of [
      'package.json',
      '.changeset/config.json',
      '.github/workflows/ci.yml',
      'scripts/mobile-width.mjs',
    ]) {
      expect(read(file), file).not.toContain('ask-my-site');
    }
    // CONTRIBUTING says once that ondocs was ask-my-site, next to the page on moving a site over.
    const old = read('CONTRIBUTING.md')
      .split('\n')
      .filter((line) => line.includes('ask-my-site'));
    expect(old).toHaveLength(1);
    expect(old[0]).toContain('(https://ondocs.vercel.app/docs/migrating)');
  });
});
