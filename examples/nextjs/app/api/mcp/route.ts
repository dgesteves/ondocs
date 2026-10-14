import { withMcpCounter } from '../../../lib/counters';
import { mcpHandler } from '../../../lib/mcp-handler';

// A counter line for each connection and tool call, with the client's name (lib/counters.ts).
const handler = withMcpCounter(mcpHandler);

// MCP's Streamable HTTP transport: JSON-RPC over POST. The handler answers GET and DELETE with a
// 405, as a stateless server does, and OPTIONS for browser clients.
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
