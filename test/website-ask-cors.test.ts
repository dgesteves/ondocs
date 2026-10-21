// The website's /api/ask (examples/nextjs/app/api/ask) answers the live demos' dialogs from their
// own origins, and no other origin, through the handler's `allowedOrigins`.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_ORIGINS } from '../examples/nextjs/lib/site';

type Handler = (request: Request) => Promise<Response>;

// Offline: the mock embedder (ondocs.config.mjs) and the mock model (lib/ai.ts), as without a key.
vi.stubEnv('OPENAI_API_KEY', '');
afterAll(() => {
  vi.unstubAllEnvs();
});

// The site's index is written by its build: this repository's test corpus stands in, embedded
// with the model the site's config picks without a key. It is mocked by the file's path, once a
// build has written it, and by the name the site imports it by, as a fresh clone has no file.
const { siteIndex } = vi.hoisted(() => ({
  siteIndex: async () => {
    const { buildIndex } = await import('../src');
    const { mockEmbeddingModel } = await import('../src/mock');
    const { corpus } = await import('./helpers');
    const embeddingModel = mockEmbeddingModel();
    return { default: (await buildIndex({ documents: corpus, embeddingModel })).index };
  },
}));
vi.mock('../examples/nextjs/ask-index.json', siteIndex);
vi.mock('../ask-index.json', siteIndex);

// The route as the site serves it, with its handler's own options. Imported by path, so the
// typecheck does not follow it to the site's index, which only its build writes.
const route = 'app/api/ask/route.ts';
const { OPTIONS, POST } = (await import(/* @vite-ignore */ `../examples/nextjs/${route}`)) as {
  OPTIONS: Handler;
  POST: Handler;
};

beforeEach(() => {
  // The counter lines each question logs (lib/counters.ts).
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
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

// Each question from a client of its own (one IPv6 /64 each), under the site's rate limit.
let client = 0;
const ask = (origin?: string) => {
  client += 1;
  return POST(
    new Request(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `2001:db8:0:${client.toString(16)}::1`,
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ question: 'How do I install with pnpm?' }),
    }),
  );
};

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

  it('lets a demo read Retry-After when its visitor is rate-limited', async () => {
    const origin = 'https://ondocs-vitepress.vercel.app';
    const statuses: number[] = [];
    let limited: Response | undefined;
    for (let n = 0; n < 10 && !limited; n++) {
      const response = await POST(
        new Request(URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '2001:db8:1::1',
            origin,
          },
          body: JSON.stringify({ question: `Does plugh frobnicate xyzzy ${String(n)}?` }),
        }),
      );
      statuses.push(response.status);
      if (response.status === 429) limited = response;
      else await response.text();
    }
    // The site's limit: a burst of five questions a minute.
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(limited?.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(limited?.headers.get('access-control-allow-origin')).toBe(origin);
    expect(limited?.headers.get('access-control-expose-headers')).toBe('retry-after');
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
    for (const origin of [undefined, 'https://ondocs.vercel.app']) {
      const response = await ask(origin);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      await response.body?.cancel();
    }
  });
});
