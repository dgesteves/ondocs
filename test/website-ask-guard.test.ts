// The website's /api/ask (examples/nextjs/lib/ask-handler.ts) dogfoods the bot check and the
// shared budget the docs recommend, each switched on by the keys the deployment has: Turnstile's
// two keys, and the Upstash database's REST URL and token. Without them it is as before. Every
// key here is a stand-in, and nothing reaches Cloudflare or Upstash: `fetch` is replaced.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetStore, ChallengeVerifier, UpstashRedisCounterLike } from '../src/server';

type Handler = (request: Request) => Promise<Response>;
type Env = Record<string, string | undefined>;

// Offline: the mock embedder (ondocs.config.mjs) and the mock model (lib/ai.ts), as without a key.
vi.stubEnv('OPENAI_API_KEY', '');
afterAll(() => {
  vi.unstubAllEnvs();
});

// The site's index, as in test/website-ask-cors.test.ts: the test corpus stands in for it.
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

interface AskHandlerModule {
  askHandler: Handler;
  askChallenge: (env: Env) => ChallengeVerifier | undefined;
  budgetStore: (env: Env, fetcher?: typeof fetch) => BudgetStore | undefined;
  upstashRest: (url: string, token: string, fetcher?: typeof fetch) => UpstashRedisCounterLike;
  TURNSTILE_HOSTNAMES: string[];
}
// Imported by path, so the typecheck does not follow it to the site's index.
const handlerModule = 'lib/ask-handler.ts';
const load = async () =>
  (await import(/* @vite-ignore */ `../examples/nextjs/${handlerModule}`)) as AskHandlerModule;
const site = await load();

const KEYS = {
  TURNSTILE_SECRET_KEY: 'stand-in-secret',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'stand-in-site-key',
};
const KV = {
  KV_REST_API_URL: 'https://kv.example.upstash.io',
  KV_REST_API_TOKEN: 'stand-in-token',
};
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the bot check on the website’s endpoint', () => {
  it('is on only with both of the widget’s keys, and off while next build runs', () => {
    expect(site.askChallenge({})).toBeUndefined();
    expect(site.askChallenge({ TURNSTILE_SECRET_KEY: KEYS.TURNSTILE_SECRET_KEY })).toBeUndefined();
    expect(
      site.askChallenge({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: KEYS.NEXT_PUBLIC_TURNSTILE_SITE_KEY }),
    ).toBeUndefined();
    expect(site.askChallenge({ ...KEYS, NEXT_PHASE: 'phase-production-build' })).toBeUndefined();
    expect(site.askChallenge(KEYS)).toBeTypeOf('function');
  });

  it('accepts tokens solved on the site or a live demo, and no other hostname', async () => {
    expect(site.TURNSTILE_HOSTNAMES).toEqual([
      'ondocs.vercel.app',
      'ondocs-starlight.vercel.app',
      'ondocs-docusaurus.vercel.app',
      'ondocs-vitepress.vercel.app',
    ]);
    let hostname = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ success: true, hostname }))),
    );
    const verify = site.askChallenge(KEYS);
    const request = new Request('https://ondocs.vercel.app/api/ask', { method: 'POST' });
    hostname = 'ondocs-starlight.vercel.app';
    expect(await verify?.('token', request)).toEqual({ success: true });
    hostname = 'elsewhere.example';
    expect((await verify?.('token', request))?.success).toBe(false);
  });
});

describe('the daily budget’s store', () => {
  it('is each instance’s memory without the Upstash keys', () => {
    expect(site.budgetStore({})).toBeUndefined();
    expect(site.budgetStore({ KV_REST_API_URL: KV.KV_REST_API_URL })).toBeUndefined();
  });

  it('is the Upstash database with them, through its REST API', async () => {
    const commands: unknown[] = [];
    const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      expect(input instanceof Request ? input.url : String(input)).toBe(KV.KV_REST_API_URL);
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${KV.KV_REST_API_TOKEN}`,
      );
      const command = JSON.parse(init?.body as string) as string[];
      commands.push(command);
      return Promise.resolve(Response.json({ result: command[0] === 'INCRBY' ? 7 : 1 }));
    });
    const store = site.budgetStore(KV, fetcher);
    // The increment that creates a counter gives it its lifetime.
    expect(await store?.increment('ask-my-site:budget:requests:2026-10-27', 7, 172_800)).toBe(7);
    expect(commands).toEqual([
      ['INCRBY', 'ask-my-site:budget:requests:2026-10-27', '7'],
      ['EXPIRE', 'ask-my-site:budget:requests:2026-10-27', '172800'],
    ]);
  });

  it('throws on an Upstash error, which the endpoint answers with a 503', async () => {
    const redis = site.upstashRest(KV.KV_REST_API_URL, KV.KV_REST_API_TOKEN, () =>
      Promise.resolve(Response.json({ error: 'WRONGPASS invalid password' }, { status: 401 })),
    );
    await expect(redis.incrby('key', 1)).rejects.toThrow(
      'Upstash answered INCRBY with HTTP 401: WRONGPASS invalid password',
    );
  });
});

describe('the website’s endpoint, deployed with the keys', () => {
  it('refuses a question without a token, and counts the budget in Upstash', async () => {
    const counts = new Map<string, number>();
    const upstash: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const body = JSON.parse(init?.body as string) as Record<string, unknown> | string[];
        if (url === SITEVERIFY) {
          const { response } = body as Record<string, string>;
          return Promise.resolve(
            Response.json({ success: response === 'good-token', hostname: 'ondocs.vercel.app' }),
          );
        }
        if (url !== KV.KV_REST_API_URL) return Promise.reject(new Error(`unexpected ${url}`));
        const [command = '', key = '', amount = '0'] = body as string[];
        upstash.push(command);
        if (command === 'INCRBY') counts.set(key, (counts.get(key) ?? 0) + Number(amount));
        return Promise.resolve(Response.json({ result: counts.get(key) ?? 1 }));
      }),
    );
    for (const [name, value] of Object.entries({ ...KEYS, ...KV })) vi.stubEnv(name, value);
    vi.resetModules();
    const { askHandler } = await load();
    const ask = (body: Record<string, unknown>) =>
      askHandler(
        new Request('https://ondocs.vercel.app/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '2001:db8:9::1' },
          body: JSON.stringify(body),
        }),
      );

    const refused = await ask({ question: 'How do I install with pnpm?' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'challenge_required' } });
    expect(upstash).toEqual([]);

    const answered = await ask({
      question: 'How do I install with pnpm?',
      challenge: 'good-token',
    });
    expect(answered.status).toBe(200);
    await answered.text();
    expect(upstash).toContain('INCRBY');
    expect([...counts.keys()].some((key) => key.includes('budget:requests:'))).toBe(true);
  });
});
