// scripts/check-doc-imports.mjs: every `ondocs/...` import the docs show resolves in a package. The
// docs deploy from main, and twice they described modules and names that npm's latest didn't have
// yet: with 0.10.0 on npm, `import 'ondocs/embed/button.css'` failed the build, and the prose's
// `` `openAskDialog(question?)` from `ondocs/embed` `` named a function 0.10.0 doesn't export. The
// names come from import statements and from such prose. The release workflow runs it on what it
// publishes.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  checkImports,
  docFiles,
  fetchPackage,
  findImports,
  main,
} from '../scripts/check-doc-imports.mjs';

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

  // As ask-dialog.md says it, and the other ways the docs give a module names in prose.
  it('take the names the prose gives a module in backticks', () => {
    const page = [
      'From code, `openAskDialog(question?)` from `ondocs/embed` does the same.',
      'Import `createAskHandler` and `createMcpHandler` from `ondocs/server`.',
      '`turnstile`, `remoteIndex` or `memoryRateLimit` from `ondocs/server` fit here.',
      '- **React:** `<McpInstall url="https://docs.example.com/api/mcp" />` from `ondocs/react`.',
      'Nothing from `window.Ondocs.open(question?)` from `ondocs/embed`, or `useChat` from `@ai-sdk/react`.',
      'Without Starlight, add the integration from `ondocs/astro`.',
    ].join('\n');
    expect(findImports(page, 'page.md').map((entry) => [entry.specifier, entry.names])).toEqual([
      ['ondocs/embed', ['openAskDialog']],
      ['ondocs/server', ['createAskHandler', 'createMcpHandler']],
      ['ondocs/server', ['turnstile', 'remoteIndex', 'memoryRateLimit']],
      ['ondocs/react', ['McpInstall']],
      ['ondocs/embed', []],
      ['ondocs/astro', []],
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
  // The 0.11 docs on main, against 0.10.0 on npm: line 2 is ask-dialog.md's own sentence.
  it('reports a module the package does not export, and a name its module lacks', () => {
    const imports = findImports(
      [
        "import 'ondocs/embed/button.css';",
        'From code, `openAskDialog(question?)` from `ondocs/embed` does the same in any framework.',
        "import { mountAskDialog, type MountAskDialogOptions } from 'ondocs/embed';",
        "import ondocs from 'ondocs/astro';",
        "import 'ondocs/embed/launcher.css';",
        'In an app with a bundler, `mountAskDialog(options)` from `ondocs/embed` does the same.',
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

describe('the published package', () => {
  /** A checkout with one docs page, `page`, under a new temporary directory. */
  const checkout = (page: string) =>
    packageWith({
      'README.md': '# ondocs\n',
      'packages/docusaurus-plugin-ondocs/README.md': '# docusaurus-plugin-ondocs\n',
      'examples/nextjs/content/docs/ask-dialog.md': page,
    });
  /** `npm pack` and `tar`, as stand-ins: npm fails `failures` times, then gives `from`, unpacked. */
  const registry = (from: string, failures = 0) => {
    const commands: string[] = [];
    let tries = 0;
    const exec = (command: string, args: string[]) => {
      commands.push(command);
      if (command === 'npm') {
        if (++tries <= failures) throw new Error('Command failed: npm pack\nnpm error code E503');
        return JSON.stringify([{ filename: 'ondocs-0.10.0.tgz' }]);
      }
      cpSync(from, join(args[args.indexOf('-C') + 1] ?? '', 'package'), { recursive: true });
      return '';
    };
    return { exec, commands };
  };
  const quiet = { sleep: () => Promise.resolve(), attempts: 3, delayMs: 0 };

  it('is downloaded again when npm fails, up to its tries', async () => {
    const { exec, commands } = registry(ondocs010, 2);
    const fetched = await fetchPackage('ondocs@0.10.0', { ...quiet, exec, log: () => undefined });
    try {
      expect(commands).toEqual(['npm', 'npm', 'npm', 'tar']);
      expect(readFileSync(join(fetched.packageDir, 'package.json'), 'utf8')).toContain('0.10.0');
    } finally {
      rmSync(fetched.dir, { recursive: true, force: true });
    }
  });

  it('fails the check when a docs page takes a name the release lacks', async () => {
    const dir = checkout('From code, `openAskDialog(question?)` from `ondocs/embed` opens it.\n');
    const lines: string[] = [];
    const { exec } = registry(ondocs010);
    const code = await main(['--npm', 'ondocs@0.10.0'], {
      ...quiet,
      exec,
      dir,
      log: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain(
      'ondocs/embed in ondocs@0.10.0 does not export openAskDialog',
    );
  });

  // On a push that publishes nothing, a flaky npm would otherwise turn main's Release run red.
  it('only warns, with --warn, when the download still fails after its tries', async () => {
    const dir = checkout('Import `ondocs/embed`.\n');
    for (const [args, expected] of [
      [['--npm', 'ondocs@9.9.9', '--warn'], 0],
      [['--npm', 'ondocs@9.9.9'], 1],
    ] as const) {
      const lines: string[] = [];
      const { exec, commands } = registry(ondocs010, 99);
      const code = await main([...args], { ...quiet, exec, dir, log: (line) => lines.push(line) });
      expect(code).toBe(expected);
      expect(commands).toEqual(['npm', 'npm', 'npm']);
      expect(lines.at(-1)).toMatch(
        new RegExp(`${expected === 0 ? 'warning' : 'error'}.*Could not download ondocs@9\\.9\\.9`),
      );
    }
  });
});
