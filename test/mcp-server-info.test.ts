// What the MCP endpoint says it is, which clients show beside its tools: `name` and `version`.
// A site that serves its own docs names the server after them, and gives the version that goes
// with that name, rather than reporting a site's name with ondocs's version.
import { describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };
import { buildIndex } from '../src';
import { createMcpHandler, type McpHandlerOptions } from '../src/server';
import { corpus } from './helpers';

const { index } = await buildIndex({ documents: corpus });

/** The server's `serverInfo`, from `initialize` (2025) and from `server/discover` (2026-07-28). */
async function serverInfo(options: Partial<McpHandlerOptions> = {}) {
  const handler = createMcpHandler({ index, siteName: 'the Acme docs', ...options });
  const post = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const response = await handler(
      new Request('https://docs.example.com/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
      }),
    );
    return ((await response.json()) as { result: Record<string, unknown> }).result;
  };
  const initialized = await post({
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  });
  const discovered = await post(
    {
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
    { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' },
  );
  return {
    initialize: initialized.serverInfo,
    discover: (discovered._meta as Record<string, unknown>)['io.modelcontextprotocol/serverInfo'],
  };
}

describe('the MCP server’s name and version', () => {
  it('are ondocs and its own version by default', async () => {
    const expected = {
      name: 'ondocs',
      title: 'Search the Acme docs',
      version: packageJson.version,
    };
    expect(await serverInfo()).toEqual({ initialize: expected, discover: expected });
  });

  it('are the ones given, so a site’s server reports its own name with its own version', async () => {
    const expected = { name: 'onsystem-docs', title: 'Search the Acme docs', version: '0.7.0' };
    expect(await serverInfo({ name: 'onsystem-docs', version: '0.7.0' })).toEqual({
      initialize: expected,
      discover: expected,
    });
  });

  it('keep ondocs’s version under a name of the site’s own when no version is given', async () => {
    const { initialize } = await serverInfo({ name: 'signoff-ui-docs' });
    expect(initialize).toMatchObject({ name: 'signoff-ui-docs', version: packageJson.version });
  });
});
