import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createOpenAI } from '@ai-sdk/openai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startOpenAIStub } from '../scripts/openai-stub.mjs';
import { buildIndex, serializeIndexFile } from '../src';
import { devModels, DevError, findIndexFile, startDevServer, type DevServer } from '../src/cli/dev';
import { main } from '../src/cli/main';
import { mockEmbeddingModel } from '../src/mock';
import { writeIndexFile } from '../src/node';
import { corpus } from './helpers';

let root: string;
const servers: DevServer[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-dev-'));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await rm(root, { recursive: true, force: true });
});

/** Builds an index of the test corpus at `file` under the temporary root. */
async function indexAt(file: string, embeddingModel = mockEmbeddingModel()) {
  const { index } = await buildIndex({ documents: corpus, embeddingModel });
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeIndexFile(join(root, file), index);
  return index;
}

async function serve(file: string, options: Partial<Parameters<typeof startDevServer>[0]> = {}) {
  const logs: string[] = [];
  const server = await startDevServer({
    file: join(root, file),
    port: 0,
    env: {},
    log: (line) => logs.push(line),
    error: (line) => logs.push(line),
    ...options,
  });
  servers.push(server);
  return { server, logs };
}

const ask = (endpoint: string, question: string, headers: Record<string, string> = {}) =>
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ question }),
  });

/** The answer's text, from the stream's text deltas. */
const answerOf = (stream: string) =>
  Array.from(
    stream.matchAll(/^data: (\{"type":"text-delta".*\})$/gm),
    (match) => (JSON.parse(match[1] ?? '{}') as { delta: string }).delta,
  ).join('');

