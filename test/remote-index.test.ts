import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildIndex, serializeIndexFile } from '../src';
import { mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { createAskHandler, createMcpHandler, remoteIndex } from '../src/server';
import { corpus } from './helpers';

const URL_ = 'https://acme.github.io/docs/ask-index.json';

async function indexText(documents = corpus, embeddingModel = mockEmbeddingModel()) {
  const { index } = await buildIndex({ documents, embeddingModel });
  return serializeIndexFile(index);
}

/** A site serving `current()` with an ETag, answering conditional requests with 304. */
function site(current: () => string) {
  const requests: Request[] = [];
  let failing = false;
  const fetch = (request: Request): Promise<Response> => {
    requests.push(request);
    if (failing) return Promise.resolve(new Response('down', { status: 503 }));
    const body = current();
    const etag = `"${String(body.length)}-${body.slice(-40).replace(/\W/g, '')}"`;
    if (request.headers.get('if-none-match') === etag) {
      return Promise.resolve(new Response(null, { status: 304 }));
    }
    return Promise.resolve(new Response(body, { headers: { etag } }));
  };
  return {
    fetch,
    requests,
    fail: (value: boolean) => {
      failing = value;
    },
  };
}

/** A site that never answers, and ignores the request's signal. */
const hang = (): Promise<Response> => new Promise(() => undefined);

/** A file's first bytes, then nothing more: the connection drops with `error`, or stalls. */
function cutOff(text: string, error?: Error): Response {
  const bytes = new TextEncoder().encode(text.slice(0, 100));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        if (error) controller.error(error);
      },
    }),
  );
}

