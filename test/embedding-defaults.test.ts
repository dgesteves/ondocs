// The embedding an index gets when nothing names one: `ondocs index` builds OpenAI's
// text-embedding-3-small at 512 dimensions, as the plugins do, and a plugin build without a model
// key says what a keyword-only index means for the Ask box.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startOpenAIStub } from '../scripts/openai-stub.mjs';

import { main } from '../src/cli/main';
import { parseIndexFile } from '../src/index-file';
import { buildEmbedding } from '../src/integration/build';

let cwd: string;
let stub: Awaited<ReturnType<typeof startOpenAIStub>>;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ondocs-embedding-defaults-'));
  await mkdir(join(cwd, 'content'));
  await writeFile(join(cwd, 'content/index.md'), '# Home\n\nWelcome to the docs.\n');
  await writeFile(
    join(cwd, 'content/deploy.md'),
    '# Deploying\n\nShip it to the edge.\n\n## Rollbacks\n\nRedeploy the previous build.\n',
  );
  stub = await startOpenAIStub();
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await stub.close();
  await rm(cwd, { recursive: true, force: true });
});

/** `ondocs index content …` with an OpenAI key, against the local stand-in for OpenAI's API. */
async function index(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(['index', 'content', ...args], {
    cwd,
    env: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: stub.url },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const readIndex = async () => parseIndexFile(await readFile(join(cwd, 'ask-index.json'), 'utf8'));

describe('ondocs index without --embedding', () => {
  it('embeds with text-embedding-3-small at 512 dimensions, as the plugins do', async () => {
    const result = await index();
    expect(result.code).toBe(0);
    expect((await readIndex()).embedding).toEqual({
      model: 'text-embedding-3-small',
      dimensions: 512,
      settings: expect.any(String) as string,
    });
  });

  it('builds another size with --dimensions, and a model you name at its own size', async () => {
    expect((await index('--dimensions', '1536')).code).toBe(0);
    expect((await readIndex()).embedding).toMatchObject({ dimensions: 1536 });
    // The model's full size, as the plugins build a model their `embedding` option names.
    expect((await index('-e', 'openai:text-embedding-3-small')).code).toBe(0);
    expect((await readIndex()).embedding).toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
  });

  it('says so in its help', async () => {
    const stdout: string[] = [];
    await main(['--help'], { cwd, env: {}, stdout: (line) => stdout.push(line), stderr: vi.fn() });
    expect(stdout.join('\n')).toContain(
      '(default: openai:text-embedding-3-small at 512 dimensions,',
    );
  });

  it('rebuilds an index the CLI built at 1,536 dimensions once, and checks it as it is', async () => {
    // What `ondocs index` wrote by default before: the model's full size, with no settings.
    expect((await index('-e', 'openai:text-embedding-3-small')).code).toBe(0);
    const before = await readIndex();
    expect(before.embedding).toEqual({ model: 'text-embedding-3-small', dimensions: 1536 });

    // A CI check without flags names no model, so the old index is still up to date.
    const check = await index('--check');
    expect([check.code, check.stdout]).toEqual([0, expect.stringContaining('is up to date')]);

    // The next build embeds every chunk again, at 512, and reuses none of the old vectors.
    const rebuilt = await index();
    const chunks = String(before.chunks.length);
    expect(rebuilt.code).toBe(0);
    expect(rebuilt.stdout).toContain(`✓ ${chunks} chunks, ${chunks} embedded, 0 reused`);
    expect((await readIndex()).embedding).toMatchObject({ dimensions: 512 });
    // And the one after reuses them all.
    expect((await index()).stdout).toMatch(/, 0 embedded, \d+ reused/);
  });

  it('embeds through AI Gateway at 512 dimensions when only its key is set', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-test');
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as {
          values: string[];
          providerOptions?: { openai?: { dimensions?: number } };
        };
        bodies.push(body);
        const size = body.providerOptions?.openai?.dimensions ?? 1536;
        return Promise.resolve(
          Response.json({
            embeddings: body.values.map(() => Array.from({ length: size }, (_, i) => (i ? 0 : 1))),
          }),
        );
      }),
    );
    const code = await main(['index', 'content'], {
      cwd,
      env: { AI_GATEWAY_API_KEY: 'gateway-test' },
      stdout: vi.fn(),
      stderr: vi.fn(),
    });
    expect(code).toBe(0);
    expect(bodies.at(-1)).toMatchObject({ providerOptions: { openai: { dimensions: 512 } } });
    expect((await readIndex()).embedding).toMatchObject({
      model: 'openai/text-embedding-3-small',
      dimensions: 512,
    });
  });
});

describe('a plugin build without a model key', () => {
  it('says the Ask box then matches words only, and where the key goes', async () => {
    const warn = vi.fn();
    expect(await buildEmbedding({}, { info: vi.fn(), warn })).toEqual({ model: null });
    const said = warn.mock.calls.map(([line]) => String(line)).join('\n');
    expect(said).toContain('No embedding model: building a keyword-only index.');
    expect(said).toContain('where the site builds');
    expect(said).toContain('The Ask box then answers only');
    expect(said).toContain("`embedding: 'none'`");
  });
});
