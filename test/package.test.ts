import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type * as astro from '../src/astro';
import type * as docusaurus from '../src/docusaurus';
import type * as embed from '../src/embed';
import type * as starlight from '../src/starlight';

interface Manifest {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  repository?: { url?: string };
  homepage?: string;
  bugs?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  files?: string[];
  unpkg?: string;
  jsdelivr?: string;
}

const read = (path: string): Manifest =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', path), 'utf8')) as Manifest;
const manifest = read('package.json');

describe('package.json', () => {
  it('installs no React for server-only use', () => {
    // npm and pnpm install a dependency's required peers, so one React-only dependency is
    // enough to put React into a project that only mounts the handler.
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const dependency = read(`node_modules/${name}/package.json`);
      const required = Object.keys(dependency.peerDependencies ?? {}).filter(
        (peer) => !dependency.peerDependenciesMeta?.[peer]?.optional,
      );
      expect([name, required.filter((peer) => peer.startsWith('react'))]).toEqual([name, []]);
    }
  });

  it('declares what ondocs/react imports, and the plugins’ frameworks, as optional peers', () => {
    for (const name of [
      'react',
      'react-dom',
      '@radix-ui/react-dialog',
      'cmdk',
      '@docusaurus/core',
      'astro',
      '@astrojs/starlight',
      'vitepress',
    ]) {
      expect(manifest.peerDependencies?.[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
    }
  });

  it('is ondocs, with the ondocs command, from github.com/dgesteves/ondocs', () => {
    expect(manifest.name).toBe('ondocs');
    expect(manifest.bin).toEqual({ ondocs: 'dist/cli.js' });
    expect(manifest.repository?.url).toBe('git+https://github.com/dgesteves/ondocs.git');
    // npm's page links the website, where the docs are.
    expect(manifest.homepage).toBe('https://ondocs.vercel.app');
    expect(manifest.bugs).toBe('https://github.com/dgesteves/ondocs/issues');
  });

  it('makes the script embed what unpkg and jsDelivr serve for the bare package', () => {
    // https://cdn.jsdelivr.net/npm/ondocs@0 serves dist/embed.global.js.
    expect(manifest.unpkg).toBe('./dist/embed.global.js');
    expect(manifest.jsdelivr).toBe('./dist/embed.global.js');
    expect(manifest.files).toContain('dist');
  });

  it('points the script tag in the docs at the current minor version on jsDelivr', () => {
    // A range like ondocs@0.8 follows patches, so it moves with each minor release.
    const minor = /^(\d+\.\d+)\./.exec(manifest.version ?? '')?.[1];
    const files = [
      'README.md',
      'examples/nextjs/app/page.tsx',
      'examples/nextjs/content/docs/script-tag.md',
      'examples/nextjs/content/docs/migrating.md',
    ];
    for (const file of files) {
      const text = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
      const ranges = [...text.matchAll(/cdn\.jsdelivr\.net\/npm\/ondocs@([\d.]+)\/dist/g)].map(
        (m) => m[1],
      );
      expect(ranges.length, file).toBeGreaterThan(0);
      for (const range of ranges) expect(range, file).toBe(minor);
    }
    // The migration's perl command rewrites old script tags to the same range.
    const migrating = readFileSync(
      join(import.meta.dirname, '..', 'examples/nextjs/content/docs/migrating.md'),
      'utf8',
    );
    expect(/\{\$1\/ondocs\\@([\d.]+)\}g/.exec(migrating)?.[1]).toBe(minor);
  });

  it('keeps the types’ names from before ondocs, as deprecated aliases', () => {
    /* eslint-disable @typescript-eslint/no-deprecated */
    expectTypeOf<astro.AskMySiteOptions>().toEqualTypeOf<astro.OndocsOptions>();
    expectTypeOf<astro.AskMySiteDialogOptions>().toEqualTypeOf<astro.OndocsDialogOptions>();
    expectTypeOf<starlight.AskMySiteStarlightOptions>().toEqualTypeOf<starlight.OndocsStarlightOptions>();
    expectTypeOf<starlight.AskMySiteDialogOptions>().toEqualTypeOf<starlight.OndocsDialogOptions>();
    expectTypeOf<docusaurus.AskMySiteOptions>().toEqualTypeOf<docusaurus.OndocsOptions>();
    expectTypeOf<docusaurus.AskMySiteDialogOptions>().toEqualTypeOf<docusaurus.OndocsDialogOptions>();
    expectTypeOf<docusaurus.AskMySiteGlobalData>().toEqualTypeOf<docusaurus.OndocsGlobalData>();
    expectTypeOf<embed.AskMySiteDialogOptions>().toEqualTypeOf<embed.OndocsDialogOptions>();
    expectTypeOf<embed.AskMySiteTheme>().toEqualTypeOf<embed.OndocsTheme>();
    /* eslint-enable @typescript-eslint/no-deprecated */
  });
});