/** What `promise` settles with within `ms`, or `'no answer'`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'no answer'> {
  return Promise.race([
    promise,
    new Promise<'no answer'>((resolve) => {
      setTimeout(() => {
        resolve('no answer');
      }, ms);
    }),
  ]);
}

describe('remoteIndex', () => {
  // Here, not in a finally: a test that times out never reaches its finally, and the fake timers
  // would stall every test after it.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the index once, then keeps it until it is time to check again', async () => {
    const text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now, revalidateSeconds: 60 });
    const first = await index();
    expect(first.documents.length).toBe(corpus.length);
    expect(await index()).toBe(first);
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]?.url).toBe(URL_);

    // A minute later it asks again, conditionally, and keeps its copy on a 304.
    now = 61_000;
    expect(await index()).toBe(first);
    expect(host.requests).toHaveLength(2);
    expect(host.requests[1]?.headers.get('if-none-match')).toMatch(/^"/);
  });

  it('loads the new index once the site is redeployed', async () => {
    let text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now });
    const before = await index();
    text = await indexText(corpus.slice(0, 2));
    now = 301_000;
    const after = await index();
    expect(after).not.toBe(before);
    expect(after.documents.length).toBe(2);
  });

  it('keeps the index it has while the site is down, and fails only the first fetch', async () => {
    const text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now, revalidateSeconds: 1 });
    host.fail(true);
    await expect(index()).rejects.toThrow(`Could not fetch the index at ${URL_}: HTTP 503.`);
    host.fail(false);
    const loaded = await index();
    host.fail(true);
    now = 5_000;
    expect(await index()).toBe(loaded);
  });

  it('keeps the index it has when the new file does not parse', async () => {
    let text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now });
    const loaded = await index();
    text = '{ "format": "half-deployed"';
    now = 400_000;
    expect(await index()).toBe(loaded);
  });

  it('keeps answering from the index it has when the site hangs during a check', async () => {
    const text = await indexText();
    const requests: Request[] = [];
    const fetch = (request: Request) => {
      requests.push(request);
      return requests.length === 1 ? Promise.resolve(new Response(text)) : hang();
    };
    let now = 0;
    const index = remoteIndex(URL_, { fetch, now: () => now, timeoutSeconds: 0.05 });
    const loaded = await index();

    // Five minutes later the site stops answering. The visitor who finds the index due waits for
    // the check; one who arrives during it is answered at once from the index in hand.
    now = 301_000;
    const first = index();
    expect(await within(index(), 20)).toBe(loaded);
    expect(await within(first, 20)).toBe('no answer');
    expect(requests).toHaveLength(2);

    // The check is given up after timeoutSeconds: the first visitor gets the index in hand, which
    // is kept for another five minutes.
    expect(await within(first, 1000)).toBe(loaded);
    expect(requests[1]?.signal.aborted).toBe(true);
    expect(await index()).toBe(loaded);
    expect(requests).toHaveLength(2);
    now = 602_000;
    expect(await within(index(), 1000)).toBe(loaded);
    expect(requests).toHaveLength(3);
  });

  it('gives up on a first fetch the site never answers, and tries again on the next request', async () => {
    const text = await indexText();
    let calls = 0;
    const fetch = () => (++calls === 1 ? hang() : Promise.resolve(new Response(text)));
    const index = remoteIndex(URL_, { fetch, timeoutSeconds: 0.05 });
    await expect(within(index(), 1000)).rejects.toThrow(
      `Could not fetch the index at ${URL_}: TimeoutError: The index took more than 0.05 s to download. Raise timeoutSeconds for a large index on a slow link.`,
    );
    expect((await index()).documents.length).toBe(corpus.length);
    expect(calls).toBe(2);
  });

  it('gives up on a file that stops part-way', async () => {
    const text = await indexText();
    let stalled = true;
    let calls = 0;
    const fetch = () => {
      calls++;
      return Promise.resolve(stalled ? cutOff(text) : new Response(text));
    };
    let now = 0;
    const index = remoteIndex(URL_, { fetch, now: () => now, timeoutSeconds: 0.05 });
    await expect(within(index(), 1000)).rejects.toThrow(
      `Could not fetch the index at ${URL_}: TimeoutError: The index took more than 0.05 s to download. Raise timeoutSeconds for a large index on a slow link.`,
    );
    stalled = false;
    const loaded = await index();

    // A check whose file stalls is given up after timeoutSeconds, and keeps the index in hand.
    stalled = true;
    now = 301_000;
    expect(await within(index(), 1000)).toBe(loaded);
    expect(await index()).toBe(loaded);
    expect(calls).toBe(3);
  });

  it('keeps the index it has when the connection drops part-way through a check', async () => {
    const text = await indexText();
    let calls = 0;
    const fetch = () =>
      Promise.resolve(
        ++calls === 1 ? new Response(text) : cutOff(text, new TypeError('terminated')),
      );
    let now = 0;
    const index = remoteIndex(URL_, { fetch, now: () => now, revalidateSeconds: 1 });
    const loaded = await index();
    now = 5_000;
    expect(await index()).toBe(loaded);
    // The failed check counts as one: the next is revalidateSeconds later.
    expect(await index()).toBe(loaded);
    expect(calls).toBe(2);
    now = 6_000;
    expect(await index()).toBe(loaded);
    expect(calls).toBe(3);
  });

  it('names the URL when the connection drops part-way through the first fetch', async () => {
    const text = await indexText();
    let calls = 0;
    const fetch = () =>
      Promise.resolve(
        ++calls === 1 ? cutOff(text, new TypeError('terminated')) : new Response(text),
      );
    const index = remoteIndex(URL_, { fetch });
    await expect(index()).rejects.toThrow(
      `Could not fetch the index at ${URL_}: TypeError: terminated`,
    );
    expect((await index()).documents.length).toBe(corpus.length);
  });

  it('starts another check when one never settles, as on a Worker whose request was cancelled', async () => {
    let text = await indexText();
    let calls = 0;
    // The second fetch dies with the request that started it: neither it nor its timer settles.
    const fetch = () => (++calls === 2 ? hang() : Promise.resolve(new Response(text)));
    let now = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const index = remoteIndex(URL_, { fetch, now: () => now, timeoutSeconds: 1 });
    const loaded = await index();
    text = await indexText(corpus.slice(0, 2));
    now = 301_000;
    void index();
    // Within twice timeoutSeconds, the check under way is left to finish, and requests are
    // answered from the index in hand.
    now = 302_000;
    expect(await index()).toBe(loaded);
    expect(calls).toBe(2);
    // After that, the next request checks again, and waits for the new index.
    now = 303_001;
    expect((await index()).documents.length).toBe(2);
    expect(calls).toBe(3);
  });

  it('shares one fetch between concurrent requests', async () => {
    const text = await indexText();
    const host = site(() => text);
    const index = remoteIndex(URL_, { fetch: host.fetch });
    const [a, b] = await Promise.all([index(), index()]);
    expect(a).toBe(b);
    expect(host.requests).toHaveLength(1);
  });

  it('sends the headers it is given', async () => {
    const text = await indexText();
    const host = site(() => text);
    await remoteIndex(URL_, { fetch: host.fetch, headers: { 'x-token': 'abc' } })();
    expect(host.requests[0]?.headers.get('x-token')).toBe('abc');
  });

  it('rejects a negative revalidateSeconds', () => {
    expect(() => remoteIndex(URL_, { revalidateSeconds: -1 })).toThrow(RangeError);
  });

  it('rejects a timeoutSeconds that is not more than 0, or longer than a timer can wait', async () => {
    expect(() => remoteIndex(URL_, { timeoutSeconds: 0 })).toThrow(RangeError);
    expect(() => remoteIndex(URL_, { timeoutSeconds: Number.NaN })).toThrow(RangeError);
    expect(() => remoteIndex(URL_, { timeoutSeconds: Infinity })).toThrow(RangeError);
    // Past 2 ** 31 - 1 ms, setTimeout fires at once, and every fetch would time out.
    expect(() => remoteIndex(URL_, { timeoutSeconds: 2_147_484 })).toThrow(
      'remoteIndex: timeoutSeconds must be more than 0 and at most 2147483, the longest a timer can wait (got 2147484).',
    );
    expect(() => remoteIndex(URL_, { timeoutSeconds: 1e7 })).toThrow(RangeError);
    const text = await indexText();
    const host = site(() => text);
    const longest = remoteIndex(URL_, { fetch: host.fetch, timeoutSeconds: 2_147_483 });
    expect((await longest()).documents.length).toBe(corpus.length);
  });

  it('feeds both handlers, which follow the site as it changes', async () => {
    let text = await indexText(corpus.slice(0, 1));
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now });
    const ask = createAskHandler({
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      embeddingModel: mockEmbeddingModel(),
      rateLimit: false,
    });
    const mcp = createMcpHandler({ index, rateLimit: false });
    const question = (q: string) =>
      ask(
        new Request('https://ask.example.com/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: q }),
        }),
      ).then((response) => response.text());
    expect(await question('How do I rate limit with Upstash?')).toContain("I don't know");

    // The site adds the rate limiting page and redeploys.
    text = await indexText();
    now = 301_000;
    expect(await question('How do I rate limit with Upstash?')).toContain('/docs/rate-limits');
    const listed = await mcp(
      new Request('https://ask.example.com/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_pages', arguments: {} },
        }),
      }),
    );
    expect(
      ((await listed.json()) as { result: { structuredContent: { total: number } } }).result
        .structuredContent.total,
    ).toBe(corpus.length);
    // One fetch, then one revalidation that downloaded the new file: both handlers shared them.
    expect(host.requests).toHaveLength(2);
  });

  it('is checked against the handler’s embedding model', async () => {
    const text = await indexText(corpus, mockEmbeddingModel({ dimensions: 64 }));
    const host = site(() => text);
    const ask = createAskHandler({
      index: remoteIndex(URL_, { fetch: host.fetch }),
      model: mockLanguageModel(),
      embeddingModel: mockEmbeddingModel({ dimensions: 128 }),
      rateLimit: false,
      onError: () => undefined,
    });
    const response = await ask(
      new Request('https://ask.example.com/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'How do I install it?' }),
      }),
    );
    expect(response.status).toBe(500);
  });
});
