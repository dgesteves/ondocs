// The packages under the names people search for, docusaurus-plugin-ondocs and
// starlight-ondocs: each re-exports one entry of ondocs, at its version, with the peer
// dependencies that entry needs. CI builds a fresh site with each (scripts/consumer-site.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const manifest = (file: string) =>
  JSON.parse(read(file)) as {
    name: string;
    version: string;
    keywords: string[];
    exports: Record<string, unknown>;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    files: string[];
    homepage: string;
  };
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

  it('re-exports its entry of ondocs, default and named, in JavaScript and types', () => {
    for (const file of ['index.js', 'index.d.ts']) {
      const text = read(`${dir}/${file}`);
      expect(text).toContain(`export { default } from '${entry}';`);
      expect(text).toContain(`export * from '${entry}';`);
    }
    expect(pkg.files).toEqual(['index.js', 'index.d.ts']);
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

it('tells Docusaurus users the plugin’s full name, as the shorthand finds ondocs itself', () => {
  expect(read('packages/docusaurus-plugin-ondocs/README.md')).toContain(
    "plugins: ['docusaurus-plugin-ondocs']",
  );
});
