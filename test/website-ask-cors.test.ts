// The website's /api/ask (examples/nextjs/app/api/ask) answers the live demos' dialogs from their
// own origins, and no other origin.
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ORIGINS } from '../examples/nextjs/app/api/ask/cors';

type Handler = (request: Request) => Promise<Response>;
// Imported by path, so the typecheck does not follow it to the site's index, which only its build
// writes.
const route = 'app/api/ask/route.ts';
const { OPTIONS, POST } = (await import(/* @vite-ignore */ `../examples/nextjs/${route}`)) as {
  OPTIONS: Handler;
  POST: Handler;
};

// The route's handler, with this repository's test corpus and the offline models in place of the
// site's index (written by its build) and OpenAI.
vi.mock('../examples/nextjs/lib/ask-handler', async () => {
  const { buildIndex } = await import('../src');
  const { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } =
    await import('../src/mock');
  const { createAskHandler } = await import('../src/server');
  const { corpus } = await import('./helpers');
  const embeddingModel = mockEmbeddingModel();
  const { index } = await buildIndex({ documents: corpus, embeddingModel });
  return {
    askHandler: createAskHandler({
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      rateLimit: false,
    }),
  };
});

const URL = 'https://ondocs.vercel.app/api/ask';
const DEMOS = [
  'https://ondocs-docusaurus.vercel.app',
  'https://ondocs-starlight.vercel.app',
  'https://ondocs-vitepress.vercel.app',
];

const preflight = (origin: string) =>
  OPTIONS(
    new Request(URL, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    }),
  );

const ask = (origin?: string) =>
  POST(
    new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify({ question: 'How do I install with pnpm?' }),
    }),
  );

describe("the website's /api/ask CORS", () => {
  it('allows the three demos’ origins, and only those', () => {
    expect([...DEMO_ORIGINS].sort()).toEqual(DEMOS);
  });

  it('answers a demo’s preflight with CORS headers for that origin', async () => {
    for (const origin of DEMOS) {
      const response = await preflight(origin);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
      expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
      expect(response.headers.get('vary')).toMatch(/origin/i);
    }
  });

  it('streams a demo its answer with CORS headers', async () => {
    const response = await ask('https://ondocs-starlight.vercel.app');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://ondocs-starlight.vercel.app',
    );
    expect(response.headers.get('access-control-expose-headers')).toBe('retry-after');
    const body = await response.text();
    expect(body).toContain('"type":"source-url"');
    expect(body).toContain('"type":"finish"');
  });

  it('gives any other origin no CORS headers, on the preflight or the answer', async () => {
    for (const origin of [
      'https://evil.example',
      'https://ondocs-docusaurus.vercel.app.evil.example',
      'https://ondocs-docusaurus-git-main-someone.vercel.app',
      'http://ondocs-vitepress.vercel.app',
      'null',
    ]) {
      const response = await preflight(origin);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-methods')).toBeNull();
      const answer = await ask(origin);
      expect(answer.headers.get('access-control-allow-origin')).toBeNull();
      await answer.body?.cancel();
    }
  });

  it('answers the site’s own dialog as before, without CORS headers', async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await response.body?.cancel();
  });
});
