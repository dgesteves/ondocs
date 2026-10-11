// The Worker with its bot check on: TURNSTILE_SECRET_KEY set to Cloudflare's always-passing test
// secret, and Turnstile's siteverify stood in for, as that secret makes it answer. A file of its
// own, as the Worker keeps its handlers from the first request on.
import { buildIndex, serializeIndexFile } from 'ondocs';
import { hashEmbedding } from 'ondocs/mock';
import { env } from 'cloudflare:test';
import { beforeAll, expect, it, vi } from 'vitest';

import worker from '../src/index';

const EMBEDDING = '@cf/baai/bge-small-en-v1.5';
/** Cloudflare's test secret that always passes, and the only token it accepts. */
const SECRET = '1x0000000000000000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const vectors = (texts: string[]) => texts.map((text) => hashEmbedding(text, 384));
const verified: string[] = [];

beforeAll(async () => {
  const { index } = await buildIndex({
    documents: [
      {
        id: 'deploy.md',
        url: '/docs/deploy',
        title: 'Deploying',
        content: '## GitHub Pages\n\nDeploy the site to GitHub Pages with the deploy workflow.',
      },
    ],
    embeddingModel: {
      specificationVersion: 'v4',
      provider: 'workers-ai',
      modelId: EMBEDDING,
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: ({ values }) => Promise.resolve({ embeddings: vectors(values), warnings: [] }),
    },
  });
  const text = serializeIndexFile(index);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === SITEVERIFY) {
      const { secret, response } = await request.json<{ secret: string; response: string }>();
      verified.push(response);
      return Response.json({ success: secret === SECRET && response === TOKEN });
    }
    return request.url === `${env.SITE_URL}/ask-index.json`
      ? new Response(text, { headers: { etag: '"1"' } })
      : new Response(null, { status: 404 });
  });
  vi.spyOn(env.AI, 'run').mockImplementation(((model: string, inputs: { text?: string[] }) =>
    Promise.resolve(
      model === EMBEDDING
        ? { shape: [inputs.text?.length ?? 0, 384], data: vectors(inputs.text ?? []) }
        : { response: 'Use the deploy workflow [1].', usage: { total_tokens: 100 } },
    )) as never);
});

const withSecret = { ...env, TURNSTILE_SECRET_KEY: SECRET };
const origin = new URL(env.SITE_URL).origin;
const ask = (body: object) =>
  worker.fetch(
    new Request('https://ask.example.workers.dev/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': '203.0.113.1' },
      body: JSON.stringify(body),
    }),
    withSecret,
  );

it('refuses a question without a token, for the site’s origin to read', async () => {
  const response = await ask({ question: 'How do I deploy to GitHub Pages?' });
  expect(response.status).toBe(403);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(await response.json()).toMatchObject({ error: { code: 'challenge_required' } });
});

it('answers a question whose token Turnstile passes', async () => {
  const response = await ask({ question: 'How do I deploy to GitHub Pages?', challenge: TOKEN });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"url":"/docs/deploy#github-pages"');
  expect(verified).toEqual([TOKEN]);
});

it('serves agents over MCP without a token', async () => {
  const response = await worker.fetch(
    new Request('https://ask.example.workers.dev/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'GitHub Pages' } },
      }),
    }),
    withSecret,
  );
  expect(await response.text()).toContain(`"url":"${origin}/docs/deploy#github-pages"`);
  expect(verified).toEqual([TOKEN]);
});