describe('ondocs dev', () => {
  it('answers questions from the index, with sources, as the handler streams them', async () => {
    await indexAt('ask-index.json');
    const { server, logs } = await serve('ask-index.json');
    expect(server.endpoint).toMatch(/^http:\/\/localhost:\d+\/api\/ask$/);
    expect(server.description).toBe(
      'mock embeddings, answers from the mock model, which quotes the sources',
    );

    const response = await ask(server.endpoint, 'How is an int8 vector scaled?');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = await response.text();
    expect(stream).toContain('"url":"/docs/quantization#why-int8"');
    expect(answerOf(stream)).toMatch(/largest component maps to 127\. \[\d\]$/);
    expect(logs.at(-1)).toMatch(/answered from \d sources: How is an int8 vector scaled\?/);

    const refused = await (await ask(server.endpoint, 'What is the capital of France?')).text();
    expect(refused).toContain("I don't know");
    expect((await fetch(server.endpoint.replace('/api/ask', '/'))).status).toBe(404);
  });

  it('allows pages on this machine by default, and other origins only when it is told to', async () => {
    await indexAt('ask-index.json');
    const local = await serve('ask-index.json');
    const preflight = await fetch(local.server.endpoint, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(preflight.headers.get('access-control-allow-headers')).toBe(
      'content-type, mcp-protocol-version',
    );
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('vary')).toBe('origin');

    const { server } = await serve('ask-index.json', { origins: ['https://docs.example.com'] });
    const site = await ask(server.endpoint, 'int8', { origin: 'https://docs.example.com' });
    expect(site.headers.get('access-control-allow-origin')).toBe('https://docs.example.com');
    expect(site.headers.get('vary')).toBe('origin');
    await site.body?.cancel();
    const other = await ask(server.endpoint, 'int8', { origin: 'http://evil.example' });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    await other.body?.cancel();

    const any = await serve('ask-index.json', { origins: ['*'] });
    const anywhere = await ask(any.server.endpoint, 'int8', { origin: 'http://evil.example' });
    expect(anywhere.headers.get('access-control-allow-origin')).toBe('*');
    await anywhere.body?.cancel();
  });

  it('serves the same index as an MCP server at /api/mcp, with the index’s own paths', async () => {
    await indexAt('ask-index.json');
    const { server, logs } = await serve('ask-index.json');
    expect(server.mcp).toBe(server.endpoint.replace('/api/ask', '/api/mcp'));
    const call = async (method: string, params: Record<string, unknown>) =>
      (await (
        await fetch(server.mcp, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
      ).json()) as { result: { structuredContent: { results: { url: string }[] } } };
    const { result } = await call('tools/call', { name: 'search', arguments: { query: 'int8' } });
    expect(result.structuredContent.results[0]?.url).toMatch(/^\/docs\/quantization/);
    expect(logs).toContain('  mcp search: int8');
    // A page on another site cannot reach it any more than the ask endpoint.
    const foreign = await fetch(server.mcp, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: '{}',
    });
    expect(foreign.status).toBe(403);
  });

  it('answers each locale from its index beside the root one, on both endpoints', async () => {
    await indexAt('dist/ask-index.json');
    const { index: french } = await buildIndex({
      documents: [
        {
          id: 'installer.md',
          url: '/fr/guides/installation',
          title: 'Installation',
          content: 'Pour installer la CLI, lancez npm i ondocs dans le dossier du site.',
        },
      ],
      embeddingModel: mockEmbeddingModel(),
    });
    await writeIndexFile(join(root, 'dist/fr/ask-index.json'), french);
    // A folder without an index is no locale.
    await mkdir(join(root, 'dist/assets'), { recursive: true });
    const { server } = await serve('dist/ask-index.json');
    expect(server.locales).toEqual({
      fr: { file: join(root, 'dist/fr/ask-index.json'), chunks: 1 },
    });
    const asked = async (body: object) =>
      (
        await fetch(server.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).text();
    expect(await asked({ question: 'Comment installer la CLI ?', locale: 'fr' })).toContain(
      '"url":"/fr/guides/installation"',
    );
    expect(await asked({ question: 'How is an int8 vector scaled?' })).toContain(
      '"url":"/docs/quantization#why-int8"',
    );
    const search = async (args: Record<string, unknown>) =>
      (
        (await (
          await fetch(server.mcp, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'search', arguments: args },
            }),
          })
        ).json()) as { result: { structuredContent: { results: { url: string }[] } } }
      ).result.structuredContent.results.map((result) => result.url);
    expect(await search({ query: 'installer la CLI', locale: 'fr' })).toEqual([
      expect.stringMatching(/^\/fr\/guides\/installation/),
    ]);
    // A rebuilt locale's index is picked up on the next question, as the root's is.
    const { index: rebuilt } = await buildIndex({
      documents: [
        {
          id: 'tarifs.md',
          url: '/fr/tarifs',
          title: 'Tarifs',
          content: 'Le forfait coûte dix euros.',
        },
      ],
      embeddingModel: mockEmbeddingModel(),
    });
    await writeIndexFile(join(root, 'dist/fr/ask-index.json'), rebuilt);
    const later = new Date(Date.now() + 5000);
    await utimes(join(root, 'dist/fr/ask-index.json'), later, later);
    expect(await asked({ question: 'Combien coûte le forfait ?', locale: 'fr' })).toContain(
      '"url":"/fr/tarifs"',
    );
  });

  it('reads the index again after a reload fails, as when it is read half written', async () => {
    const file = join(root, 'build/ask-index.json');
    await indexAt('build/ask-index.json');
    const { server, logs } = await serve('build/ask-index.json');
    // A question while the build is writing the file: it is not JSON yet.
    const { index } = await buildIndex({
      documents: [{ id: 'new.md', url: '/new', title: 'Brand new', content: 'Zebras stripe.' }],
      embeddingModel: mockEmbeddingModel(),
    });
    const written = serializeIndexFile(index);
    await writeFile(file, written.slice(0, 40));
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    expect((await ask(server.endpoint, 'zebras')).status).toBe(500);
    expect(logs.some((line) => line.includes('✗'))).toBe(true);
    // The build finishes within the same second, which is all some file systems record.
    await writeFile(file, written);
    await utimes(file, later, later);
    expect(await (await ask(server.endpoint, 'zebras')).text()).toContain('"url":"/new"');
    expect(logs).toContain('Reloaded the index (1 chunks).');
  });

  it('picks up a rebuilt index on the next question', async () => {
    await indexAt('build/ask-index.json');
    const { server, logs } = await serve('build/ask-index.json');
    const { index } = await buildIndex({
      documents: [{ id: 'new.md', url: '/new', title: 'Brand new', content: 'Zebras stripe.' }],
      embeddingModel: mockEmbeddingModel(),
    });
    await writeIndexFile(join(root, 'build/ask-index.json'), index);
    // Some file systems keep modification times to the second.
    const later = new Date(Date.now() + 5000);
    await utimes(join(root, 'build/ask-index.json'), later, later);

    expect(await (await ask(server.endpoint, 'zebras')).text()).toContain('"url":"/new"');
    expect(logs).toContain('Reloaded the index (1 chunks).');
  });

  it('finds the index the CLI, Docusaurus, Astro or VitePress wrote, or says how to make one', async () => {
    expect(() => findIndexFile(root)).toThrow(
      /No index found: looked for ask-index.json, build\/ask-index.json, dist\/ask-index.json, dist\/client\/ask-index.json, \.vitepress\/dist\/ask-index.json, docs\/\.vitepress\/dist\/ask-index.json, public\/ask-index.json, site\/ask-index.json, _site\/ask-index.json\./,
    );
    // Where `ondocs init` has `ondocs index -o` write it for a site no plugin builds: Jekyll's and
    // Eleventy's _site/, MkDocs's site/, and Next.js's and Hugo's public/.
    await indexAt('_site/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, '_site/ask-index.json'));
    await indexAt('site/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'site/ask-index.json'));
    await indexAt('public/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'public/ask-index.json'));
    // VitePress, in docs/ as `vitepress init` suggests, or at the root.
    await indexAt('docs/.vitepress/dist/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'docs/.vitepress/dist/ask-index.json'));
    await indexAt('.vitepress/dist/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, '.vitepress/dist/ask-index.json'));
    // An Astro site with an adapter: its static files, the index among them, go to dist/client.
    await indexAt('dist/client/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'dist/client/ask-index.json'));
    await indexAt('dist/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'dist/ask-index.json'));
    await indexAt('build/ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'build/ask-index.json'));
    await indexAt('ask-index.json');
    expect(findIndexFile(root)).toBe(join(root, 'ask-index.json'));
    expect(findIndexFile(root, 'dist/ask-index.json')).toBe(join(root, 'dist/ask-index.json'));
    expect(() => findIndexFile(root, 'nope.json')).toThrow('No index at nope.json.');
  });
});

describe('the models dev answers with', () => {
  it('embeds questions as the index was, and answers with OpenAI only when its key is set', async () => {
    const mock = await indexAt('mock.json', mockEmbeddingModel({ dimensions: 128 }));
    expect(await devModels(mock, {})).toMatchObject({
      embeddingModel: { modelId: 'mock-hash-128' },
      model: { modelId: 'mock-extractive' },
    });
    expect(await devModels(mock, { OPENAI_API_KEY: 'sk-test' })).toMatchObject({
      embeddingModel: { modelId: 'mock-hash-128' },
      model: { modelId: 'gpt-5.4-mini' },
      description: 'mock embeddings, answers from gpt-5.4-mini',
    });

    const { index: keywordOnly } = await buildIndex({ documents: corpus });
    const models = await devModels(keywordOnly, {});
    expect(models.embeddingModel).toBeUndefined();
    expect(models.description).toMatch(/^keyword-only retrieval/);

    const openai = { ...mock, embedding: { model: 'text-embedding-3-small', dimensions: 512 } };
    expect(await devModels(openai, { OPENAI_API_KEY: 'sk-test' }, 'gpt-5.4')).toMatchObject({
      embeddingModel: { modelId: 'text-embedding-3-small' },
      embeddingProviderOptions: { openai: { dimensions: 512 } },
      model: { modelId: 'gpt-5.4' },
    });
    expect(await devModels(openai, { AI_GATEWAY_API_KEY: 'gw' })).toMatchObject({
      embeddingModel: 'openai/text-embedding-3-small',
      model: 'openai/gpt-5.4-mini',
    });
  });

  it('refuses an index it cannot embed questions for, saying what would', async () => {
    const mock = await indexAt('mock.json');
    const openai = { ...mock, embedding: { model: 'text-embedding-3-small', dimensions: 512 } };
    await expect(devModels(openai, {})).rejects.toThrow(
      'The index was embedded with text-embedding-3-small, so questions must be too: set ' +
        'OPENAI_API_KEY or AI_GATEWAY_API_KEY. To try it without a key, rebuild the index with ' +
        '--embedding mock.',
    );
    const cohere = { ...mock, embedding: { model: 'embed-multilingual-v3.0', dimensions: 1024 } };
    await expect(devModels(cohere, { OPENAI_API_KEY: 'sk-test' })).rejects.toBeInstanceOf(DevError);
    await expect(devModels(cohere, { OPENAI_API_KEY: 'sk-test' })).rejects.toThrow(
      'cannot load: it embeds with OpenAI, AI Gateway, Workers AI or the mock model',
    );
  });

  it('embeds questions with OpenAI for an index OpenAI embedded', async () => {
    const stub = await startOpenAIStub();
    try {
      const openai = createOpenAI({ apiKey: 'sk-test', baseURL: stub.url });
      const { index } = await buildIndex({
        documents: corpus,
        embeddingModel: openai.embedding('text-embedding-3-small'),
        embeddingProviderOptions: { openai: { dimensions: 64 } },
      });
      await writeIndexFile(join(root, 'ask-index.json'), index);
      const { server, logs } = await serve('ask-index.json', {
        env: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: stub.url },
      });
      expect(server.description).toBe(
        'text-embedding-3-small embeddings from OpenAI, answers from gpt-5.4-mini',
      );
      const stream = await (await ask(server.endpoint, 'Upstash ratelimit')).text();
      expect(stream).toContain('"url":"/docs/rate-limits#upstash"');
      // The stub's answer, streamed through the OpenAI provider.
      expect(stream).toContain('"delta":"[1]."');
      // One for the index, one for the question, then the answer.
      expect(stub.requests).toEqual([
        'POST /v1/embeddings',
        'POST /v1/embeddings',
        'POST /v1/responses',
      ]);
      expect(logs.some((line) => line.startsWith('  ✗'))).toBe(false);
    } finally {
      await stub.close();
    }
  });
});

describe('ondocs dev on the command line', () => {
  async function run(args: string[], env: Record<string, string | undefined> = {}) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const controller = new AbortController();
    const code = main(['dev', ...args], {
      cwd: root,
      env,
      signal: controller.signal,
      stdout: (line) => {
        stdout.push(line);
        // Stop once it has said where it listens, after one question.
        const endpoint = /Endpoint {2}(\S+)/.exec(line)?.[1];
        if (endpoint) {
          void ask(endpoint, 'int8')
            .then((response) => response.text())
            .finally(() => {
              controller.abort();
            });
        }
      },
      stderr: (line) => stderr.push(line),
    });
    return { code: await code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }

  it('says where it listens and what to set, and stops when asked', async () => {
    await indexAt('build/ask-index.json');
    await indexAt('build/fr/ask-index.json');
    const result = await run(['--port', '0']);
    expect(result.code).toBe(0);
    const endpoint = /Endpoint {2}(\S+)/.exec(result.stdout)?.[1] ?? '';
    expect(result.stdout).toContain('build/ask-index.json');
    expect(result.stdout).toMatch(/\n {12}fr: build\/fr\/ask-index\.json \(\d+ chunks\)\n/);
    expect(result.stdout).toContain(`ASK_ENDPOINT=${endpoint}`);
    expect(result.stdout).toContain(`endpoint: '${endpoint}'`);
    expect(result.stdout).toContain(`<AskDialog endpoint="${endpoint}" />`);
    expect(result.stdout).toContain(`data-endpoint="${endpoint}"`);
    const mcp = endpoint.replace(/\/api\/ask$/, '/api/mcp');
    expect(result.stdout).toContain(`  MCP       ${mcp}\n`);
    expect(result.stdout).toContain(`Claude Code  claude mcp add --transport http docs ${mcp}\n`);
    expect(result.stdout).toContain(`Codex        codex mcp add docs --url ${mcp}\n`);
    expect(result.stdout).toContain(
      `Gemini CLI   gemini mcp add --transport http --scope user docs ${mcp}\n`,
    );
    expect(result.stdout).toMatch(/answered from \d sources: int8/);
    // It is stopped: the port no longer answers.
    await expect(ask(endpoint, 'int8')).rejects.toThrow();
  });

  it('exits 1 with the reason when the index cannot be served', async () => {
    expect((await run([])).stderr).toContain('No index found');
    const index = await indexAt('ask-index.json');
    await writeIndexFile(join(root, 'ask-index.json'), {
      ...index,
      embedding: { model: 'text-embedding-3-small', dimensions: 512 },
    });
    const mismatch = await run([]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.stderr).toContain('set OPENAI_API_KEY or AI_GATEWAY_API_KEY');
    expect((await run(['--port', 'x'])).code).toBe(2);
    expect((await run(['--help'])).stdout).toContain('Usage: ondocs dev [options]');
  });
});
