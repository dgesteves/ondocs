// The home page's For agents section shows what this site's MCP server returns for a search,
// asked while the page is built (examples/nextjs/lib/mcp-sample.ts).
import { describe, expect, it, vi } from 'vitest';

type McpSample = (
  query: string,
  shown?: number,
) => Promise<{ query: string; found: number; results: Record<string, string>[] } | null>;
// Imported by path, so the typecheck does not follow it to the site's index, which only its build
// writes.
const samplePath = 'lib/mcp-sample.ts';
const { mcpSample } = (await import(/* @vite-ignore */ `../examples/nextjs/${samplePath}`)) as {
  mcpSample: McpSample;
};

// The site's MCP handler, over this repository's test corpus in place of the site's index.
vi.mock('../examples/nextjs/lib/mcp-handler', async () => {
  const { buildIndex } = await import('../src');
  const { createMcpHandler } = await import('../src/server');
  const { corpus } = await import('./helpers');
  const { index } = await buildIndex({ documents: corpus });
  return {
    mcpHandler: createMcpHandler({
      index,
      siteName: 'the Acme docs',
      siteUrl: 'https://docs.example.com',
    }),
  };
});

describe('the For agents sample', () => {
  it('is the real search result: the first section found, with its absolute URL and snippet', async () => {
    const sample = await mcpSample('token bucket per client');
    expect(sample?.query).toBe('token bucket per client');
    expect(sample?.found).toBeGreaterThanOrEqual(1);
    expect(sample?.results).toEqual([
      {
        id: '/docs/rate-limits#in-memory',
        title: 'Rate limiting',
        heading: 'In memory',
        url: 'https://docs.example.com/docs/rate-limits#in-memory',
        text: 'memoryRateLimit keeps a token bucket per client IP inside one process.',
      },
    ]);
    // Only the first ones show, out of all it found.
    const two = await mcpSample('rate limit', 2);
    expect(two?.results).toHaveLength(2);
    expect(two?.found).toBeGreaterThan(2);
  });

  it('is left out when nothing matches', async () => {
    expect(await mcpSample('zzzz qqqq')).toBeNull();
  });
});
