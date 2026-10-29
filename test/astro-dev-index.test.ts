// Under `astro dev`, a site with an SSR adapter has no build output, so the endpoints ondocs/astro
// injects read the index the last `astro build` wrote, which the dev server serves at its path.
// No test ran a dev server, so this drives the integration's `astro:server:setup` hook with a
// stand-in for Vite's middleware stack.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ondocs from '../src/astro';

type Middleware = (
  request: { url?: string; method?: string },
  response: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string | Buffer) => void;
  },
  next: () => void,
) => void;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-astro-dev-'));
  vi.stubEnv('ASK_ENDPOINT', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** The integration set up for `astro dev` with the Node adapter, and its middleware. */
async function devServer(base = '/') {
  const integration = ondocs({ embedding: 'mock', route: { model: 'mock' } });
  const hooks = integration.hooks as Record<string, ((options: unknown) => unknown) | undefined>;
  const config = {
    root: pathToFileURL(`${root}/`),
    srcDir: pathToFileURL(`${root}/src/`),
    outDir: pathToFileURL(`${root}/dist/`),
    build: {
      client: pathToFileURL(`${root}/dist/client/`),
      server: pathToFileURL(`${root}/dist/server/`),
    },
    base,
    adapter: { name: '@astrojs/node', hooks: {} },
  };
  const warn: string[] = [];
  const logger = { info: () => undefined, warn: (message: string) => warn.push(message) };
  await hooks['astro:config:setup']?.({
    config,
    command: 'dev',
    injectScript: () => undefined,
    injectRoute: () => undefined,
    updateConfig: () => undefined,
    logger,
  });
  await hooks['astro:config:done']?.({ config });
  let middleware: Middleware | undefined;
  await hooks['astro:server:setup']?.({
    server: { middlewares: { use: (handler: Middleware) => (middleware = handler) } },
    logger,
  });
  /** What the dev server answers for `url`: its status, headers and body, or that it passed it on. */
  const get = (url: string) =>
    new Promise<{ status: number; headers: Record<string, string>; body: string } | 'next'>(
      (resolve) => {
        const headers: Record<string, string> = {};
        const response = {
          statusCode: 200,
          setHeader: (name: string, value: string) => (headers[name] = value),
          end: (body?: string | Buffer) => {
            resolve({ status: response.statusCode, headers, body: String(body ?? '') });
          },
        };
        middleware?.({ url, method: 'GET' }, response, () => {
          resolve('next');
        });
      },
    );
  return { get, warn, hasMiddleware: () => middleware !== undefined };
}

describe('ondocs/astro under astro dev, with an adapter', () => {
  it('serves the index the last build wrote at its path, and nothing else', async () => {
    const server = await devServer();
    expect(server.hasMiddleware()).toBe(true);
    await mkdir(join(root, 'dist/client'), { recursive: true });
    await writeFile(join(root, 'dist/client/ask-index.json'), '{"format":"x"}');
    expect(await server.get('/ask-index.json?v=1')).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: '{"format":"x"}',
    });
    expect(await server.get('/docs/')).toBe('next');
  });

  it('falls back to the output folder, and serves the index under the site’s base', async () => {
    const server = await devServer('/docs/');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist/ask-index.json'), '{}');
    expect(await server.get('/docs/ask-index.json')).toMatchObject({ status: 200, body: '{}' });
    expect(await server.get('/ask-index.json')).toBe('next');
  });

  it('answers 404 before the first build, and says once to run one', async () => {
    const server = await devServer();
    expect(await server.get('/ask-index.json')).toEqual({ status: 404, headers: {}, body: '' });
    expect(await server.get('/ask-index.json')).toMatchObject({ status: 404 });
    expect(server.warn).toEqual([
      `No index yet for the ask endpoint: run astro build once, and it answers from ${join('dist', 'client', 'ask-index.json')}.`,
    ]);
  });

  it('answers 500 when the index is there but cannot be read', async () => {
    const server = await devServer();
    // A folder where the file should be: it exists, and reading it fails.
    await mkdir(join(root, 'dist/client/ask-index.json'), { recursive: true });
    expect(await server.get('/ask-index.json')).toEqual({ status: 500, headers: {}, body: '' });
  });
});
