import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const readme = read('README.md');

describe('what the README claims', () => {
  it('states the Node.js version package.json requires', () => {
    const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines;
    const required = /^>=(\d+\.\d+)\.0$/.exec(engines.node)?.[1];
    expect(required).toBeDefined();
    expect(readme).toContain(`Requires Node.js ${String(required)} or later`);
    expect(readme).not.toMatch(/Requires Node \d+ and/);
    expect(read('CONTRIBUTING.md')).toContain(`Node ${String(required)} or later`);
  });

  it('states the AI SDK version the ai peer range requires', () => {
    // ondocs uses AI SDK 7's API, which AI SDK 6 lacks, and ai 7.0s before the floor fail
    // (test/ai-peer-floor.test.ts): "any AI SDK provider" alone does not say so.
    const range = (JSON.parse(read('package.json')) as { peerDependencies: { ai: string } })
      .peerDependencies.ai;
    const major = /^\^(\d+)\./.exec(range)?.[1];
    expect(major).toBeDefined();
    expect(readme).toContain(`AI SDK ${String(major)} (\`ai@${range}\`)`);
  });

  it('does not say the live demo runs without a model key', () => {
    // The production site answers with OpenAI; only previews and local runs are in mock mode.
    for (const file of [
      'README.md',
      'examples/nextjs/content/docs/local-development.md',
      'examples/nextjs/content/docs/faq.md',
    ]) {
      const text = read(file);
      expect([file, /demo runs in mock mode|website runs in mock mode/.test(text)]).toEqual([
        file,
        false,
      ]);
      expect([file, text.includes('It runs in mock mode, so its answers')]).toEqual([file, false]);
    }
  });

  it('does not call the answers single-turn: the dialog and the endpoint take follow-ups', () => {
    for (const file of [
      'README.md',
      'examples/nextjs/app/(home)/page.tsx',
      'examples/nextjs/content/docs/introduction.md',
      'examples/nextjs/content/docs/faq.md',
      'examples/nextjs/content/docs/limits.md',
    ]) {
      const text = read(file);
      expect([file, /single-turn|each answer stands on its own/i.test(text)]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('calls the benchmark’s memory figure heap, next to what the process grows by', () => {
    // The README no longer has the table; the benchmarks page does, and must say it right.
    const files = ['README.md', 'examples/nextjs/content/docs/benchmarks.md'];
    const headers = files.map((file) => [
      file,
      read(file)
        .split('\n')
        .find((line) => line.startsWith('| Chunks |') && line.includes('Cold load')),
    ]);
    expect(headers.filter(([, header]) => header !== undefined).map(([file]) => file)).toContain(
      'examples/nextjs/content/docs/benchmarks.md',
    );
    for (const [file, header] of headers) {
      if (header === undefined) continue;
      expect([file, header]).toEqual([
        file,
        expect.stringMatching(/Heap retained \|\s+Process memory \(peak\)/),
      ]);
    }
  });

  it('compares it only with tools that exist, in terms it can back', () => {
    for (const file of [
      'README.md',
      'examples/nextjs/app/(home)/page.tsx',
      'examples/nextjs/content/docs/introduction.md',
      'examples/nextjs/content/docs/faq.md',
    ]) {
      const text = read(file);
      // markprompt.com is gone.
      expect([file, text.includes('Markprompt')]).toEqual([file, false]);
      // Algolia's pricing for open source, and Ask AI in VitePress (a 2.0 alpha), are not ours to state.
      expect([file, /Ask AI\*\* is free|free for open-source/i.test(text)]).toEqual([file, false]);
    }
  });

  it('says the integration needs a deployed endpoint and a rate limit, not five lines alone', () => {
    expect(readme).not.toContain('That is the whole integration');
    const setup = readme.slice(
      readme.indexOf('## Pick your setup'),
      readme.indexOf('## For agents'),
    );
    expect(setup).toMatch(/endpoint you deploy as one function/);
    expect(setup).toMatch(/rate-limited by default/);
  });

  it('stays one screen: about 800 to 1,200 words of prose', () => {
    const prose = readme
      .replace(/```[\s\S]*?```/g, '')
      .replace(/<!-- npm-readme:image[\s\S]*?-->/g, '');
    const words = prose.match(/\S+/g)?.length ?? 0;
    expect(words).toBeGreaterThan(800);
    expect(words).toBeLessThan(1200);
  });

  it('leads with what it is now: people and agents, from one static index', () => {
    expect(readme.split('\n')[2]).toBe(
      '**Make your docs answerable by people and by agents, from one static index:** a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor. Agent traffic costs you no model tokens.',
    );
    const manifest = JSON.parse(read('package.json')) as {
      description: string;
      keywords: string[];
    };
    expect(manifest.description).toMatch(/people and by agents/);
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(['mcp', 'mcp-server', 'llms-txt', 'ask-ai', 'ai-search', 'utility']),
    );
  });
});

/** A JavaScript or TypeScript block of a Markdown file, with the line its code starts on. */
interface Block {
  file: string;
  line: number;
  /** As the file a reader pastes it into: a JavaScript config is an `.mjs` file. */
  extension: string;
  code: string;
}

const codeBlocks = (file: string): Block[] => {
  const text = read(file);
  return [...text.matchAll(/^```(js|jsx|ts|tsx)\n([\s\S]*?)^```$/gm)].map((match) => ({
    file,
    line: text.slice(0, match.index).split('\n').length + 1,
    extension: match[1] === 'js' ? 'mjs' : String(match[1]),
    code: String(match[2]),
  }));
};

/** The source each import of the package resolves to: its entries, and the plugin packages. */
const entries = () => {
  const manifest = JSON.parse(read('package.json')) as { exports: Record<string, unknown> };
  const sources = new Map<string, string>();
  for (const subpath of Object.keys(manifest.exports)) {
    const base = subpath === '.' ? 'src/index' : `src${subpath.slice(1)}`;
    const source = [`${base}/index`, base].find((path) => existsSync(join(root, `${path}.ts`)));
    if (source !== undefined) sources.set(`ondocs${subpath.slice(1)}`, join(root, source));
  }
  for (const dir of readdirSync(join(root, 'packages'))) {
    const { name } = JSON.parse(read(`packages/${dir}/package.json`)) as { name: string };
    sources.set(name, join(root, 'packages', dir, 'index'));
  }
  return { exported: Object.keys(manifest.exports), sources };
};

/** "Cannot find module", the errors a module left unresolved gets. */
const UNRESOLVED_MODULE = new Set([2307, 2792, 2882]);

/**
 * Type-checks each block on its own, as a module, against the package's source. An import of
 * `ondocs/<entry>` or of a plugin package resolves to that entry's source; every other module (the
 * framework, the AI SDK, the index's JSON) stays unresolved, so what a block imports from it is
 * `any`. What is left is what a reader hits on pasting the block into a file: code that does not
 * parse, a name used and never imported, an entry the package does not export, or a name it does
 * not export.
 */
const compile = (blocks: Block[]) => {
  const { exported, sources } = entries();
  const files = new Map(
    blocks.map((block, i) => [
      join(root, 'readme-blocks', `${String(i)}.${block.extension}`),
      block,
    ]),
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
    strict: true,
    allowJs: true,
    checkJs: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (file) => files.has(file) || base.fileExists(file),
    readFile: (file) => files.get(file)?.code ?? base.readFile(file),
    getSourceFile: (file, language, onError) => {
      const block = files.get(file);
      return block === undefined
        ? base.getSourceFile(file, language, onError)
        : ts.createSourceFile(file, block.code, language, true);
    },
    resolveModuleNameLiterals: (literals, containingFile) =>
      literals.map(({ text }) => {
        const source = sources.get(text);
        const relative = text.startsWith('.') && !files.has(containingFile);
        return {
          resolvedModule:
            source !== undefined || relative
              ? ts.resolveModuleName(source ?? text, containingFile, options, base).resolvedModule
              : undefined,
        };
      }),
  };
  const program = ts.createProgram([...files.keys()], options, host);

  const problems: string[] = [];
  for (const [file, block] of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`${file} was not compiled`);
    const at = (position: number) =>
      `${block.file}:${String(block.line + source.getLineAndCharacterOfPosition(position).line)}`;
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (
        /^ondocs(\/|$)/.test(specifier) &&
        !exported.includes(specifier.replace(/^ondocs/, '.'))
      ) {
        problems.push(`${at(statement.getStart())}: ondocs exports no '${specifier}'`);
      }
    }
    for (const diagnostic of [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ]) {
      const { code, start = 0, length = 0, messageText } = diagnostic;
      // The module's name, inside its quotes: one other than the package's stays unresolved.
      const specifier = source.text.slice(start + 1, start + length - 1);
      if (UNRESOLVED_MODULE.has(code) && !sources.has(specifier)) continue;
      problems.push(
        `${at(start)}: TS${String(code)} ${ts.flattenDiagnosticMessageText(messageText, ' ')}`,
      );
    }
  }
  return problems;
};

describe('the README’s code, as copied', () => {
  it('compiles: every name it uses is imported, from an entry the package exports', () => {
    const blocks = [
      'README.md',
      ...readdirSync(join(root, 'packages')).map((dir) => `packages/${dir}/README.md`),
    ].flatMap(codeBlocks);
    expect(blocks.filter((block) => block.file === 'README.md').length).toBeGreaterThan(3);
    expect(compile(blocks)).toEqual([]);
  });
});
