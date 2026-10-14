// The website's live endpoints (examples/nextjs/app/api): Ask's daily budget, which the site and
// the three live demos share, and the counter lines both endpoints log (lib/counters.ts).
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { askCount, MCP_TOOLS } from '../examples/nextjs/lib/counters';

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

// Imported by path, so the typecheck does not follow them to the site's index.
const site = '../examples/nextjs/';
interface AskRoute {
  POST: Handler;
  OPTIONS: Handler;
}
const loadAskRoute = async () =>
  (await import(/* @vite-ignore */ `${site}app/api/ask/route.ts`)) as AskRoute;
const askRoute = await loadAskRoute();
const mcpRoute = (await import(/* @vite-ignore */ `${site}app/api/mcp/route.ts`)) as {
  POST: Handler;
};
const { ASK_BUDGET } = (await import(/* @vite-ignore */ `${site}lib/ask-handler.ts`)) as {
  ASK_BUDGET: { requestsPerDay: number; tokensPerDay: number; message: string };
};

const SITE_URL = 'https://ondocs.vercel.app';

let info: MockInstance<typeof console.info>;
beforeEach(() => {
  // The counter lines, kept out of the test output; and the MCP handler's own timing lines.
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The counter lines logged so far, parsed. */
function counted(): Record<string, unknown>[] {
  return info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

/** A question the docs do not answer: ondocs says so without calling the model. */
const unanswerable = (n: number) => `Does plugh frobnicate the xyzzy number ${String(n)}?`;

/** Posts a question to the site's /api/ask, from a client of its own (one IPv6 /64 each). */
async function ask(question: string, client: number, origin?: string, route = askRoute) {
  const response = await route.POST(
    new Request(`${SITE_URL}/api/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `2001:db8:0:${client.toString(16)}::1`,
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ question }),
    }),
  );
  return { status: response.status, body: await response.text() };
}

// ─── Ask's budget ───────────────────────────────────────────────────────────

describe("the website's Ask budget", () => {
  it('allows 1,500 questions and 5M tokens a day for launch week', () => {
    expect(ASK_BUDGET).toMatchObject({ requestsPerDay: 1_500, tokensPerDay: 5_000_000 });
    // An answer spends about 3k tokens, prompt and sources included, so the token cap must leave
    // more than that for each question, or it runs out before the question cap.
    expect(ASK_BUDGET.tokensPerDay / ASK_BUDGET.requestsPerDay).toBeGreaterThan(3_000);
  });

  it('answers the 1,500 questions a day the site and the demos share, then turns them away', async () => {
    // A new instance, with the whole day's budget.
    vi.resetModules();
    const route = await loadAskRoute();
    const statuses: number[] = [];
    for (let n = 0; n < 1_500; n++) {
      // Five questions from each client, its rate limit's burst.
      statuses.push((await ask(unanswerable(n), Math.floor(n / 5), undefined, route)).status);
    }
    // Before launch week's caps, the 301st already got a 429 (budget_exceeded), on every surface.
    expect(statuses.findIndex((status) => status !== 200)).toBe(-1);
    const over = await ask(
      unanswerable(1_500),
      1_000,
      'https://ondocs-vitepress.vercel.app',
      route,
    );
    expect(over.status).toBe(429);
    const { error } = JSON.parse(over.body) as { error: { code: string; message: string } };
    expect(error.code).toBe('budget_exceeded');
    // Not a dead end: the docs, and how to try it with no key.
    expect(error.message).toBe(ASK_BUDGET.message);
    expect(error.message).toContain(`${SITE_URL}/docs`);
    expect(error.message).toContain('npx ondocs index ./docs -e mock');
    expect(error.message).toContain('npx ondocs dev');
    expect(counted().at(-1)).toEqual({
      counter: 'ask-request',
      from: 'https://ondocs-vitepress.vercel.app',
      status: 429,
      code: 'budget_exceeded',
    });
  });
});

// ─── Ask's counters ─────────────────────────────────────────────────────────

describe("the website's Ask counters", () => {
  it('logs each question with where it came from, and each answer, never the question', async () => {
    await ask('Does plugh frobnicate the grue?', 2_000);
    await ask('Does plugh frobnicate the grue?', 2_001, 'https://ondocs-starlight.vercel.app');
    await ask('Does plugh frobnicate the zork?', 2_002, SITE_URL);
    await ask('Does plugh frobnicate the zork?', 2_003, 'https://evil.example');
    // A question's line is logged when its answer starts, the answer's when it ends.
    expect(counted().filter((line) => line.counter === 'ask-request')).toEqual([
      { counter: 'ask-request', from: null, status: 200, code: null },
      {
        counter: 'ask-request',
        from: 'https://ondocs-starlight.vercel.app',
        status: 200,
        code: null,
      },
      { counter: 'ask-request', from: SITE_URL, status: 200, code: null },
      // Any other origin is not written down.
      { counter: 'ask-request', from: 'other', status: 200, code: null },
    ]);
    expect(counted().filter((line) => line.counter === 'ask')).toEqual([
      { counter: 'ask', cached: false, refused: true, lowConfidence: false, tokens: 0 },
      // Asked again, it is answered from memory.
      { counter: 'ask', cached: true, refused: true, lowConfidence: false, tokens: 0 },
      { counter: 'ask', cached: false, refused: true, lowConfidence: false, tokens: 0 },
      { counter: 'ask', cached: true, refused: true, lowConfidence: false, tokens: 0 },
    ]);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('plugh');
    expect(logged).not.toContain('evil');
  });

  it('logs the tokens an answer spent', async () => {
    const { status, body } = await ask('How do I install with pnpm?', 2_500, SITE_URL);
    expect(status).toBe(200);
    expect(body).toContain('"type":"source-url"');
    const [answer] = counted().filter((line) => line.counter === 'ask');
    expect(answer).toMatchObject({ counter: 'ask', cached: false, refused: false });
    expect(answer?.tokens).toBeGreaterThan(0);
  });

  it('logs a question turned away with its status and code, and no preflight', async () => {
    const statuses: number[] = [];
    for (let n = 0; n < 6; n++)
      statuses.push((await ask(`Who is grue ${String(n)}?`, 3_000)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    await askRoute.OPTIONS(
      new Request(`${SITE_URL}/api/ask`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://ondocs-docusaurus.vercel.app',
          'access-control-request-method': 'POST',
        },
      }),
    );
    await ask('', 3_001);
    expect(
      counted()
        .filter((line) => line.counter === 'ask-request')
        .slice(-2),
    ).toEqual([
      { counter: 'ask-request', from: null, status: 429, code: 'rate_limited' },
      { counter: 'ask-request', from: null, status: 400, code: 'invalid_request' },
    ]);
  });

  it('counts the tokens an answer and its follow-up spent, and leaves out the question', () => {
    const answer = {
      id: 'a1',
      question: 'How do I install it?',
      answer: 'Run npm i ondocs [1].',
      sources: [],
      refused: false,
      lowConfidence: false,
      cached: false,
      usage: { inputTokens: 2_400, outputTokens: 300, totalTokens: 2_700 },
      followUp: { question: 'and with pnpm?', usage: { totalTokens: 150 } },
    };
    expect(askCount(answer)).toEqual({
      counter: 'ask',
      cached: false,
      refused: false,
      lowConfidence: false,
      tokens: 2_850,
    });
    expect(askCount({ ...answer, cached: true, usage: undefined, followUp: undefined })).toEqual({
      counter: 'ask',
      cached: true,
      refused: false,
      lowConfidence: false,
      tokens: 0,
    });
    expect(JSON.stringify(askCount(answer))).not.toContain('install');
  });
});

// ─── MCP's counters ─────────────────────────────────────────────────────────

let id = 0;

/** One JSON-RPC call to the site's /api/mcp. */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = { 'mcp-protocol-version': '2025-06-18' },
) {
  const response = await mcpRoute.POST(
    new Request(`${SITE_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-forwarded-for': '203.0.113.7',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      result?: { tools?: { name: string }[]; isError?: boolean };
      error?: { message: string };
    },
  };
}

/** A 2026-07-28 request: no initialize, and the version and the client in every `_meta`. */
function modern(method: string, params: Record<string, unknown> = {}, client = 'claude-code') {
  return rpc(
    method,
    {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: client, version: '2.0.0' },
      },
    },
    {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
    },
  );
}

const initialize = (name: unknown) =>
  rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name, version: '1.0.0' },
  });

