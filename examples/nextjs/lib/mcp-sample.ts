import { mcpHandler } from './mcp-handler';

export interface McpSample {
  query: string;
  /** How many sections the search found. */
  found: number;
  /** The first results, as `structuredContent` holds them. */
  results: Record<string, string>[];
}

/**
 * What this site's MCP server gives an agent that calls `search` with `query`, asked once while
 * the home page is built, so the page shows a real result rather than a made-up one. If it fails,
 * the page shows none.
 */
export async function mcpSample(query: string, shown = 1): Promise<McpSample | null> {
  try {
    const response = await mcpHandler(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query } },
        }),
      }),
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      result?: { structuredContent?: { results?: Record<string, string>[] } };
    };
    const results = body.result?.structuredContent?.results ?? [];
    return results.length > 0
      ? { query, found: results.length, results: results.slice(0, shown) }
      : null;
  } catch {
    return null;
  }
}
