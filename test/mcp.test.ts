import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { buildIndex, loadIndex, serializeIndexFile, type SourceDocument } from '../src';
import { mockEmbeddingModel } from '../src/mock';
import {
  createMcpHandler,
  memoryRateLimit,
  MCP_PROTOCOL_VERSIONS,
  type McpHandlerOptions,
} from '../src/server';
import { corpus } from './helpers';

const { index } = await buildIndex({ documents: corpus });
const embeddingModel = mockEmbeddingModel();
const { index: embedded } = await buildIndex({ documents: corpus, embeddingModel });

const ENDPOINT = 'https://docs.example.com/api/mcp';

/** One page of a site in English and in French, for `indexes`. */
const page = (lang: 'en' | 'fr'): SourceDocument => ({
  id: 'install.md',
  url: lang === 'en' ? '/install' : '/fr/install',
  title: lang === 'en' ? 'Install' : 'Installation',
  content:
    lang === 'en'
      ? 'Install the package with npm and configure the plugin.'
      : 'Installez le paquet avec npm et configurez le plugin.',
});
const english = (await buildIndex({ documents: [page('en')] })).index;
const french = (await buildIndex({ documents: [page('fr')] })).index;

interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function setup(overrides: Partial<McpHandlerOptions> = {}) {
  const onError = vi.fn();
  const onToolCall = vi.fn();
  const handler = createMcpHandler({
    index,
    siteName: 'the Acme docs',
    onError,
    onToolCall,
    ...overrides,
  });
  let id = 0;
  const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    handler(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-forwarded-for': '203.0.113.7',
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  const rpc = async (
    method: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<{ response: Response; body: RpcResponse }> => {
    id += 1;
    const response = await post(
      { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
      headers,
    );
    return { response, body: (await response.json()) as RpcResponse };
  };
  /** A 2026-07-28 request: the version and capabilities in `_meta`, and the headers to match. */
  const modern = async (
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
    version = '2026-07-28',
  ): Promise<{ response: Response; body: RpcResponse }> => {
    id += 1;
    const response = await post(
      {
        jsonrpc: '2.0',
        id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': version,
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
          },
        },
      },
      {
        'mcp-protocol-version': version,
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
        ...headers,
      },
    );
    return { response, body: (await response.json()) as RpcResponse };
  };
  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const { body } = await rpc('tools/call', { name, arguments: args });
    if (!body.result) throw new Error(`tools/call failed: ${JSON.stringify(body.error)}`);
    return body.result as unknown as ToolResult;
  };
  return { handler, post, rpc, modern, call, onError, onToolCall };
}