describe("the website's MCP counters", () => {
  it('logs a line for each connection and tool call, with the client’s name', async () => {
    await initialize('cursor-vscode');
    await rpc('tools/list');
    await rpc('tools/call', { name: 'search', arguments: { query: 'token bucket' } });
    await modern('server/discover');
    await modern('tools/call', { name: 'fetch', arguments: { id: '/docs/install' } });
    expect(counted()).toEqual([
      { counter: 'mcp', method: 'initialize', tool: null, client: 'cursor-vscode', status: 200 },
      // A 2025 tool call does not say which client sent it; its initialize did.
      { counter: 'mcp', method: 'tools/call', tool: 'search', client: null, status: 200 },
      {
        counter: 'mcp',
        method: 'server/discover',
        tool: null,
        client: 'claude-code',
        status: 200,
      },
      { counter: 'mcp', method: 'tools/call', tool: 'fetch', client: 'claude-code', status: 200 },
    ]);
    // What the agent searched for and read stays out of the logs.
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('token bucket');
    expect(logged).not.toContain('/docs/install');
  });

  it('counts the tool calls it turns away, with their 429', async () => {
    const headers = { 'mcp-protocol-version': '2025-06-18', 'x-forwarded-for': '203.0.113.9' };
    const statuses: number[] = [];
    for (let call = 0; call < 31; call++) {
      statuses.push(
        (await rpc('tools/call', { name: 'list_pages', arguments: {} }, headers)).status,
      );
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);
    expect(counted()).toHaveLength(31);
    expect(counted().at(-1)).toEqual({
      counter: 'mcp',
      method: 'tools/call',
      tool: 'list_pages',
      client: null,
      status: 429,
    });
  });

  it('cuts a client’s name to 100 characters, and drops one that is not printable ASCII', async () => {
    await initialize('c'.repeat(20_000));
    await initialize('evil‮exe.gpj');
    await initialize('line\nbreak');
    await initialize(42);
    await modern('server/discover', {}, '');
    expect(counted().map((line) => line.client)).toEqual(['c'.repeat(100), null, null, null, null]);
    expect(Math.max(...info.mock.calls.map(([line]) => String(line).length))).toBeLessThan(200);
  });

  it('counts no call to a tool it does not have, and logs none of the name', async () => {
    const long = 'x'.repeat(20_000);
    const personal = 'how do I reset my password for jane@example.com';
    const answers = [
      await rpc('tools/call', { name: long, arguments: {} }),
      await rpc('tools/call', { name: personal, arguments: {} }),
      await modern('tools/call', { name: personal, arguments: {} }),
      await rpc('tools/call', { name: 42, arguments: {} }),
    ];
    // ondocs answers each with a JSON-RPC error in a 200, before its rate limit, and runs nothing.
    for (const { status, body } of answers) {
      expect(status).toBe(200);
      expect(body.error?.message).toMatch(/^Unknown tool/);
    }
    expect(counted()).toEqual([]);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('xxxxxxxx');
    expect(logged).not.toContain('jane@example.com');
  });

  it('counts no tool call whose arguments are not an object, which runs nothing', async () => {
    const { status, body } = await rpc('tools/call', { name: 'search', arguments: 'grue' });
    expect(status).toBe(200);
    expect(body.result?.isError).toBe(true);
    expect(counted()).toEqual([]);
    // ondocs reads a null `arguments` as {}, and runs the tool.
    await rpc('tools/call', { name: 'list_pages', arguments: null });
    expect(counted()).toEqual([
      { counter: 'mcp', method: 'tools/call', tool: 'list_pages', client: null, status: 200 },
    ]);
  });

  it('counts no connection it answers with an error', async () => {
    // server/discover without MCP 2026-07-28's _meta is a method ondocs does not have.
    const { status, body } = await rpc('server/discover', {
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    expect(status).toBe(200);
    expect(body.error?.message).toMatch(/^Method not found/);
    expect(counted()).toEqual([]);
  });

  it('counts the tools it lists, and only those', async () => {
    const { body } = await rpc('tools/list');
    const names = (body.result?.tools ?? []).map((tool) => tool.name);
    // A tool a new ondocs adds is counted once it is in MCP_TOOLS too.
    expect(new Set(names)).toEqual(MCP_TOOLS);
  });
});
