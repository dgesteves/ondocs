// The reference pages against the code they describe. The option tables are read against the
// types they document, with the TypeScript compiler, so an option added without a row, or a row
// left behind by a rename, fails here; deprecated names are left out of the tables (Upgrading
// lists them with their new names), so they are left out here too. The VitePress sizes are checked
// against the benchmarks table, and the index file's excerpt, the stream's source metadata, the
// answer timeout and a remote index's timeout against what the code does.
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOpenAI } from '@ai-sdk/openai';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { main } from '../src/cli/main';
import { mockLanguageModel } from '../src/mock';
import { createAskHandler, remoteIndex, SOURCE_METADATA_KEY } from '../src/server';
import { corpus } from './helpers';

const root = join(import.meta.dirname, '..');
const DOCS = 'examples/nextjs/content/docs';
const page = (slug: string) => readFileSync(join(root, DOCS, `${slug}.md`), 'utf8');

/** A question, as the dialog posts it. */
const post = (question: string) =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });

const SOURCES = {
  ask: 'src/server/handler.ts',
  mcp: 'src/server/mcp.ts',
  dialog: 'src/react/ask-dialog.tsx',
  docusaurus: 'src/docusaurus/index.ts',
  astro: 'src/astro/integration.ts',
  starlight: 'src/starlight/index.ts',
  vitepress: 'src/vitepress/index.ts',
};

const config = ts.readConfigFile(join(root, 'tsconfig.json'), (path) => ts.sys.readFile(path));
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(
  Object.values(SOURCES).map((file) => join(root, file)),
  options,
);
const checker = program.getTypeChecker();

