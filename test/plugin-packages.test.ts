// The packages under the names people search for, docusaurus-plugin-ondocs and
// starlight-ondocs: each re-exports one entry of ondocs, at its version, with the peer
// dependencies that entry needs, and publishes to npm with it. CI builds a fresh site with each
// (scripts/consumer-site.mjs).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSlugger } from '../src/text/slug';

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
    // Docusaurus loads the plugin's theme and stylesheets by their paths inside ondocs, so a
    // project that only has this package builds; the endpoint and the CLI still need ondocs.
    wraps: false,
  },
  {
    dir: 'packages/starlight-ondocs',
    entry: 'ondocs/starlight',
    guide: 'astro',
    // The Astro integrations library finds packages by withastro or astro-integration, and files
    // them by keyword: utility is Utilities, ui is CSS + UI.
    keywords: ['starlight', 'starlight-plugin', 'withastro', 'astro-integration', 'utility', 'ui'],
    // The Astro integration adds `ondocs/...` modules to the pages, which the build resolves from
    // the project: the plugin checks it can, before Starlight sets up.
    wraps: true,
  },
];

describe.each(PACKAGES)('$dir', ({ dir, entry, guide, keywords, wraps }) => {
  const pkg = manifest(`${dir}/package.json`);

  it('re-exports its entry of ondocs, default and named, in JavaScript and types', () => {
    expect(Object.keys(main.exports)).toContain(entry.replace(/^ondocs\//, './'));
    const code = (file: string) =>
      read(`${dir}/${file}`)
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('//'));
    const reexport = [`export { default } from '${entry}';`, `export * from '${entry}';`];
    expect(code('index.d.ts')).toEqual(reexport);
    // starlight-ondocs wraps the default export, to check that the site has ondocs itself (see
    // the tests at the end), with the same signature.
    expect(code('index.js')).toEqual(
      wraps
        ? expect.arrayContaining([`import plugin from '${entry}';`, `export * from '${entry}';`])
        : reexport,
    );
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

  it('installs ondocs next to it in its README, as pnpm gives a project only its direct dependencies', () => {
    // The project needs ondocs itself: for the `ondocs` command, the endpoint's `ondocs/server`,
    // and with Starlight, the `ondocs/...` modules the plugin adds to the pages.
    const install = /^npm i .+$/m.exec(read(`${dir}/README.md`))?.[0].split(' ');
    expect(install).toEqual(expect.arrayContaining([pkg.name, 'ondocs']));
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

/** What `config:setup` did, from the script below: what it threw, or returned and passed on. */
interface Setup {
  name: string;
  error?: string;
  result?: unknown;
  calls?: [unknown, string][];
}

// Runs starlight-ondocs's `config:setup` as Starlight does, with the project's root, and reports
// what the stand-in ondocs/starlight's own hook was called with.
const SETUP = `
const { default: ondocs, calls } = await import(process.argv[1]);
const plugin = ondocs({ embedding: 'mock' });
let outcome;
try {
  const result = plugin.hooks['config:setup']({ astroConfig: { root: new URL(process.argv[2]) } });
  outcome = { result, calls: calls.map(([options, params]) => [options, String(params.astroConfig.root)]) };
} catch (error) {
  outcome = { error: error.message };
}
console.log(JSON.stringify({ name: plugin.name, ...outcome }));
`;

/**
 * starlight-ondocs as pnpm installs it, in a temporary project, and its `config:setup` run there
 * in Node with the NODE_PATH pnpm's `astro` command sets. The package is in pnpm's store, with the
 * ondocs it depends on next to it, a stand-in whose plugin records its calls. pnpm also hoists
 * that ondocs to `.pnpm/node_modules`, on NODE_PATH, where Node finds it and Vite does not. The
 * project's own node_modules has ondocs only when it was installed there too.
 */
function setUpAsPnpmInstallsIt(project: string, installed: boolean): Setup {
  const store = join(project, 'node_modules/.pnpm');
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(store, file)), { recursive: true });
    writeFileSync(join(store, file), text);
  };
  const ondocs = join(store, 'ondocs@1.0.0/node_modules/ondocs');
  write(
    'ondocs@1.0.0/node_modules/ondocs/package.json',
    JSON.stringify({
      name: 'ondocs',
      type: 'module',
      exports: { './starlight': './starlight.js', './package.json': './package.json' },
    }),
  );
  write(
    'ondocs@1.0.0/node_modules/ondocs/starlight.js',
    `export const calls = [];
export default (options) => ({
  name: 'ondocs',
  hooks: { 'config:setup': (params) => { calls.push([options, params]); return 'set up'; } },
});`,
  );
  const wrapper = join(store, 'starlight-ondocs@1.0.0/node_modules/starlight-ondocs');
  write(
    'starlight-ondocs@1.0.0/node_modules/starlight-ondocs/index.js',
    read('packages/starlight-ondocs/index.js'),
  );
  write(
    'starlight-ondocs@1.0.0/node_modules/starlight-ondocs/package.json',
    read('packages/starlight-ondocs/package.json'),
  );
  const link = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(ondocs, path, 'junction');
  };
  link(join(store, 'starlight-ondocs@1.0.0/node_modules/ondocs'));
  link(join(store, 'node_modules/ondocs'));
  if (installed) link(join(project, 'node_modules/ondocs'));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'site', private: true }));
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      SETUP,
      pathToFileURL(join(wrapper, 'index.js')).href,
      pathToFileURL(`${project}/`).href,
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_PATH: join(store, 'node_modules') } },
  );
  return JSON.parse(out) as Setup;
}

describe('starlight-ondocs in a project pnpm installed', () => {
  let project = '';
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'ondocs-starlight-pnpm-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('stops before Starlight sets up without ondocs, and says to install it at its version', () => {
    expect(setUpAsPnpmInstallsIt(project, false)).toEqual({
      name: 'ondocs',
      error:
        `starlight-ondocs: install ondocs next to it, at the same version: pnpm add ondocs@${main.version} ` +
        '(or npm i, yarn add, bun add). The plugin adds ondocs/... modules to your pages, and the ' +
        `build resolves them from your project, ${project}/, where ondocs is not installed: pnpm ` +
        'gives a project only its direct dependencies. See ' +
        'https://ondocs.vercel.app/docs/troubleshooting#ondocs-command-not-found',
    });
  });

  it('sets up as ondocs/starlight does with ondocs installed next to it', () => {
    expect(setUpAsPnpmInstallsIt(project, true)).toEqual({
      name: 'ondocs',
      result: 'set up',
      calls: [[{ embedding: 'mock' }, pathToFileURL(`${project}/`).href]],
    });
  });

  it('links the Troubleshooting page’s section on it', () => {
    const slug = createSlugger();
    const headings = [
      ...read('examples/nextjs/content/docs/troubleshooting.md').matchAll(/^#{2,6} (.+)$/gm),
    ].map(([, heading]) => slug(heading!));
    expect(headings).toContain('ondocs-command-not-found');
  });
});
