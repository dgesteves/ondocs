// Workers AI: building an index with its embedding models over Cloudflare's REST API (against a
// local stub, never Cloudflare), the relevance gate measured for BGE-small, and the zero-key
// Worker template, run in Node with a stand-in AI binding. The template's own tests run it in
// workerd (scripts/deploy-recipes.mjs workers-ai).
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildIndex,
  DEFAULT_RETRIEVAL,
  defaultMinSimilarity,
  loadIndex,
  parseIndexFile,
  retrieve,
  serializeIndexFile,
} from '../src';
import { devModels } from '../src/cli/dev';
import { main } from '../src/cli/main';
import { hashEmbedding } from '../src/mock';
import { embeddingFromSpec, EmbeddingSpecError } from '../src/node/embedding';
import { workersAiEmbedding } from '../src/node/workers-ai';
import { corpus } from './helpers';

const BGE = '@cf/baai/bge-small-en-v1.5';

/** An embedding model with BGE-small's id and size, offline: hashed words for vectors. */
const bgeStandIn = (dimensions = 384) => ({
  specificationVersion: 'v4' as const,
  provider: 'workers-ai',
  modelId: BGE,
  maxEmbeddingsPerCall: 100,
  supportsParallelCalls: true,
  doEmbed: ({ values }: { values: string[] }) =>
    Promise.resolve({ embeddings: values.map((v) => hashEmbedding(v, dimensions)), warnings: [] }),
});