/** An exported type of one of the sources. */
function exportedType(source: keyof typeof SOURCES, name: string): ts.Type {
  const file = program.getSourceFile(join(root, SOURCES[source]));
  const module = file && checker.getSymbolAtLocation(file);
  const symbol = module && checker.getExportsOfModule(module).find((each) => each.name === name);
  if (!symbol) throw new Error(`${SOURCES[source]} exports no ${name}`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

/** The names of a type's properties, without the deprecated ones. */
function names(type: ts.Type): string[] {
  return checker
    .getPropertiesOfType(type)
    .filter((property) => !property.getJsDocTags(checker).some((tag) => tag.name === 'deprecated'))
    .map((property) => property.name)
    .sort();
}

/** The type of one property of a type, without the `undefined` an optional one adds. */
function propertyType(type: ts.Type, name: string): ts.Type {
  const property = type.getProperty(name);
  if (!property) throw new Error(`no ${name}`);
  return checker.getNonNullableType(checker.getTypeOfSymbol(property));
}

/** The text under a page's `## heading`, up to the next one. */
function section(slug: string, heading: string): string {
  const text = page(slug);
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`${slug}.md has no "## ${heading}"`);
  const rest = text.slice(start + heading.length + 5);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The cells of each row of the table under a page's `## heading`. */
const table = (slug: string, heading: string): string[][] =>
  section(slug, heading)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    // A `|` inside a cell is written `\|`.
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );

/** The names in backticks in a cell. */
const named = (cell = '') => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');

/** The options a table has a row for: the names in its first column. */
const rows = (slug: string, heading: string) =>
  table(slug, heading)
    .flatMap(([name]) => named(name))
    .sort();

/** The names a table's `dialog` row lists. */
const dialogRow = (slug: string, heading: string) =>
  named(table(slug, heading).find(([name]) => name === '`dialog`')?.[2]).sort();

describe('the reference tables', () => {
  it('give createAskHandler a row for each of its options', () => {
    expect(rows('ask-endpoint', 'Handler options')).toEqual(
      names(exportedType('ask', 'AskHandlerOptions')),
    );
  });

  it('give createMcpHandler a row for each of its options', () => {
    expect(rows('mcp', 'Handler options')).toEqual(names(exportedType('mcp', 'McpHandlerOptions')));
  });

  it('give AskDialog a row for each of its props, those of useAsk included', () => {
    expect(rows('ask-dialog', 'AskDialog props')).toEqual(
      names(exportedType('dialog', 'AskDialogProps')),
    );
  });

  it('give each plugin a row for each of its options', () => {
    const docusaurus = exportedType('docusaurus', 'OndocsOptions');
    // `id` is the plugin instance's, which Docusaurus sets for every plugin.
    expect(rows('docusaurus', 'Docusaurus plugin options')).toEqual(
      names(docusaurus).filter((name) => name !== 'id'),
    );
    const astro = exportedType('astro', 'OndocsOptions');
    expect(rows('astro', 'Astro and Starlight options')).toEqual(names(astro));
    const vitepress = exportedType('vitepress', 'OndocsOptions');
    expect(rows('vitepress', 'VitePress options')).toEqual(names(vitepress));
  });

  it('list every option of each plugin’s `dialog`', () => {
    const dialog = (source: keyof typeof SOURCES, type: string) =>
      names(propertyType(exportedType(source, type), 'dialog'));
    expect(dialogRow('docusaurus', 'Docusaurus plugin options')).toEqual(
      dialog('docusaurus', 'OndocsOptions'),
    );
    // One row for both: Starlight's adds `navbar`.
    expect(dialogRow('astro', 'Astro and Starlight options')).toEqual(
      [
        ...new Set([
          ...dialog('astro', 'OndocsOptions'),
          ...dialog('starlight', 'OndocsStarlightOptions'),
        ]),
      ].sort(),
    );
    expect(dialogRow('vitepress', 'VitePress options')).toEqual(
      dialog('vitepress', 'OndocsOptions'),
    );
  });
});

describe('the VitePress sizes', () => {
  // The benchmarks table's VitePress row, in KB gzipped. test/size-claims.test.ts checks the
  // Docusaurus and Starlight figures the same way.
  const row = page('benchmarks')
    .split('\n')
    .find((line) => line.startsWith('| VitePress'));
  const [own = NaN, withOndocs = NaN, onOpen = NaN] = (row ?? '')
    .split('|')
    .slice(2, 5)
    .map((cell) => Number(/[\d.]+/.exec(cell)?.[0]));

  it('give what the plugin adds to a page as the benchmarks table measures it', () => {
    const quoted = /([\d.]+) KB with VitePress/.exec(page('ask-dialog'))?.[1];
    expect(row).toBeDefined();
    expect(quoted).toBeDefined();
    expect(Number(quoted)).toBe(+(withOndocs - own).toFixed(1));
  });

  it('give what the dialog loads when it opens as the benchmarks table measures it', () => {
    const quoted = /: ([\d.]+) KB of JavaScript, gzipped, on the VitePress example/.exec(
      page('vitepress'),
    )?.[1];
    expect(row).toBeDefined();
    expect(quoted).toBeDefined();
    expect(Number(quoted)).toBe(onOpen);
  });
});

describe('the index file page', () => {
  it('shows the file `ondocs index` writes for its example page, with the vectors cut short', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ondocs-index-format-'));
    try {
      await mkdir(join(dir, 'docs'));
      await writeFile(
        join(dir, 'docs/install.md'),
        [
          '---',
          'title: Install',
          '---',
          '',
          '# Install',
          '',
          'Add the package with your package manager.',
          '',
          '## Configure the cache',
          '',
          'The cache keeps vectors between builds.',
          '',
          '### On Vercel',
          '',
          'Vercel keeps node_modules/.cache between deployments.',
          '',
        ].join('\n'),
      );
      const out = join(dir, 'ask-index.json');
      const quiet = () => undefined;
      const code = await main(['index', 'docs', '--base-url', '/docs', '-e', 'mock', '-o', out], {
        cwd: dir,
        env: {},
        stdout: quiet,
        stderr: quiet,
      });
      expect(code).toBe(0);
      const written = (await readFile(out, 'utf8')).replace(
        /"vector":"(.{12})[^"]*"/g,
        '"vector":"$1…"',
      );
      const shown = /\n```\n(\{\n {2}"format"[\s\S]*?\n\})\n```\n/.exec(
        section('index-format', 'What the file holds'),
      )?.[1];
      expect(`${shown ?? ''}\n`).toBe(written);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the ask endpoint page', () => {
  it('names the key the stream’s source parts keep their title and heading under', async () => {
    const { index } = await buildIndex({ documents: corpus, embeddingModel: null });
    const handler = createAskHandler({ index, model: mockLanguageModel(), rateLimit: false });
    const events = (await (await handler(post('How do I install with pnpm?'))).text())
      .split('\n\n')
      .map((event) => event.replace(/^data: /, ''))
      .filter((event) => event.startsWith('{'))
      .map((event) => JSON.parse(event) as { type: string; providerMetadata?: object });
    const source = events.find((event) => event.type === 'source-url');
    expect(source?.providerMetadata).toEqual({
      [SOURCE_METADATA_KEY]: { title: 'Installation', heading: 'With pnpm' },
    });
    const text = section('ask-endpoint', 'Streaming protocol');
    expect(text).toContain(`"providerMetadata":{"${SOURCE_METADATA_KEY}":{"title":`);
    expect(text).toContain('`SOURCE_METADATA_KEY` from `ondocs/server`');
    expect(text).toContain('](/docs/migrating#move-a-site-over)');
  });

  it('gives a remote index’s download timeout and its default', async () => {
    vi.useFakeTimers();
    try {
      const index = remoteIndex('https://example.com/ask-index.json', {
        fetch: () => new Promise<Response>(() => undefined),
      });
      const failed = expect(index()).rejects.toThrow('The index took more than 10 s to download');
      await vi.advanceTimersByTimeAsync(10_000);
      await failed;
    } finally {
      vi.useRealTimers();
    }
    const [, , notes] =
      table('ask-endpoint', 'Handler options').find(([name]) => name === '`index`') ?? [];
    expect(notes).toContain('after 10 seconds (`timeoutSeconds`)');
  });

  // Its own timeout, well under the suite's: each answer ends within about 300 ms, so a stream
  // left open fails here fast.
  it('says the first-word limit holds OpenAI’s Responses models but not its Chat Completions ones, which hand over their stream at the first word', async () => {
    // OpenAI streams whose first word comes 300 ms after the opening events, past a first-word
    // limit of 100 ms. The Chat Completions provider hands its stream to the AI SDK only once that
    // word has arrived; the Responses one 50 ms after `response.in_progress`.
    const ANSWER = 'Run pnpm add ondocs [1].';
    const stalled =
      (before: readonly object[], after: readonly object[], done = '') =>
      (_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              async start(controller) {
                // As fetch does, the body fails with the abort's reason once the request is
                // aborted. ai 7.0.95, the peer range's floor, waits for that to end the answer.
                const signal = init?.signal;
                signal?.addEventListener('abort', () => {
                  controller.error(signal.reason);
                });
                const send = (events: readonly object[]) => {
                  for (const event of events) {
                    controller.enqueue(
                      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
                    );
                  }
                };
                send(before);
                await new Promise((resolve) => setTimeout(resolve, 300));
                // The answer was cut off by then, and the body failed.
                if (signal?.aborted) return;
                send(after);
                if (done) controller.enqueue(new TextEncoder().encode(done));
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        );
    const chunk = (delta: object, finish: string | null = null) => ({
      id: 'c',
      created: 0,
      model: 'gpt-5.4-mini',
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    const chat = stalled(
      [chunk({ role: 'assistant', content: '' })],
      [chunk({ content: ANSWER }), chunk({}, 'stop')],
      'data: [DONE]\n\n',
    );
    const response = { id: 'resp_1', created_at: 0, model: 'gpt-5.4-mini' };
    const message = { type: 'message', id: 'msg_1' };
    const responses = stalled(
      [
        { type: 'response.created', response },
        { type: 'response.in_progress', response },
      ],
      [
        { type: 'response.output_item.added', output_index: 0, item: message },
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: ANSWER },
        { type: 'response.output_item.done', output_index: 0, item: message },
        { type: 'response.completed', response: { incomplete_details: null } },
      ],
    );

    const { index } = await buildIndex({ documents: corpus, embeddingModel: null });
    const answer = async (
      model: Parameters<typeof createAskHandler>[0]['model'],
      timeout: { firstChunkMs?: number; totalMs?: number },
    ) => {
      const onError = vi.fn();
      const handler = createAskHandler({
        index,
        model,
        rateLimit: false,
        generation: { timeout },
        onError,
      });
      const body = await (await handler(post('How do I install with pnpm?'))).text();
      const types = body
        .split('\n\n')
        .map((event) => event.replace(/^data: /, ''))
        .filter((event) => event.startsWith('{'))
        .map((event) => (JSON.parse(event) as { type: string }).type);
      return {
        answered: body.includes(`"delta":"${ANSWER}"`),
        aborted: types.includes('abort'),
        reported: onError.mock.calls.map(([error]) => (error as Error).message),
      };
    };
    const ABORTED = ['The answer was aborted before it finished.'];

    // Chat Completions: the first-word limit never starts, so the answer arrives.
    expect(
      await answer(createOpenAI({ apiKey: 'test', fetch: chat }).chat('gpt-5.4-mini'), {
        firstChunkMs: 100,
        totalMs: 5_000,
      }),
    ).toEqual({ answered: true, aborted: false, reported: [] });
    // The stall is long enough to cut an answer off: the total limit does, at 200 ms.
    expect(
      await answer(createOpenAI({ apiKey: 'test', fetch: chat }).chat('gpt-5.4-mini'), {
        totalMs: 200,
      }),
    ).toEqual({ answered: false, aborted: true, reported: ABORTED });
    // Responses: the same stall after `response.in_progress` trips the first-word limit.
    expect(
      await answer(createOpenAI({ apiKey: 'test', fetch: responses })('gpt-5.4-mini'), {
        firstChunkMs: 100,
        totalMs: 5_000,
      }),
    ).toEqual({ answered: false, aborted: true, reported: ABORTED });

    const errors = section('ask-endpoint', 'Errors');
    expect(errors).toContain('`openai.chat(…)`');
    expect(errors).toMatch(/only the 90 seconds apply/);
  }, 5_000);
});

describe('the troubleshooting page', () => {
  it('quotes the log line of a remote index that takes too long to download', async () => {
    const onError = vi.fn();
    const handler = createAskHandler({
      // A site that never answers, and a short `timeoutSeconds` for the test.
      index: remoteIndex('https://example.com/ask-index.json', {
        timeoutSeconds: 0.05,
        fetch: () => new Promise<Response>(() => undefined),
      }),
      model: mockLanguageModel(),
      rateLimit: false,
      onError,
    });
    const response = await handler(post('How do I install it?'));
    expect(response.status).toBe(500);
    const logged = String((onError.mock.calls[0]?.[0] as Error | undefined)?.message);
    // The page quotes it with the default, 10 seconds.
    expect(page('troubleshooting')).toContain(`\`${logged.replace('0.05 s', '10 s')}\``);
  });
});
