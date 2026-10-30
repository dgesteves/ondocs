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

  it('states each AI SDK version the ai peer range allows', () => {
    // ondocs runs on AI SDK 6 and 7, each from the floor CI tests (test/ai-peer-floor.test.ts):
    // "any AI SDK provider" alone does not say which.
    const range = (JSON.parse(read('package.json')) as { peerDependencies: { ai: string } })
      .peerDependencies.ai;
    const [six, seven] = range.split(' || ');
    expect([six?.slice(0, 3), seven?.slice(0, 3)]).toEqual(['^6.', '^7.']);
    expect(readme).toContain(
      `AI SDK 6 (\`ai@${String(six)}\`) or 7 (\`ai@${String(seven)}\`); see [Compatibility]`,
    );
    expect(readme).not.toMatch(/AI SDK \d+ is not supported/);
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

  it('stays one screen: about 800 to 1,250 words of prose', () => {
    const prose = readme
      .replace(/```[\s\S]*?```/g, '')
      .replace(/<!-- npm-readme:image[\s\S]*?-->/g, '');
    const words = prose.match(/\S+/g)?.length ?? 0;
    expect(words).toBeGreaterThan(800);
    expect(words).toBeLessThan(1250);
  });
});

/** The README from one line that starts with `from` to the next that starts with `to`. */
const section = (from: string, to: string) => {
  const start = readme.indexOf(`\n${from}`);
  expect([from, start]).not.toEqual([from, -1]);
  const end = readme.indexOf(`\n${to}`, start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
};

const packages = readdirSync(join(root, 'packages')).map((dir) => `packages/${dir}`);
const readmes = ['README.md', ...packages.map((dir) => `${dir}/README.md`)];
const manifests = ['package.json', ...packages.map((dir) => `${dir}/package.json`)];
const manifest = JSON.parse(read('package.json')) as { description: string; keywords: string[] };

describe('how the README places ondocs, as the website does', () => {
  const landing = read('examples/nextjs/app/(home)/page.tsx');
  const text = (jsx: string) =>
    jsx
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('leads with open-source Ask AI, in the landing page’s heading and lead', () => {
    // The category people search for first, and the MCP server second.
    const h1 = text(/<h1 id="hero-title"[^>]*>([\s\S]*?)<\/h1>/.exec(landing)?.[1] ?? '');
    const lead = text(/<p className="hero-lead">([\s\S]*?)<\/p>/.exec(landing)?.[1] ?? '');
    expect(h1).toBe('Open-source Ask AI for your docs.');
    expect(readme.split('\n')[2]).toBe(`**${h1}** ${lead}`);
  });

  it('says who it is for, as the introduction does', () => {
    const audience =
      'teams that run their own developer docs, at product, API and platform companies';
    expect(readme.split('<!-- npm-readme:video -->')[0]).toContain(audience);
    expect(read('examples/nextjs/content/docs/introduction.md')).toContain(audience);
  });

  it('puts Starlight first: in the setup table, the snippets and the live demos', () => {
    const setup = section('## Pick your setup', '## For agents');
    const rows = setup.split('\n').filter((line) => /^\| [A-Z]/.test(line));
    expect(rows[1]).toMatch(/^\| Starlight/);
    const snippets = ['**Starlight.**', '**Docusaurus.**', '**Next.js.**', '**Any other site.**'];
    const at = snippets.map((name) => setup.indexOf(`\n${name}`));
    expect(at.every((position) => position > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // The live demos sit under the hero video, where a reader still is.
    const hero = readme.slice(0, readme.indexOf('\n## '));
    expect(hero).toContain('**Live demos:** [Starlight](https://ondocs-starlight.vercel.app)');
  });

  it('describes each package on npm as open-source Ask AI, within what npm shows', () => {
    // npm cuts a description at 255 characters: 0.10.0's ended "…Next.js, or one script".
    for (const file of manifests) {
      const { description } = JSON.parse(read(file)) as { description: string };
      expect([file, description.length <= 255]).toEqual([file, true]);
      expect([
        file,
        /open-source Ask AI for your docs, with an MCP server/i.test(description),
      ]).toEqual([file, true]);
    }
    expect(manifest.description).toMatch(/^Open-source Ask AI for your docs/);
    for (const file of readmes) {
      expect([file, read(file).includes('answerable by people and by agents')]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('keeps the npm keywords to what people search for ondocs by', () => {
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(['ask-ai', 'ai-search', 'mcp', 'mcp-server', 'llms-txt', 'starlight']),
    );
    const noise = ['chatbot', 'ui', 'utility', 'edge', 'command-palette'];
    expect(manifest.keywords.filter((keyword) => noise.includes(keyword))).toEqual([]);
  });

  it('compares it fairly: Algolia takes your own key, hosted assistants serve agents too', () => {
    const compare = section('## How it compares', '## Links');
    const line = (name: string) =>
      compare.split('\n').find((text) => text.startsWith(`- **${name}`)) ?? '';
    // Algolia's Ask AI is bring-your-own-LLM: the difference is where the index lives.
    expect(line('Algolia DocSearch Ask AI')).toMatch(/your own LLM provider and key/);
    expect(line('Algolia DocSearch Ask AI')).toMatch(/crawler/);
    // Several hosted assistants now serve an MCP endpoint too, and aggregators serve docs to
    // agents: one index for people and agents is no longer what sets ondocs apart.
    expect(compare).toMatch(/MCP endpoint for agents as well/);
    expect(line('Context7')).toMatch(/DocSearch MCP/);
    expect(line('Context7')).toMatch(/first-party copy/);
    expect(compare).not.toMatch(/one index you host serving both people and agents/);
  });
});

describe('what the README says was measured', () => {
  it('scopes the agent-search count, with the count as people ask, and links the queries', () => {
    // The queries were written knowing the docs, in their words, so the count is a best case. The
    // counts are the ones test/corpus.test.ts checks in CI.
    const corpus = read('test/corpus.test.ts');
    const agent = /top3: (\d+),\s+misses: \[\]/.exec(corpus)?.[1];
    const person = /asked as a person asks them'[\s\S]*?\.toBe\((\d+)\)/.exec(corpus)?.[1];
    expect([agent, person]).toEqual([
      expect.stringMatching(/^\d+$/),
      expect.stringMatching(/^\d+$/),
    ]);
    const quality = readme.split('\n').find((line) => line.startsWith('- **Quality.**')) ?? '';
    expect(quality).toContain(`${String(agent)} of ${String(agent)} agent-style queries we wrote`);
    expect(quality).toContain(`${String(person)} of ${String(agent)} asked as a person asks`);
    expect(quality).toContain('a best case');
    expect(quality).toContain(
      '(https://github.com/dgesteves/ondocs/blob/main/test/corpus.test.ts)',
    );
    const counted = new RegExp(` of ${String(agent)}\\b`);
    for (const line of readme.split('\n').filter((text) => counted.test(text))) {
      expect(line).toContain('we wrote');
    }
  });

  it('does not say every question the docs don’t cover stops before the model', () => {
    // A general programming question that shares common words with the docs clears the gate, and
    // costs a model call.
    for (const file of readmes) {
      const text = read(file);
      expect([
        file,
        /\b0 model calls|question your docs don['’]t cover stops before the model/i.test(text),
      ]).toEqual([file, false]);
    }
    expect(section('## Cost and safety defaults', '## How it compares')).toMatch(
      /Most questions your docs don['’]t cover stop before the model; one that shares enough words with your pages/,
    );
  });

  it('says “chosen”, not “calibrated”, of the similarity gate no eval has measured', () => {
    for (const file of readmes) {
      expect([file, /calibrat/i.test(read(file))]).toEqual([file, false]);
    }
  });

  it('shows no downloads badge: a count of npm downloads is not a count of users', () => {
    for (const file of readmes) {
      const text = read(file);
      expect([file, /img\.shields\.io\/npm\/d[wmyt]\/|\[!\[Downloads\]/i.test(text)]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('tells a GitHub Pages project site to add --base-url to the index command', () => {
    // Without it, every citation and MCP link on user.github.io/repo drops /repo and 404s.
    expect(section('**Any other site.**', '**Try it without a key.**')).toMatch(
      /project site,? at `https:\/\/user\.github\.io\/repo`[^\n]*`--base-url \/repo`/,
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
