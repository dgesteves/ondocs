// The packages under the names people search for, docusaurus-plugin-ondocs and
// starlight-ondocs: each re-exports one entry of ondocs, at its version, with the peer
// dependencies that entry needs, and publishes to npm with it. CI builds a fresh site with each
// (scripts/consumer-site.mjs).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface Manifest {
  name: string;
  version: string;
  keywords: string[];
  exports: Record<string, unknown>;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  files: string[];
  homepage: string;
  bugs: string;
  license: string;
  author: string;
  repository: { type: string; url: string; directory?: string };
  publishConfig?: Record<string, unknown>;
  scripts: Record<string, string>;
}

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const manifest = (file: string) => JSON.parse(read(file)) as Manifest;
const main = manifest('package.json');

const PACKAGES = [
  {
    dir: 'packages/docusaurus-plugin-ondocs',
    entry: 'ondocs/docusaurus',
    guide: 'docusaurus',
    keywords: ['docusaurus', 'docusaurus-plugin', 'ask-ai'],
  },
  {
    dir: 'packages/starlight-ondocs',
    entry: 'ondocs/starlight',
    guide: 'astro',
    // The Astro integrations library finds packages by withastro or astro-integration, and files
    // them by keyword: utility is Utilities, ui is CSS + UI.
    keywords: ['starlight', 'starlight-plugin', 'withastro', 'astro-integration', 'utility', 'ui'],
  },
];

describe.each(PACKAGES)('$dir', ({ dir, entry, guide, keywords }) => {
  const pkg = manifest(`${dir}/package.json`);

  it('re-exports its entry of ondocs, default and named, in JavaScript and types, and nothing else', () => {
    expect(Object.keys(main.exports)).toContain(entry.replace(/^ondocs\//, './'));
    for (const file of ['index.js', 'index.d.ts']) {
      const code = read(`${dir}/${file}`)
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('//'));
      expect(code).toEqual([`export { default } from '${entry}';`, `export * from '${entry}';`]);
    }
    expect(pkg.exports).toEqual({
      '.': { types: './index.d.ts', default: './index.js' },
      './package.json': './package.json',
    });
    expect(pkg.files).toEqual(['index.js', 'index.d.ts']);
  });

  it('publishes to npm as ondocs does: public, with provenance, from this repository', () => {
    // A private package is one changeset publish skips, so it never reaches npm.
    expect(pkg).not.toHaveProperty('private');
    expect(pkg.publishConfig).toEqual(main.publishConfig);
    expect(pkg.repository).toEqual({ ...main.repository, directory: dir });
    expect([pkg.license, pkg.author, pkg.bugs]).toEqual([main.license, main.author, main.bugs]);
  });

  it('packs its entry, README and the license, and depends on ondocs at its exact version', () => {
    // changeset publish runs pnpm publish, which packs like this: workspace:* becomes ondocs's
    // version, and the repository's LICENSE comes along, as the package has none of its own.
    const out = mkdtempSync(join(tmpdir(), 'ondocs-plugin-package-'));
    try {
      const packed = JSON.parse(
        execFileSync('pnpm', ['pack', '--json', '--pack-destination', out], {
          cwd: join(root, dir),
          encoding: 'utf8',
        }),
      ) as { filename: string; files: { path: string }[] };
      expect(packed.files.map((file) => file.path).sort()).toEqual([
        'LICENSE',
        'README.md',
        'index.d.ts',
        'index.js',
        'package.json',
      ]);
      const published = JSON.parse(
        execFileSync('tar', ['-xzOf', packed.filename, 'package/package.json'], {
          encoding: 'utf8',
        }),
      ) as Manifest;
      expect(published.version).toBe(main.version);
      expect(published.dependencies).toEqual({ ondocs: main.version });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('is at ondocs’s version, and depends on that exact version', () => {
    expect(pkg.version).toBe(main.version);
    expect(pkg.dependencies).toEqual({ ondocs: 'workspace:*' });
    const fixed = (JSON.parse(read('.changeset/config.json')) as { fixed: string[][] }).fixed;
    expect(fixed).toContainEqual(expect.arrayContaining(['ondocs', pkg.name]));
  });

  it('asks for the peers its entry needs, with ondocs’s ranges', () => {
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      expect([name, range]).toEqual([name, main.peerDependencies[name]]);
    }
    expect(Object.keys(pkg.peerDependencies)).toEqual(
      expect.arrayContaining(['react', 'react-dom', '@radix-ui/react-dialog', 'cmdk', 'ai']),
    );
  });

  it('has the keywords people search for', () => {
    expect(pkg.keywords).toEqual(expect.arrayContaining(keywords));
  });

  it('links its guide on the website from npm', () => {
    expect(pkg.homepage).toBe(`https://ondocs.vercel.app/docs/${guide}`);
  });
});

it('checks the packages with publint and attw, as it checks ondocs, before they publish', () => {
  expect(main.scripts['check:package']).toContain(
    "pnpm --filter './packages/*' exec publint --strict",
  );
  expect(main.scripts['check:package']).toContain(
    "pnpm --filter './packages/*' exec attw --pack . --profile esm-only",
  );
});

it('tells Docusaurus users the plugin’s full name, as the shorthand finds ondocs itself', () => {
  expect(read('packages/docusaurus-plugin-ondocs/README.md')).toContain(
    "plugins: ['docusaurus-plugin-ondocs']",
  );
});
