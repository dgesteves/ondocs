// `ondocs dev`'s CORS headers for pages and clients on this machine: a browser MCP client's
// preflight gets the headers the MCP handler allows, the dialog can read Retry-After on a 429
// from another port, and a page with origin null is told why it is refused.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex } from '../src';
import { startDevServer, type DevServer } from '../src/cli/dev';
import { mockEmbeddingModel } from '../src/mock';
import { writeIndexFile } from '../src/node';
import { corpus } from './helpers';

let root: string;
let server: DevServer;
let logs: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-dev-cors-'));
  const { index } = await buildIndex({ documents: corpus, embeddingModel: mockEmbeddingModel() });
  await writeIndexFile(join(root, 'ask-index.json'), index);
  logs = [];
  server = await startDevServer({
    file: join(root, 'ask-index.json'),
    port: 0,
    env: {},
    log: (line) => logs.push(line),
    error: (line) => logs.push(line),
  });
});
afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

/** A page on another port of this machine, such as the MCP Inspector's. */
const ORIGIN = 'http://localhost:6274';

describe('ondocs dev’s CORS headers', () => {
  it('let a browser MCP client send 2026-07-28’s Mcp-Method and Mcp-Name', async () => {
    const preflight = await fetch(server.mcp, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,mcp-protocol-version,mcp-method,mcp-name',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').split(/,\s*/);
    expect(allowed).toEqual(
      expect.arrayContaining(['content-type', 'mcp-protocol-version', 'mcp-method', 'mcp-name']),
    );
    expect(preflight.headers.get('access-control-expose-headers')).toContain(
      'mcp-protocol-version',
    );
  });

  it('let the dialog on another port read Retry-After', async () => {
    const response = await fetch(server.endpoint, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How is an int8 vector scaled?' }),
    });
    await response.body?.cancel();
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-expose-headers')).toBe('retry-after');
  });

  it('say why a page with origin null is refused, rather than a flag that refuses it too', async () => {
    const response = await fetch(server.endpoint, {
      method: 'POST',
      headers: { origin: 'null', 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'int8' }),
    });
    expect(response.status).toBe(403);
    const line = logs.find((entry) => entry.includes('origin null')) ?? '';
    expect(line).toContain('Serve it over http://localhost');
    expect(line).not.toContain('--allow-origin');
  });
});
