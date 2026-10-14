import { DEMO_ORIGINS } from '../app/api/ask/cors';
import { SITE_URL } from './site';

/*
 * Counters for the deployment's logs: one JSON line per question, answer, MCP connection and MCP
 * tool call ({"counter": "ask-request" | "ask" | "mcp", …}), so they can be counted by filtering
 * the logs on "counter", with no store and no key. What was asked or searched for stays out of
 * them. Of what a client sends, only these go in: its Origin when it is this site's or a live
 * demo's, the name of one of the MCP tools, and the MCP client's name (printable ASCII, cut to 100
 * characters).
 */

type Handler = (request: Request) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** The `error.code` of an error answer, as ondocs writes it, or null. */
async function errorCode(response: Response): Promise<string | null> {
  if (!response.headers.get('content-type')?.startsWith('application/json')) return null;
  try {
    const { code } = record(record(await response.clone().json()).error);
    return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * Where a question came from: this site or one of the live demos (app/api/ask/cors.ts), by their
 * origin; "other" for any other origin; null for a request with none, such as curl's.
 */
function askedFrom(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin === null) return null;
  return origin === SITE_URL || DEMO_ORIGINS.has(origin) ? origin : 'other';
}

/**
 * The Ask endpoint, logging a line for each question posted to it: where from, and how it was
 * answered, with the error's code, so a 429 says whether the daily budget (`budget_exceeded`) or
 * the per-visitor limit (`rate_limited`) turned it away.
 */
export function withAskCounter(handler: Handler): Handler {
  return async (request) => {
    const response = await handler(request);
    if (request.method === 'POST') {
      const line = {
        counter: 'ask-request',
        from: askedFrom(request),
        status: response.status,
        code: response.ok ? null : await errorCode(response),
      };
      console.info(JSON.stringify(line));
    }
    return response;
  };
}

/** What `askCount` reads of ondocs's `AskFinishEvent`. */
export interface FinishedAnswer {
  cached: boolean;
  refused: boolean;
  lowConfidence: boolean;
  usage?: { totalTokens?: number | undefined } | undefined;
  followUp?: { usage?: { totalTokens?: number | undefined } | undefined } | undefined;
}

/**
 * The line for an answer, from the Ask handler's `onFinish`: the model tokens it spent, the
 * follow-up's rewrite included, to size the budget's `tokensPerDay` from.
 */
export function askCount(event: FinishedAnswer) {
  return {
    counter: 'ask',
    cached: event.cached,
    refused: event.refused,
    lowConfidence: event.lowConfidence,
    tokens: (event.usage?.totalTokens ?? 0) + (event.followUp?.usage?.totalTokens ?? 0),
  };
}

/**
 * The MCP requests counted: a connection (`initialize`, or `server/discover` on 2026-07-28) and a
 * tool call.
 */
const COUNTED: ReadonlySet<string> = new Set(['initialize', 'server/discover', 'tools/call']);

/** The tools ondocs serves (its `tools/list`), the only tool names a counter line holds. */
export const MCP_TOOLS: ReadonlySet<string> = new Set(['search', 'fetch', 'list_pages']);

/** A client's `clientInfo.name`: printable ASCII, cut to 100 characters, or null. */
function clientName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.slice(0, 100);
  return /^[\x20-\x7e]+$/.test(name) ? name : null;
}

/**
 * The line for an MCP request: a connection or a tool call, with the client's `clientInfo.name`.
 * MCP 2026-07-28 sends it with every request, in `_meta`; before it, only `initialize` does.
 * Other requests are not counted.
 *
 * Nor is a call that names no tool of this server, or passes arguments that are not an object:
 * ondocs answers those with an error before its rate limit and runs nothing, so counting them
 * would log text anyone can send, as often as they like, as a tool call.
 */
function mcpCount(message: unknown, status: number) {
  const { method, params } = record(message);
  if (typeof method !== 'string' || !COUNTED.has(method)) return null;
  const { name, arguments: args, clientInfo, _meta } = record(params);
  let tool: string | null = null;
  if (method === 'tools/call') {
    if (typeof name !== 'string' || !MCP_TOOLS.has(name)) return null;
    // ondocs reads a missing or null `arguments` as {}.
    if (args !== undefined && args !== null && !isRecord(args)) return null;
    tool = name;
  }
  const client = record(clientInfo ?? record(_meta)['io.modelcontextprotocol/clientInfo']).name;
  return { counter: 'mcp', method, tool, client: clientName(client), status };
}

/**
 * Whether ondocs answered with a JSON-RPC error in a 200 (a method or tool it does not have)
 * rather than a result. Its answers are JSON, already in memory.
 */
async function rpcErrorIn(response: Response): Promise<boolean> {
  if (response.status !== 200) return false;
  if (!response.headers.get('content-type')?.startsWith('application/json')) return false;
  return 'error' in record(await response.clone().json());
}

/**
 * The MCP endpoint, logging a line for each connection it answered (200) and each call to one of
 * its tools that it ran (200, the tool's result, or the error in it the agent reads) or turned
 * away (429). A 200 can also carry a JSON-RPC error instead of a result: those are not counted.
 */
export function withMcpCounter(handler: Handler): Handler {
  return async (request) => {
    const copy = request.method === 'POST' ? request.clone() : undefined;
    const response = await handler(request);
    // Either status means ondocs read the body and found it a JSON-RPC message under its size
    // limit.
    if (copy && (response.status === 200 || response.status === 429)) {
      try {
        const line = mcpCount(JSON.parse(await copy.text()), response.status);
        if (line && !(await rpcErrorIn(response))) console.info(JSON.stringify(line));
      } catch {
        // Not counted.
      }
    }
    return response;
  };
}
