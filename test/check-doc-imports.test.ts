// scripts/check-doc-imports.mjs: every `ondocs/...` import the docs show resolves in a package. The
// docs deploy from main, and twice they described modules and names that npm's latest didn't have
// yet: on 0.10.0, `import 'ondocs/embed/button.css'` failed the build, and `openAskDialog` was not
// in `ondocs/embed`. The release workflow runs it on what it publishes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { checkImports, docFiles, findImports } from '../scripts/check-doc-imports.mjs';

const root = join(import.meta.dirname, '..');

/** A package directory with these files, under a new temporary directory. */
function packageWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-imports-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  made.push(dir);
  return dir;
}
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

// ondocs 0.10.0's exports for the embed, as npm has them.
const ondocs010 = packageWith({
  'package.json': JSON.stringify({
    name: 'ondocs',
    version: '0.10.0',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './embed': { types: './dist/embed.d.ts', default: './dist/embed.js' },
      './embed/launcher.css': './dist/embed/launcher.css',
      './astro': { types: './dist/astro.d.ts', default: './dist/astro.js' },
    },
  }),
  'dist/index.d.ts': 'export declare function buildIndex(): void;\n',
  'dist/index.js': '',
  'dist/embed.d.ts': [
    'import { t as Options } from "./options-x.js";',
    'export declare function mountAskDialog(options?: Options): void;',
    'export type { Options as MountAskDialogOptions };',
    '',
  ].join('\n'),
  'dist/embed.js': '',
  'dist/embed/launcher.css': '',
  'dist/astro.d.ts': 'export default function ondocs(): unknown;\n',
  'dist/astro.js': '',
});

describe('the imports the docs show', () => {
  it('are found in quotes, backticks and import statements, with their names', () => {
    const page = [
      "import { mountAskDialog, openAskDialog } from 'ondocs/embed';",
      'import ondocs from "ondocs/astro";',
      "import type { MountAskDialogOptions } from 'ondocs/embed';",
      'For its look, import `ondocs/embed/button.css`.',
      "plugins: [['ondocs/docusaurus', {}]]",
      'Any module, `ondocs/...`, and the `ondocs` CLI.',
      'https://github.com/dgesteves/ondocs/tree/main',
    ].join('\n');
    expect(findImports(page, 'page.md')).toEqual([
      {
        file: 'page.md',
        line: 1,
        specifier: 'ondocs/embed',
        names: ['mountAskDialog', 'openAskDialog'],
      },
      { file: 'page.md', line: 2, specifier: 'ondocs/astro', names: ['default'] },
      { file: 'page.md', line: 3, specifier: 'ondocs/embed', names: ['MountAskDialogOptions'] },
      { file: 'page.md', line: 4, specifier: 'ondocs/embed/button.css', names: [] },
      { file: 'page.md', line: 5, specifier: 'ondocs/docusaurus', names: [] },
      { file: 'page.md', line: 6, specifier: 'ondocs', names: [] },
    ]);
  });

  it('come from the README, the plugin packages’ READMEs and every page of the website’s docs', () => {
    const files = docFiles(root);
    expect(files.slice(0, 3)).toEqual([
      'README.md',
      'packages/docusaurus-plugin-ondocs/README.md',
      'packages/starlight-ondocs/README.md',
    ]);
    expect(files).toContain('examples/nextjs/content/docs/ask-dialog.md');
  });
});

describe('checking them against a package', () => {
  // The 0.11 docs on main, against 0.10.0 on npm.
  it('reports a module the package does not export, and a name its module lacks', () => {
    const imports = findImports(
      [
        "import 'ondocs/embed/button.css';",
        "import { mountAskDialog, openAskDialog } from 'ondocs/embed';",
        "import { type MountAskDialogOptions } from 'ondocs/embed';",
        "import ondocs from 'ondocs/astro';",
        "import 'ondocs/embed/launcher.css';",
      ].join('\n'),
      'ask-dialog.md',
    );
    expect(checkImports(imports, ondocs010)).toEqual([
      {
        file: 'ask-dialog.md',
        line: 1,
        specifier: 'ondocs/embed/button.css',
        message:
          'ondocs@0.10.0 does not export ondocs/embed/button.css: its package.json has no "./embed/button.css" in exports',
      },
      {
        file: 'ask-dialog.md',
        line: 2,
        specifier: 'ondocs/embed',
        message: 'ondocs/embed in ondocs@0.10.0 does not export openAskDialog',
      },
    ]);
  });

  it('reports an export whose file is not in the package', () => {
    const dir = packageWith({
      'package.json': JSON.stringify({
        name: 'ondocs',
        version: '1.0.0',
        exports: { './react/styles.css': './dist/styles.css' },
      }),
    });
    const imports = findImports("import 'ondocs/react/styles.css';", 'page.md');
    expect(checkImports(imports, dir).map((problem) => problem.message)).toEqual([
      'ondocs@1.0.0 exports ondocs/react/styles.css as ./dist/styles.css, which is not in the package',
    ]);
  });

  it('follows export * to the declaration file it names', () => {
    const dir = packageWith({
      'package.json': JSON.stringify({
        name: 'ondocs',
        version: '1.0.0',
        exports: { './server': { types: './dist/server.d.ts', default: './dist/server.js' } },
      }),
      'dist/server.js': '',
      'dist/server.d.ts': "export * from './handler.js';\n",
      'dist/handler.d.ts': 'export declare function createAskHandler(): void;\n',
    });
    const imports = findImports(
      "import { createAskHandler, nope } from 'ondocs/server';",
      'page.md',
    );
    expect(checkImports(imports, dir).map((problem) => problem.message)).toEqual([
      'ondocs/server in ondocs@1.0.0 does not export nope',
    ]);
  });

  // Every module the docs name is in this package.json's exports. The script also checks the
  // built files and the names, after a build.
  it('finds every module the docs name in this package’s exports', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const specifiers = new Set(
      docFiles(root).flatMap((file) =>
        findImports(readFileSync(join(root, file), 'utf8'), file).map((entry) => entry.specifier),
      ),
    );
    expect(specifiers.size).toBeGreaterThan(10);
    for (const specifier of specifiers) {
      expect(Object.keys(manifest.exports), specifier).toContain(
        specifier === 'ondocs' ? '.' : `.${specifier.slice('ondocs'.length)}`,
      );
    }
  });
});
