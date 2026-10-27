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
  withMemoryFallback: (
    shared: BudgetStore,
    options?: { log?: (line: string) => void; now?: () => number },
  ) => BudgetStore;
  TURNSTILE_HOSTNAMES: string[];
  UPSTASH_TIMEOUT_MS: number;
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

  it('is each instance’s memory while next build runs, so the build spends none of it', () => {
    expect(site.budgetStore({ ...KV, NEXT_PHASE: 'phase-production-build' })).toBeUndefined();
    expect(site.budgetStore({ ...KV, NEXT_PHASE: 'phase-production-server' })).toBeDefined();
  });

  it('asks Upstash uncached, and throws an error naming Upstash and the command', async () => {
    const redis = (answer: typeof fetch) =>
      site.upstashRest(KV.KV_REST_API_URL, KV.KV_REST_API_TOKEN, answer);
    const inits: RequestInit[] = [];
    await redis((_, init) => {
      inits.push(init ?? {});
      return Promise.resolve(Response.json({ result: '7' }));
    }).incrby('key', 1);
    expect(inits[0]?.cache).toBe('no-store');
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);

    for (const [answer, message] of [
      [
        () =>
          Promise.resolve(Response.json({ error: 'WRONGPASS invalid password' }, { status: 401 })),
        'Upstash answered INCRBY with HTTP 401: WRONGPASS invalid password',
      ],
      [
        () => Promise.resolve(new Response('<html>oops</html>', { status: 500 })),
        'Upstash answered INCRBY with HTTP 500',
      ],
      [
        () => Promise.resolve(Response.json({ result: 'QUEUED' })),
        'Upstash answered INCRBY with a result that is not a number',
      ],
      [
        () => Promise.resolve(new Response('OK but not JSON')),
        'Upstash answered INCRBY with a result that is not a number',
      ],
      [() => Promise.reject(refused()), 'Upstash could not be reached for INCRBY (ECONNREFUSED)'],
    ] as const) {
      const error = await redis(answer)
        .incrby('key', 1)
        .then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
      expect(error, message).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(message);
      expect((error as Error).message).not.toMatch(/kv\.example|stand-in-token/);
    }
  });

  it('gives up on Upstash after 1.5 s, and says so', async () => {
    expect(site.UPSTASH_TIMEOUT_MS).toBe(1_500);
    const redis = site.upstashRest(KV.KV_REST_API_URL, KV.KV_REST_API_TOKEN, hang);
    const started = performance.now();
    await expect(redis.incrby('key', 1)).rejects.toThrow(
      'Upstash did not answer INCRBY within 1.5 s',
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('counts in memory while Upstash fails, logs it once a minute, and goes back to Upstash', async () => {
    let time = 0;
    let up = false;
    let shared = 100;
    const lines: string[] = [];
    const store = site.withMemoryFallback(
      {
        increment: (_key, amount) =>
          up
            ? Promise.resolve((shared += amount))
            : Promise.reject(new Error('Upstash did not answer INCRBY within 1.5 s')),
      },
      { log: (line) => lines.push(line), now: () => time },
    );
    const key = 'ask-my-site:budget:requests:2026-10-27';
    // This instance's own count, from 0, as without the Upstash keys.
    expect(await store.increment(key, 1, 172_800)).toBe(1);
    expect(await store.increment(key, 1, 172_800)).toBe(2);
    expect(lines).toEqual([
      'The Upstash budget store failed, so this instance counts in memory: Upstash did not answer INCRBY within 1.5 s.',
    ]);
    // Upstash answers again: the next count is the shared one.
    up = true;
    expect(await store.increment(key, 1, 172_800)).toBe(101);
    up = false;
    time += 30_000;
    expect(await store.increment(key, 1, 172_800)).toBe(3);
    expect(lines).toHaveLength(1);
    time += 30_000;
    expect(await store.increment(key, 1, 172_800)).toBe(4);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/\(3 failures since the last line\)\.$/);
  });
});

/** A connection refused, as fetch reports it: its message is fetch's, the cause has the code. */
function refused(): Error {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4419'), {
      code: 'ECONNREFUSED',
    }),
  });
}

/** Upstash that never answers: the request ends only when its signal aborts it, as fetch's does. */
const hang: typeof fetch = (_, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () => {
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort);
  });

describe('the website’s endpoint while Upstash fails', () => {
  // A hang ends at the Upstash timeout: here at once, as AbortSignal.timeout(1_500) is already
  // aborted, and the test before shows the real wait.
  const instantTimeout = () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
      ms === site.UPSTASH_TIMEOUT_MS
        ? AbortSignal.abort(
            new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
          )
        : timeout(ms),
    );
  };
  const upstashFailures: [string, typeof fetch, string][] = [
    [
      'refuses connections',
      () => Promise.reject(refused()),
      'Upstash could not be reached for INCRBY (ECONNREFUSED)',
    ],
    [
      'answers 500',
      () => Promise.resolve(new Response('<html>oops</html>', { status: 500 })),
      'Upstash answered INCRBY with HTTP 500',
    ],
    ['hangs', hang, 'Upstash did not answer INCRBY within 1.5 s'],
    [
      'answers 200 without a count',
      () => Promise.resolve(Response.json({ result: 'QUEUED' })),
      'Upstash answered INCRBY with a result that is not a number',
    ],
  ];

  it.each(upstashFailures)('answers from memory when Upstash %s', async (_, upstash, reason) => {
    instantTimeout();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== KV.KV_REST_API_URL) return Promise.reject(new Error(`unexpected ${url}`));
      return upstash(input, init);
    });
    vi.stubGlobal('fetch', fetcher);
    for (const [name, value] of Object.entries(KV)) vi.stubEnv(name, value);
    for (const name of Object.keys(KEYS)) vi.stubEnv(name, '');
    vi.resetModules();
    const { askHandler } = await load();
    const ask = (question: string) =>
      askHandler(
        new Request('https://ondocs.vercel.app/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '2001:db8:7::1' },
          body: JSON.stringify({ question }),
        }),
      );
    const answered = await ask('How do I install with pnpm?');
    expect(answered.status).toBe(200);
    await answered.text();
    // It asked Upstash for the question and the tokens, and logged one line.
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(warn.mock.calls).toEqual([
      [`The Upstash budget store failed, so this instance counts in memory: ${reason}.`],
    ]);
    // A second question, uncached, tries Upstash again, and is answered too.
    const calls = fetcher.mock.calls.length;
    const again = await ask('How do I build the index?');
    expect(again.status).toBe(200);
    await again.text();
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
    expect(warn).toHaveBeenCalledTimes(1);
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
