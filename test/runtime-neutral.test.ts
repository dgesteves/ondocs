// ondocs, ondocs/server, ondocs/react, ondocs/embed and ondocs/mock run in edge runtimes, Workers
// and browsers, and so do the Astro endpoints (ondocs/astro/ask-route and ondocs/astro/mcp-route,
// on Cloudflare Workers too) and the Docusaurus theme (in the browser), so nothing they import may
// import a Node.js built-in. eslint.config.js forbids it with `no-restricted-imports`: these tests
// check that the rule covers every file those entries reach, and that it fires.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

/** The sources of the runtime-neutral entries tsdown.config.ts builds. */
const ENTRIES = [
  'src/index.ts',
  'src/server/index.ts',
  'src/react/index.ts',
  'src/mock/index.ts',
  'src/embed/index.ts',
  'src/embed/global.ts',
  'src/embed/dialog-global.ts',
  'src/astro/ask-route.ts',
  'src/astro/mcp-route.ts',
  'src/docusaurus/theme/Root.tsx',
  'src/docusaurus/theme/Navbar/Search.tsx',
  'src/docusaurus/theme/Ondocs.tsx',
  'src/docusaurus/theme/OndocsMcp.tsx',
  'src/docusaurus/theme/AskMySite.tsx',
  'src/docusaurus/theme/AskMySiteMcp.tsx',
];

/**
 * Every source file the entries import, at any depth. Type-only imports are not followed: they are
 * erased from the JavaScript, so the file they name does not run with the entry (the Docusaurus
 * theme takes a type from the plugin, src/docusaurus/index.ts, which runs in Node.js). The rule
 * still forbids `import type` from a built-in in the files it covers, because those types would
 * reach the published .d.ts.
 */
function reached(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(join(root, file), 'utf8');
    const specifiers = [
      ...code.matchAll(/^(?:import|export)(?!\s+type\b)[^;]*?\sfrom\s+'(\.[^']+)'/gm),
      ...code.matchAll(/\bimport\(\s*'(\.[^']+)'\s*\)/g),
    ].map((match) => match[1] ?? '');
    for (const specifier of specifiers) {
      const base = join(dirname(file), specifier);
      const source = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) =>
        existsSync(join(root, candidate)),
      );
      if (source) queue.push(source);
    }
  }
  return [...seen].sort();
}

const eslint = new ESLint({ cwd: root });
const ruleFor = async (file: string): Promise<Linter.RuleEntry | undefined> =>
  ((await eslint.calculateConfigForFile(file)) as Linter.Config).rules?.['no-restricted-imports'];

describe('the runtime-neutral entries', () => {
  it('reach only files where ESLint forbids Node.js built-ins', async () => {
    const files = reached(ENTRIES);
    expect(files).toContain('src/server/handler.ts');
    expect(files).toContain('src/search/retrieve.ts');
    expect(files).toContain('src/astro/route.ts');
    expect(files).toContain('src/astro/route-handlers.ts');
    expect(files).toContain('src/docusaurus/renamed.ts');
    const uncovered = [];
    for (const file of files) {
      const rule = await ruleFor(file);
      if (!Array.isArray(rule) || rule[0] !== 2) uncovered.push(file);
    }
    expect(uncovered).toEqual([]);
  });

  it('fail lint on an import of a built-in, by either name, and on a type-only one', async () => {
    const rule = await ruleFor('src/server/handler.ts');
    const linter = new Linter();
    const messages = linter.verify(
      [
        "import { readFile } from 'node:fs/promises';",
        "import { join } from 'path';",
        "import type { Readable } from 'node:stream';",
        '',
      ].join('\n'),
      {
        languageOptions: { parser: tseslint.parser, sourceType: 'module' },
        rules: { 'no-restricted-imports': rule },
      },
    );
    expect(messages.map((message) => [message.line, message.ruleId])).toEqual([
      [1, 'no-restricted-imports'],
      [2, 'no-restricted-imports'],
      [3, 'no-restricted-imports'],
    ]);
  });

  it('leave the Node.js entries free to use them', async () => {
    for (const file of [
      'src/node/index.ts',
      'src/integration/build.ts',
      'src/cli/main.ts',
      'src/astro/integration.ts',
      'src/docusaurus/index.ts',
    ]) {
      expect([file, await ruleFor(file)]).toEqual([file, undefined]);
    }
  });
});