/** Cloudflare's `POST /accounts/:id/ai/run/:model`, answering with fixed 384-dimension vectors. */
async function cloudflareStub() {
  const requests: { url: string; authorization: string | undefined; body: { text: string[] } }[] =
    [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const body = JSON.parse(raw) as { text: string[] };
      requests.push({ url: req.url ?? '', authorization: req.headers.authorization, body });
      if (req.headers.authorization !== 'Bearer cf-token') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          errors: [],
          result: {
            shape: [body.text.length, 384],
            data: body.text.map((t) => hashEmbedding(t, 384)),
          },
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}/client/v4`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      }),
  };
}

describe('workers-ai:@cf/<model> embeddings', () => {
  it('embed with Workers AI over the REST API, as the binding sends them', async () => {
    const stub = await cloudflareStub();
    try {
      const model = workersAiEmbedding(BGE, {
        accountId: 'acct',
        apiToken: 'cf-token',
        baseUrl: stub.url,
      });
      const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
      expect(index.embedding).toEqual({ model: BGE, dimensions: 384 });
      expect(stub.requests[0]?.url).toBe(`/client/v4/accounts/acct/ai/run/${BGE}`);
      expect(Object.keys(stub.requests[0]?.body ?? {})).toEqual(['text']);
    } finally {
      await stub.close();
    }
  });

  it('send at most 100 texts a request (32 for Qwen3), and say why a request failed', async () => {
    expect(workersAiEmbedding(BGE, { accountId: 'a', apiToken: 't' }).maxEmbeddingsPerCall).toBe(
      100,
    );
    expect(
      workersAiEmbedding('@cf/qwen/qwen3-embedding-0.6b', { accountId: 'a', apiToken: 't' })
        .maxEmbeddingsPerCall,
    ).toBe(32);
    const stub = await cloudflareStub();
    try {
      const model = workersAiEmbedding(BGE, {
        accountId: 'a',
        apiToken: 'wrong',
        baseUrl: stub.url,
      });
      await expect(model.doEmbed({ values: ['hello'] })).rejects.toThrow(
        `Workers AI ${BGE}: HTTP 401, Authentication error.`,
      );
    } finally {
      await stub.close();
    }
  });

  it('need the account id and a token to build, and none to check', async () => {
    await expect(embeddingFromSpec(`workers-ai:${BGE}`, { env: {} })).rejects.toThrow(
      'needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN',
    );
    expect(await embeddingFromSpec(`workers-ai:${BGE}`, { env: {}, mode: 'check' })).toEqual({
      model: BGE,
    });
    await expect(
      embeddingFromSpec(`workers-ai:${BGE}`, { env: {}, dimensions: 256 }),
    ).rejects.toThrow(EmbeddingSpecError);
    await expect(embeddingFromSpec('workers-ai:bge-small', { env: {} })).rejects.toThrow(
      'Unknown embedding "workers-ai:bge-small"',
    );
  });

  describe('from the CLI', () => {
    let cwd: string;
    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), 'ondocs-workers-ai-'));
      await mkdir(join(cwd, 'docs'));
      await writeFile(join(cwd, 'docs/deploy.md'), '# Deploy\n\nDeploy it to GitHub Pages.\n');
    });
    afterEach(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    it('builds and checks an index with -e workers-ai:@cf/<model>', async () => {
      const stub = await cloudflareStub();
      const env = {
        CLOUDFLARE_ACCOUNT_ID: 'acct',
        CLOUDFLARE_API_TOKEN: 'cf-token',
        CLOUDFLARE_API_BASE_URL: stub.url,
      };
      const io = { cwd, env, stdout: () => undefined, stderr: () => undefined };
      try {
        expect(await main(['index', 'docs', '-e', `workers-ai:${BGE}`], io)).toBe(0);
        const index = parseIndexFile(await readFile(join(cwd, 'ask-index.json'), 'utf8'));
        expect(index.embedding).toEqual({ model: BGE, dimensions: 384 });
        expect(
          await main(['index', 'docs', '-e', `workers-ai:${BGE}`, '--check'], { ...io, env: {} }),
        ).toBe(0);
      } finally {
        await stub.close();
      }
    });
  });

  it('are what ondocs dev embeds questions with, given the account', async () => {
    const { index } = await buildIndex({ documents: corpus, embeddingModel: bgeStandIn() });
    const models = await devModels(index, {
      CLOUDFLARE_ACCOUNT_ID: 'a',
      CLOUDFLARE_API_TOKEN: 't',
    });
    expect(models.description).toBe(
      `${BGE} embeddings from Workers AI, answers from the mock model, which quotes the sources`,
    );
    await expect(devModels(index, {})).rejects.toThrow(
      'set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN',
    );
  });
});

describe('the relevance gate for BGE-small', () => {
  it('is the 0.65 measured on docusaurus.io, unless the options set one', async () => {
    expect(defaultMinSimilarity(BGE)).toBe(0.65);
    expect(defaultMinSimilarity('text-embedding-3-small')).toBe(DEFAULT_RETRIEVAL.minSimilarity);
    expect(defaultMinSimilarity(undefined)).toBe(DEFAULT_RETRIEVAL.minSimilarity);

    // One chunk, and a question whose vector is 0.6 similar to it, sharing no word with it.
    const { index } = await buildIndex({
      documents: [{ id: 'a', url: '/a', title: 'A', content: 'Pineapple orchards grow slowly.' }],
      embeddingModel: {
        specificationVersion: 'v4',
        provider: 'workers-ai',
        modelId: BGE,
        maxEmbeddingsPerCall: 100,
        supportsParallelCalls: true,
        doEmbed: ({ values }) =>
          Promise.resolve({ embeddings: values.map(() => [1, 0, 0]), warnings: [] }),
      },
    });
    const loaded = loadIndex(serializeIndexFile(index));
    const query = { text: 'zebra', vector: [0.6, 0.8, 0] };
    expect(retrieve(loaded, query).answerable).toBe(false);
    expect(retrieve(loaded, query, { minSimilarity: 0.5 }).answerable).toBe(true);
  });
});

describe('the Cloudflare Worker template', () => {
  const template = new URL('../templates/cloudflare-worker/src/index.ts', import.meta.url).href;
  const SITE = 'https://acme.github.io/docs';
  const CHAT = '@cf/meta/llama-4-scout-17b-16e-instruct';

  /** A stand-in for Workers AI's binding: BGE-small vectors, and a streamed answer. */
  function binding(answer = 'Deploy it with the workflow [1].') {
    const calls: { model: string; inputs: Record<string, unknown> }[] = [];
    return {
      calls,
      run: (model: string, inputs: Record<string, unknown>) => {
        calls.push({ model, inputs });
        if (model === BGE) {
          const text = inputs.text as string[];
          return Promise.resolve({
            shape: [text.length, 384],
            data: text.map((t) => hashEmbedding(t, 384)),
          });
        }
        const words = answer.match(/\S+\s*/g) ?? [];
        const sse = `${words.map((w) => `data: ${JSON.stringify({ response: w })}\n\n`).join('')}data: [DONE]\n\n`;
        return Promise.resolve(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse));
              controller.close();
            },
          }),
        );
      },
    };
  }

  async function worker(embedding: 'bge' | 'none' | 'openai') {
    const { index } = await buildIndex({
      documents: corpus,
      embeddingModel:
        embedding === 'none'
          ? null
          : {
              specificationVersion: 'v4',
              provider: 'test',
              modelId: embedding === 'bge' ? BGE : 'text-embedding-3-small',
              maxEmbeddingsPerCall: 100,
              supportsParallelCalls: true,
              doEmbed: ({ values }) =>
                Promise.resolve({
                  embeddings: values.map((v) => hashEmbedding(v, embedding === 'bge' ? 384 : 512)),
                  warnings: [],
                }),
            },
    });
    const text = serializeIndexFile(index);
    const site: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo) => {
      const url = new Request(input).url;
      site.push(url);
      return Promise.resolve(
        url === `${SITE}/ask-index.json`
          ? new Response(text, { headers: { etag: '"1"' } })
          : new Response(null, { status: 404 }),
      );
    });
    vi.resetModules();
    const module = (await import(/* @vite-ignore */ template)) as {
      default: { fetch: (request: Request, env: unknown) => Promise<Response> };
    };
    const ai = binding();
    const env = { SITE_URL: SITE, CHAT_MODEL: CHAT, AI: ai };
    const ask = (question: string) =>
      module.default.fetch(
        new Request('https://acme-ask.example.workers.dev/api/ask', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://acme.github.io',
            'cf-connecting-ip': '203.0.113.5',
          },
          body: JSON.stringify({ question }),
        }),
        env,
      );
    return { ask, ai, site, fetch: module.default.fetch, env };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers from the live site’s index with Workers AI, for the site’s origin only', async () => {
    const { ask, ai, site } = await worker('bge');
    const response = await ask('How do I rate limit with Upstash?');
    const text = await response.text();
    expect(response.headers.get('access-control-allow-origin')).toBe('https://acme.github.io');
    // The dialog, on the site's origin, reads Retry-After on a 429.
    expect(response.headers.get('access-control-expose-headers')).toBe('retry-after');
    expect(text).toContain('"url":"/docs/rate-limits#upstash"');
    expect(text).toContain('"retrieval":"hybrid"');
    expect([...text.matchAll(/"delta":"([^"]*)"/g)].map((m) => m[1]).join('')).toBe(
      'Deploy it with the workflow [1].',
    );
    expect(ai.calls.map((call) => call.model)).toEqual([BGE, CHAT]);
    expect(site).toEqual([`${SITE}/ask-index.json`]);
  });

  it('searches a keyword-only index without embedding the question', async () => {
    const { ask, ai } = await worker('none');
    const text = await (await ask('How do I rate limit with Upstash?')).text();
    expect(text).toContain('"retrieval":"keyword"');
    expect(ai.calls.map((call) => call.model)).toEqual([CHAT]);
  });

  it('falls back to keywords for an index embedded with another provider’s model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ask, ai } = await worker('openai');
    const text = await (await ask('How do I rate limit with Upstash?')).text();
    expect(text).toContain('"retrieval":"keyword"');
    expect(ai.calls.map((call) => call.model)).toEqual([CHAT]);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'embedded with text-embedding-3-small, which Workers AI does not run',
    );
  });

  it('reads SITE_URL without its trailing slashes, and quickly on a long run of slashes', async () => {
    const slashed = await worker('bge');
    slashed.env.SITE_URL = `${SITE}///`;
    expect((await slashed.ask('How do I rate limit with Upstash?')).status).toBe(200);
    expect(slashed.site).toEqual([`${SITE}/ask-index.json`]);

    // Over 40 s before: `/\/+$/` started a match at each slash of the run, once to fetch the
    // index and once for the CORS headers of the error.
    const { ask, env } = await worker('bge');
    env.SITE_URL = `${SITE}/a${'/'.repeat(100_000)}x`;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const start = performance.now();
    const response = await ask('How do I rate limit with Upstash?');
    expect(performance.now() - start).toBeLessThan(1000);
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://acme.github.io');
  });

  it('refuses without calling the model, and answers 500 while the site has no index', async () => {
    const { ask, ai, env } = await worker('bge');
    expect(await (await ask('What is the capital of France?')).text()).toContain("I don't know");
    expect(ai.calls.map((call) => call.model)).toEqual([BGE]);

    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = (await import(/* @vite-ignore */ template)) as {
      default: { fetch: (request: Request, env: unknown) => Promise<Response> };
    };
    const response = await fresh.default.fetch(
      new Request('https://acme-ask.example.workers.dev/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"question":"x"}',
      }),
      env,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://acme.github.io');
  });
});