describe('MCP lifecycle (2025 revisions: initialize first)', () => {
  it('answers initialize with the version asked for, the tools capability and instructions', async () => {
    const { rpc } = setup();
    // Every version that starts with initialize; 2026-07-28 has none.
    for (const version of MCP_PROTOCOL_VERSIONS.filter((v) => v !== '2026-07-28')) {
      const { response, body } = await rpc('initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      // Stateless: no session to resume, so no Mcp-Session-Id.
      expect(response.headers.get('mcp-session-id')).toBeNull();
      expect(body.result).toMatchObject({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ondocs', title: 'Search the Acme docs' },
      });
      expect(body.result?.instructions).toMatch(/search .* then fetch/);
    }
  });

  it('offers its newest version when the client asks for one it does not know', async () => {
    const { body } = await setup().rpc('initialize', {
      protocolVersion: '2099-01-01',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    expect(body.result?.protocolVersion).toBe('2025-11-25');
  });

  it('accepts notifications and responses with a 202 and no body', async () => {
    const { post } = setup();
    const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe('');
    const response = await post({ jsonrpc: '2.0', id: 'x', result: {} });
    expect(response.status).toBe(202);
  });

  it('answers ping', async () => {
    const { body } = await setup().rpc('ping');
    expect(body.result).toEqual({});
  });

  it('refuses an MCP-Protocol-Version it does not speak', async () => {
    const { response, body } = await setup().rpc('tools/list', undefined, {
      'mcp-protocol-version': '1999-01-01',
    });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe(-32600);
  });
});

describe('tools/list', () => {
  it('lists search, fetch and list_pages, read-only, with input and output schemas', async () => {
    const { body } = await setup().rpc('tools/list');
    const tools = body.result?.tools as {
      name: string;
      description: string;
      inputSchema: { required?: string[] };
      outputSchema?: object;
      annotations: Record<string, unknown>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(['search', 'fetch', 'list_pages']);
    expect(tools.map((tool) => tool.inputSchema.required ?? [])).toEqual([['query'], ['id'], []]);
    for (const tool of tools) {
      expect(tool.description).toContain('the Acme docs');
      // Tool descriptions are what the agent reads: keep them short.
      expect(tool.description.length).toBeLessThan(300);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });
});

describe('tools/call', () => {
  it('search: ranked sections with id, title, heading, absolute URL and snippet, as structured content and JSON text', async () => {
    const result = await setup().call('search', { query: 'token bucket per client' });
    const structured = result.structuredContent as { results: Record<string, string>[] };
    expect(structured.results[0]).toEqual({
      id: '/docs/rate-limits#in-memory',
      title: 'Rate limiting',
      heading: 'In memory',
      url: 'https://docs.example.com/docs/rate-limits#in-memory',
      text: 'memoryRateLimit keeps a token bucket per client IP inside one process.',
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(structured);
    expect(result.isError).toBeUndefined();
  });

  it('search: one result per section, and none for an off-topic query', async () => {
    const { call } = setup();
    const { results } = (await call('search', { query: 'rate limit upstash memory' }))
      .structuredContent as { results: { id: string }[] };
    expect(new Set(results.map((result) => result.id)).size).toBe(results.length);
    const none = await call('search', { query: 'sourdough bread recipe' });
    expect(none.structuredContent).toEqual({
      results: [],
      note: expect.stringContaining('list_pages') as string,
    });
  });

  it('search: makes absolute URLs from siteUrl when the endpoint runs elsewhere', async () => {
    const result = await setup({ siteUrl: 'https://acme.dev' }).call('search', { query: 'int8' });
    const { results } = result.structuredContent as { results: { url: string }[] };
    expect(results[0]?.url).toMatch(/^https:\/\/acme\.dev\/docs\/quantization/);
  });

  it('fetch: a whole page, or one section, as Markdown', async () => {
    const { call } = setup();
    const page = await call('fetch', { id: '/docs/rate-limits' });
    expect(page.structuredContent).toMatchObject({
      id: '/docs/rate-limits',
      title: 'Rate limiting',
      url: 'https://docs.example.com/docs/rate-limits',
    });
    expect(page.structuredContent?.text).toBe(
      '# Rate limiting\n\nThe handler accepts a rateLimit hook.\n\n## Upstash\n\nPass upstashRateLimit with a configured Ratelimit instance for a limit shared across regions.\n\n## In memory\n\nmemoryRateLimit keeps a token bucket per client IP inside one process.',
    );
    const section = await call('fetch', { id: '/docs/rate-limits#upstash' });
    expect(section.structuredContent?.text).toMatch(
      /^# Rate limiting\n\n## Upstash\n\nPass upstashRateLimit/,
    );
    expect(section.structuredContent?.text).not.toContain('token bucket');
    expect(section.structuredContent?.text).toContain('fetch that URL for the whole page');
  });

  it('fetch: takes an absolute URL, a .md URL or a search result id', async () => {
    const { call } = setup();
    for (const id of [
      'https://docs.example.com/docs/install',
      'https://docs.example.com/docs/install.md',
      '/docs/install/',
      'install.md',
    ]) {
      const result = await call('fetch', { id });
      expect([id, result.structuredContent?.title]).toEqual([id, 'Installation']);
    }
  });

  it('fetch: reads the section of a search result URL whose anchor is not ASCII', async () => {
    const { index: i18n } = await buildIndex({
      documents: [
        {
          id: 'i18n.md',
          url: '/docs/i18n',
          title: 'Início',
          content:
            '## Configuração rápida\n\nRode o comando init.\n\n## 日本語の見出し\n\nインデックスの本文です。',
        },
      ],
    });
    const { call } = setup({ index: i18n });
    for (const [query, anchor, text] of [
      ['configuração rápida', 'configuração-rápida', 'Rode o comando init.'],
      ['日本語の見出し', '日本語の見出し', 'インデックスの本文です。'],
    ] as const) {
      const { results } = (await call('search', { query })).structuredContent as {
        results: { id: string; url: string }[];
      };
      expect(results[0]?.url).toBe(
        `https://docs.example.com/docs/i18n#${encodeURIComponent(anchor)}`,
      );
      const section = await call('fetch', { id: results[0]?.url ?? '' });
      expect(section.structuredContent).toMatchObject({ id: `/docs/i18n#${anchor}` });
      expect(section.structuredContent?.text).toContain(text);
      expect(section.structuredContent?.text).not.toContain('has no section');
    }
  });

  it('fetch: an unknown page is an error the agent can act on', async () => {
    const result = await setup().call('fetch', { id: '/docs/nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/No page matches .* search .* list_pages/);
  });

  it('fetch: a long page is cut, with its sections listed to fetch the rest', async () => {
    const long = {
      id: 'long.md',
      url: '/docs/long',
      title: 'Long',
      content: Array.from(
        { length: 40 },
        (_, i) => `## Part ${String(i)}\n\n${'Words about the topic. '.repeat(200)}`,
      ).join('\n\n'),
    };
    const { index: big } = await buildIndex({ documents: [long] });
    const result = await setup({ index: big }).call('fetch', { id: '/docs/long' });
    const text = String(result.structuredContent?.text);
    expect(text.length).toBeLessThan(65_000);
    expect(text).toContain('Fetch a section by its id to read the rest');
    expect(text).toContain('- Part 39: /docs/long#part-39');
  });

  it('list_pages: every page, or those under a prefix', async () => {
    const { call } = setup();
    const all = await call('list_pages', {});
    expect(all.structuredContent?.total).toBe(4);
    const docs = await call('list_pages', { prefix: '/docs' });
    expect((docs.structuredContent?.pages as { id: string }[]).map((page) => page.id)).toEqual([
      '/docs/install',
      '/docs/quantization',
      '/docs/rate-limits',
    ]);
    const none = await call('list_pages', { prefix: '/doc' });
    expect(none.structuredContent?.total).toBe(0);
  });

  it('reports bad arguments as tool errors, and an unknown tool as a protocol error', async () => {
    const { call, rpc } = setup();
    expect((await call('search', {})).isError).toBe(true);
    expect((await call('search', { query: 42 })).isError).toBe(true);
    expect((await call('search', { query: 'x'.repeat(501) })).content[0]?.text).toMatch(
      /500 characters/,
    );
    expect((await call('fetch', { id: '  ' })).isError).toBe(true);
    const { body } = await rpc('tools/call', { name: 'delete_everything', arguments: {} });
    expect(body.error?.code).toBe(-32602);
  });

  it('refuses an id or prefix longer than the 2,048 characters its schema allows, as a long query', async () => {
    const { call, rpc } = setup();
    const { body } = await rpc('tools/list');
    const tools = (body.result?.tools ?? []) as {
      name: string;
      inputSchema: { properties: Record<string, { maxLength?: number }> };
    }[];
    for (const [tool, key] of [
      ['fetch', 'id'],
      ['list_pages', 'prefix'],
    ] as const) {
      const schema = tools.find((entry) => entry.name === tool)?.inputSchema.properties[key];
      expect(schema?.maxLength).toBe(2048);
      const refused = await call(tool, { [key]: `/${'x'.repeat(2048)}` });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toBe(`${key} is limited to 2048 characters.`);
      // At the limit, the tool runs: no such page, and no pages under that prefix.
      const ran = await call(tool, { [key]: `/${'x'.repeat(2047)}` });
      expect(ran.content[0]?.text).not.toMatch(/limited to/);
    }
  });

  it('treats null optional strings as omitted, while still rejecting null required strings', async () => {
    const { call } = setup({ index: english, indexes: { fr: french } });
    const all = await call('list_pages', {});
    for (const args of [{ prefix: null }, { locale: null }, { prefix: null, locale: null }]) {
      expect(await call('list_pages', args)).toEqual(all);
    }
    expect(await call('list_pages', { prefix: null, locale: 'fr' })).toEqual(
      await call('list_pages', { locale: 'fr' }),
    );
    expect(await call('search', { query: 'Install the package', locale: null })).toEqual(
      await call('search', { query: 'Install the package' }),
    );
    for (const [tool, args, key] of [
      ['search', { query: null }, 'query'],
      ['fetch', { id: null }, 'id'],
    ] as const) {
      const result = await call(tool, args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(`${key} must be a non-empty string.`);
    }
    expect((await call('list_pages', { prefix: 42 })).isError).toBe(true);
    expect((await call('list_pages', { locale: false })).isError).toBe(true);
  });

  it('calls onToolCall with what was called and found, never the visitor’s IP', async () => {
    const { call, onToolCall } = setup();
    await call('search', { query: 'int8 vectors' });
    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'search',
        arguments: { query: 'int8 vectors' },
        isError: false,
        retrieval: 'keyword',
        results: expect.arrayContaining(['/docs/quantization#why-int8']) as unknown,
      }),
    );
  });
});

describe('search with an embedding model', () => {
  it('embeds each search query once, and never for fetch or list_pages', async () => {
    const model = new MockEmbeddingModelV4({
      modelId: embeddingModel.modelId,
      doEmbed: (options) => embeddingModel.doEmbed(options),
    });
    const spy = vi.spyOn(model, 'doEmbed');
    const { call, onToolCall } = setup({ index: embedded, embeddingModel: model });
    await call('search', { query: 'int8 vectors' });
    await call('fetch', { id: '/docs/quantization' });
    await call('list_pages', {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ retrieval: 'hybrid' }));
  });

  it('falls back to keywords when the embedding provider fails', async () => {
    const failing = new MockEmbeddingModelV4({
      modelId: embeddingModel.modelId,
      doEmbed: () => Promise.reject(new Error('provider down')),
    });
    const { call, onError } = setup({ index: embedded, embeddingModel: failing });
    const result = await call('search', { query: 'int8 vectors' });
    expect((result.structuredContent as { results: unknown[] }).results.length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalled();
  });
});

describe('search with retrieval hooks, as the ask endpoint runs them', () => {
  const ids = (result: ToolResult): string[] =>
    (result.structuredContent as { results: { id: string }[] }).results.map((entry) => entry.id);
  const QUERY = 'rate limit token bucket upstash';

  it('runs rerank on the candidates, with the index and the request’s signal', async () => {
    const plain = ids(await setup().call('search', { query: QUERY }));
    expect(plain.length).toBeGreaterThan(1);
    const seen: { question: string; signal: boolean; index: boolean }[] = [];
    const reranked = await setup({
      retrieval: {
        rerank: (question, hits, context) => {
          seen.push({
            question,
            signal: context.signal instanceof AbortSignal,
            index: context.index.chunks.length > 0,
          });
          return [...hits].reverse();
        },
      },
    }).call('search', { query: QUERY });
    expect(seen).toEqual([{ question: QUERY, signal: true, index: true }]);
    expect(ids(reranked)).toEqual([...plain].reverse());
  });

  it('runs retrieve instead of the built-in search, behind the relevance gate', async () => {
    const offTopic = loadIndex(index).chunks.find((chunk) => chunk.documentId === 'pricing.md');
    const { call } = setup({
      retrieval: {
        retrieve: (_query, search) => [
          // A hit on a chunk that does not match the query: the gate drops it.
          {
            chunk: offTopic!,
            score: 1,
            similarity: 1,
            keywordScore: 99,
            keywordCoverage: 1,
          },
          ...search().filter((hit) => hit.chunk.url.startsWith('/docs/rate-limits#upstash')),
        ],
      },
    });
    expect(ids(await call('search', { query: QUERY }))).toEqual(['/docs/rate-limits#upstash']);
  });

  it('reports a hook that throws, and searches as if it were not there', async () => {
    const failure = new Error('reranker down');
    const plain = ids(await setup().call('search', { query: QUERY }));
    const { call, onError } = setup({
      retrieval: {
        rerank: () => {
          throw failure;
        },
      },
    });
    expect(ids(await call('search', { query: QUERY }))).toEqual(plain);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('indexes: the docs in other locales', () => {
  const localized = () =>
    setup({ index: english, indexes: { fr: () => serializeIndexFile(french) } });
  const first = (result: ToolResult): string | undefined =>
    (result.structuredContent as { results: { id: string }[] }).results[0]?.id;

  it('offers the locales on search and list_pages', async () => {
    const { body } = await localized().rpc('tools/list');
    const tools = body.result?.tools as {
      name: string;
      inputSchema: { properties: Record<string, { enum?: string[] }> };
    }[];
    const locale = (name: string) =>
      tools.find((tool) => tool.name === name)?.inputSchema.properties.locale;
    expect(locale('search')?.enum).toEqual(['fr']);
    expect(locale('list_pages')?.enum).toEqual(['fr']);
    expect(locale('fetch')).toBeUndefined();
    // Without other locales, no tool takes one.
    const { body: plain } = await setup().rpc('tools/list');
    for (const tool of plain.result?.tools as { inputSchema: { properties: object } }[]) {
      expect(tool.inputSchema.properties).not.toHaveProperty('locale');
    }
  });

  it('searches and lists the locale the agent names, and the default index otherwise', async () => {
    const { call } = localized();
    expect(first(await call('search', { query: 'Installez le paquet', locale: 'fr' }))).toBe(
      '/fr/install',
    );
    expect(first(await call('search', { query: 'Install the package' }))).toBe('/install');
    // A locale with no index of its own is searched in `index`, as the ask endpoint answers it.
    expect(first(await call('search', { query: 'Install the package', locale: 'de' }))).toBe(
      '/install',
    );
    const pages = async (args: Record<string, unknown>) =>
      ((await call('list_pages', args)).structuredContent?.pages as { id: string }[]).map(
        (entry) => entry.id,
      );
    expect(await pages({ locale: 'fr' })).toEqual(['/fr/install']);
    expect(await pages({})).toEqual(['/install']);
    expect((await call('search', { query: 'paquet', locale: 7 })).isError).toBe(true);
  });

  it('fetches a page from whichever index has it', async () => {
    const { call } = localized();
    expect((await call('fetch', { id: '/fr/install' })).structuredContent?.title).toBe(
      'Installation',
    );
    expect((await call('fetch', { id: '/install' })).structuredContent?.title).toBe('Install');
    expect((await call('fetch', { id: '/de/install' })).isError).toBe(true);
  });
});

describe('protocol errors', () => {
  it('answers unknown methods with -32601', async () => {
    const { response, body } = await setup().rpc('resources/list');
    expect(response.status).toBe(200);
    expect(body.error?.code).toBe(-32601);
  });

  it('answers a body that is not JSON with a parse error, and refuses batches', async () => {
    const { post } = setup();
    const parse = await post('{nope');
    expect(parse.status).toBe(400);
    expect(((await parse.json()) as RpcResponse).error?.code).toBe(-32700);
    const batch = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(batch.status).toBe(400);
    const invalid = await post({ id: 1, method: 'ping' });
    expect(((await invalid.json()) as RpcResponse).error?.code).toBe(-32600);
  });

  it('answers GET and DELETE with 405, as a server without sessions or streams', async () => {
    const { handler } = setup();
    for (const method of ['GET', 'DELETE']) {
      const response = await handler(new Request(ENDPOINT, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    }
  });

  it('requires a JSON body', async () => {
    const { handler } = setup();
    const response = await handler(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(415);
  });
});

describe('limits', () => {
  it('caps the body, by its length and while reading it', async () => {
    const { post, handler } = setup({ maxBodyBytes: 1024 });
    const big = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { pad: 'x'.repeat(2000) },
    });
    expect(big.status).toBe(413);
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new TextEncoder().encode('x'.repeat(512)));
        controller.close();
      },
    });
    const chunked = await handler(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect(chunked.status).toBe(413);
  });

  it('rate-limits tool calls per client IP by default, 60 a minute, but not discovery', async () => {
    const { rpc } = setup();
    for (let i = 0; i < 60; i++) {
      const { response } = await rpc('tools/call', { name: 'list_pages', arguments: {} });
      expect(response.status).toBe(200);
    }
    const { response, body } = await rpc('tools/call', { name: 'list_pages', arguments: {} });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(body.error?.message).toMatch(/Too many requests/);
    // Listing the tools is not a tool call.
    expect((await rpc('tools/list')).response.status).toBe(200);
    // Another client has its own bucket.
    const other = await rpc(
      'tools/call',
      { name: 'list_pages', arguments: {} },
      { 'x-forwarded-for': '198.51.100.1' },
    );
    expect(other.response.status).toBe(200);
  });

  it('takes a custom limiter, or none', async () => {
    const { rpc } = setup({ rateLimit: memoryRateLimit({ limit: 1, windowMs: 60_000 }) });
    expect((await rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status).toBe(
      200,
    );
    expect((await rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status).toBe(
      429,
    );
    const open = setup({ rateLimit: false });
    for (let i = 0; i < 70; i++) {
      expect(
        (await open.rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status,
      ).toBe(200);
    }
  });

  it('fails closed when the limiter fails, or open when asked', async () => {
    const broken = () => Promise.reject(new Error('redis down'));
    const closed = setup({ rateLimit: broken });
    expect(
      (await closed.rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status,
    ).toBe(503);
    expect(closed.onError).toHaveBeenCalled();
    const open = setup({ rateLimit: broken, rateLimitFailure: 'open' });
    expect(
      (await open.rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status,
    ).toBe(200);
  });

  it('caps tool calls per day with a budget, apart from the ask endpoint’s', async () => {
    let now = Date.UTC(2026, 9, 10, 12);
    const { rpc } = setup({ budget: { requestsPerDay: 2, now: () => now } });
    expect((await rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status).toBe(
      200,
    );
    expect((await rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status).toBe(
      200,
    );
    const spent = await rpc('tools/call', { name: 'list_pages', arguments: {} });
    expect(spent.response.status).toBe(429);
    expect(spent.response.headers.get('retry-after')).toBe(String(12 * 3600));
    expect(spent.body.error?.message).toMatch(/daily limit/);
    now += 12 * 3600 * 1000;
    expect((await rpc('tools/call', { name: 'list_pages', arguments: {} })).response.status).toBe(
      200,
    );
  });
});

describe('origins', () => {
  it('answers any origin by default, without CORS headers, as hosted clients send one', async () => {
    const { rpc } = setup();
    const hosted = await rpc('ping', undefined, { origin: 'https://claude.ai' });
    expect(hosted.response.status).toBe(200);
    // A page on another site cannot read the answer.
    expect(hosted.response.headers.get('access-control-allow-origin')).toBeNull();
    const own = await rpc('ping', undefined, { origin: 'https://docs.example.com' });
    expect(own.response.status).toBe(200);
  });

  it('with a list, refuses other origins with a 403 and gives the listed ones CORS headers', async () => {
    const { rpc, handler } = setup({ allowedOrigins: ['https://app.example'] });
    const foreign = await rpc('ping', undefined, { origin: 'https://evil.example' });
    expect(foreign.response.status).toBe(403);
    expect(
      (await rpc('ping', undefined, { origin: 'https://docs.example.com' })).response.status,
    ).toBe(200);
    const { response } = await rpc('ping', undefined, { origin: 'https://app.example' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(response.headers.get('vary')).toBe('origin');
    // A browser client reads the version, and how long to wait after a 429.
    expect(response.headers.get('access-control-expose-headers')).toBe(
      'mcp-protocol-version, retry-after',
    );
    const preflight = await handler(
      new Request(ENDPOINT, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, mcp-protocol-version',
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example');
    for (const name of ['mcp-protocol-version', 'mcp-method', 'mcp-name']) {
      expect(preflight.headers.get('access-control-allow-headers')).toContain(name);
    }
    const any = setup({ allowedOrigins: '*' });
    const anywhere = await any.rpc('ping', undefined, { origin: 'https://other.example' });
    expect(anywhere.response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('MCP 2026-07-28: stateless, every request names its version', () => {
  it('answers server/discover with the modern versions, the tools capability and cache hints', async () => {
    const { response, body } = await setup().modern('server/discover');
    expect(response.status).toBe(200);
    expect(body.result).toEqual({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {} },
      instructions: expect.stringMatching(/search .* then fetch/) as unknown,
      ttlMs: 3_600_000,
      cacheScope: 'public',
      _meta: {
        'io.modelcontextprotocol/serverInfo': {
          name: 'ondocs',
          title: 'Search the Acme docs',
          version: expect.any(String) as unknown,
        },
      },
    });
  });

  it('lists the tools as a cacheable result, and calls them with a complete result', async () => {
    const { modern } = setup();
    const list = await modern('tools/list');
    expect(list.body.result).toMatchObject({
      resultType: 'complete',
      ttlMs: 3_600_000,
      cacheScope: 'public',
    });
    expect((list.body.result?.tools as { name: string }[]).map((tool) => tool.name)).toEqual([
      'search',
      'fetch',
      'list_pages',
    ]);
    const { body } = await modern('tools/call', { name: 'search', arguments: { query: 'int8' } });
    expect(body.result).toMatchObject({
      resultType: 'complete',
      structuredContent: { results: expect.any(Array) as unknown },
    });
    expect(body.result).not.toHaveProperty('ttlMs');
    expect(body.result?._meta).toHaveProperty(['io.modelcontextprotocol/serverInfo']);
  });

  it('reads a tool name sent base64-encoded in Mcp-Name', async () => {
    const encoded = `=?base64?${btoa('list_pages')}?=`;
    const { body } = await setup().modern(
      'tools/call',
      { name: 'list_pages', arguments: {} },
      { 'mcp-name': encoded },
    );
    expect(body.result?.resultType).toBe('complete');
  });

  it('refuses a request whose _meta lacks the client capabilities', async () => {
    const { post } = setup();
    const response = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as RpcResponse).error?.code).toBe(-32602);
  });

  it('refuses headers that do not match the body with -32020', async () => {
    const { modern } = setup();
    const cases: Record<string, string>[] = [
      { 'mcp-protocol-version': '2025-11-25' },
      { 'mcp-method': 'tools/list' },
      { 'mcp-name': 'fetch' },
    ];
    for (const headers of cases) {
      const { response, body } = await modern(
        'tools/call',
        { name: 'search', arguments: { query: 'x' } },
        headers,
      );
      expect([headers, response.status, body.error?.code]).toEqual([headers, 400, -32020]);
    }
  });

  it('refuses a version it does not speak with -32022, naming the ones it does', async () => {
    const { response, body } = await setup().modern('tools/list', {}, {}, '2099-01-01');
    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: -32022,
      data: {
        requested: '2099-01-01',
        // What server/discover offers; a 2025 client starts with initialize instead.
        supported: ['2026-07-28'],
      },
    });
  });

  it('answers methods it does not have, ping included, with 404 and -32601', async () => {
    const { modern } = setup();
    for (const method of ['ping', 'resources/list', 'subscriptions/listen']) {
      const { response, body } = await modern(method);
      expect([method, response.status, body.error?.code]).toEqual([method, 404, -32601]);
    }
  });

  it('keeps the eras apart: no initialize, and no request without _meta, under a modern header', async () => {
    const { rpc, post } = setup();
    const init = await rpc(
      'initialize',
      { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      { 'mcp-protocol-version': '2026-07-28' },
    );
    expect([init.response.status, init.body.error?.code]).toEqual([400, -32020]);
    const bare = await rpc('tools/list', undefined, { 'mcp-protocol-version': '2026-07-28' });
    expect([bare.response.status, bare.body.error?.code]).toEqual([400, -32602]);
    const reply = await post(
      { jsonrpc: '2.0', id: 1, result: {} },
      { 'mcp-protocol-version': '2026-07-28' },
    );
    expect(reply.status).toBe(400);
  });
});

describe('the index', () => {
  it('reports a misconfigured index without failing every later request', async () => {
    let attempts = 0;
    const { rpc, onError } = setup({
      index: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('fetch failed');
        return index;
      },
    });
    const first = await rpc('tools/call', { name: 'list_pages', arguments: {} });
    expect(first.response.status).toBe(500);
    expect(onError).toHaveBeenCalled();
    const second = await rpc('tools/call', { name: 'list_pages', arguments: {} });
    expect(second.response.status).toBe(200);
  });

  it('refuses an embedding model the index was not built with', async () => {
    const other = new MockEmbeddingModelV4({ modelId: 'other-model' });
    const { rpc } = setup({ index: embedded, embeddingModel: other });
    const { response } = await rpc('tools/call', { name: 'search', arguments: { query: 'int8' } });
    expect(response.status).toBe(500);
  });

  it('rejects a siteUrl that is not a URL', () => {
    expect(() => createMcpHandler({ index, siteUrl: 'docs.example.com' })).toThrow(/absolute URL/);
  });
});
