// `ondocs dev`: the ask endpoint on this machine, answering from a built index, so the dialog
// on a site's dev server has something to post to. Node.js only.
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { EmbeddingModel, LanguageModel } from 'ai';

import type { EmbeddingProviderOptions } from '../build';
import type { AskIndexFile } from '../index-file';
import { mcpInstallLinks } from '../mcp-install';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../mock';
import { readIndexFile } from '../node';
import { importOptional } from '../node/optional';
import { workersAiEmbedding } from '../node/workers-ai';
import type { RetrievalOptions } from '../search/retrieve';
import { createAskHandler, createMcpHandler, memoryRateLimit } from '../server';
import { CORS_HEADERS as MCP_CORS_HEADERS } from '../server/mcp';
import type { CliIO } from './main';

export const DEV_USAGE = `Usage: ondocs dev [options]

Serves POST /api/ask on this machine, answering from an index, for the dialog on a site's dev
server, and the same index as an MCP server at /api/mcp, for your editor's agent. Questions are
embedded as the index was: with the mock model, with OpenAI or AI Gateway (set OPENAI_API_KEY or
AI_GATEWAY_API_KEY), with Workers AI (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN), or not
at all for a keyword-only index. Answers come from OpenAI when OPENAI_API_KEY is set, else from
the mock model.

Options:
      --index <file>           Index file (default: ask-index.json, then build/ask-index.json,
                               dist/ask-index.json, dist/client/ask-index.json, VitePress's
                               .vitepress/dist/ask-index.json or docs/.vitepress/dist/ask-index.json,
                               or public/, site/ or _site/ask-index.json)
      --port <n>               Port on 127.0.0.1 (default: 8787)
      --allow-origin <origin>  Another origin allowed to call it, such as https://docs.example.com;
                               repeatable, or * for any (default: localhost, 127.0.0.1 and [::1]
                               origins, on any port)
      --model <id>             OpenAI model for answers (default: gpt-5.4-mini)
  -h, --help                   Show this help

.env and .env.local in the working directory are loaded first. A rebuilt index is picked up on
the next question. Up to 30 questions a minute are answered.`;

/**
 * Where `dev` looks for an index: the CLI's output, then Docusaurus's, Astro's and VitePress's
 * build output. Astro writes a static site to `dist/`, and a site with an adapter (server output)
 * to `dist/client/`. VitePress builds into `.vitepress/dist/` next to the docs, at the root or, as
 * `vitepress init` suggests, in `docs/`. Then the folders `ondocs init` has `ondocs index -o` write
 * to for a site no plugin builds: `public/` for Hugo and for Next.js on GitHub Pages, `site/` for
 * MkDocs, and `_site/` for Jekyll and Eleventy.
 */
export const INDEX_FILES = [
  'ask-index.json',
  'build/ask-index.json',
  'dist/ask-index.json',
  'dist/client/ask-index.json',
  '.vitepress/dist/ask-index.json',
  'docs/.vitepress/dist/ask-index.json',
  'public/ask-index.json',
  'site/ask-index.json',
  '_site/ask-index.json',
];

/** A setup problem to explain, rather than a crash. */
export class DevError extends Error {}

/**
 * The index's model is not one `ondocs dev` loads by its id (OpenAI's, AI Gateway's, Workers AI's
 * or the mock one), so no key helps: only the model it was built with does.
 */
export class UnknownEmbeddingModelError extends DevError {}

export interface DevModels {
  model: LanguageModel;
  embeddingModel?: EmbeddingModel;
  embeddingProviderOptions?: EmbeddingProviderOptions;
  retrieval?: RetrievalOptions;
  /** How questions are embedded and answered, for the log. */
  description: string;
}

/**
 * The models that answer from `index`: questions embedded with the model the index was built with
 * (the mock one, OpenAI's, or AI Gateway's), and answers from OpenAI (or AI Gateway) when its key
 * is set, else from the mock model. Throws a {@link DevError} when the index's model cannot be
 * used here.
 */
export async function devModels(
  index: AskIndexFile,
  env: Record<string, string | undefined>,
  answerModel = 'gpt-5.4-mini',
): Promise<DevModels> {
  const { OPENAI_API_KEY, AI_GATEWAY_API_KEY, OPENAI_BASE_URL } = env;
  let openai: ReturnType<(typeof import('@ai-sdk/openai'))['createOpenAI']> | undefined;
  const openaiProvider = async () => {
    if (openai) return openai;
    const provider = await importOptional<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
    if (!provider) {
      throw new DevError(
        'OPENAI_API_KEY is set, but @ai-sdk/openai is not installed: npm i @ai-sdk/openai',
      );
    }
    openai = provider.createOpenAI({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
    });
    return openai;
  };

  const [model, answers]: [LanguageModel, string] = OPENAI_API_KEY
    ? [(await openaiProvider())(answerModel), `answers from ${answerModel}`]
    : AI_GATEWAY_API_KEY
      ? [`openai/${answerModel}`, `answers from openai/${answerModel} through AI Gateway`]
      : [mockLanguageModel(), 'answers from the mock model, which quotes the sources'];

  const embedding = index.embedding;
  if (!embedding) return { model, description: `keyword-only retrieval, ${answers}` };

  const mock = /^mock-hash-(\d+)$/.exec(embedding.model);
  if (mock) {
    return {
      model,
      embeddingModel: mockEmbeddingModel({ dimensions: Number(mock[1]) }),
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      description: `mock embeddings, ${answers}`,
    };
  }

  // Workers AI's, through Cloudflare's REST API with your account's token.
  if (embedding.model.startsWith('@cf/')) {
    const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = env;
    if (!accountId || !apiToken) {
      throw new DevError(
        `The index was embedded with ${embedding.model}, so questions must be too: set ` +
          'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token allowed to run Workers AI). ' +
          'To try it without them, rebuild the index with --embedding mock.',
      );
    }
    return {
      model,
      embeddingModel: workersAiEmbedding(embedding.model, {
        accountId,
        apiToken,
        ...(env.CLOUDFLARE_API_BASE_URL ? { baseUrl: env.CLOUDFLARE_API_BASE_URL } : {}),
      }),
      description: `${embedding.model} embeddings from Workers AI, ${answers}`,
    };
  }

  // OpenAI's own ids are bare (`text-embedding-3-small`); AI Gateway's name the provider.
  const gateway = embedding.model.includes('/');
  const bare = embedding.model.replace(/^openai\//, '');
  const fromOpenAI = gateway
    ? embedding.model.startsWith('openai/')
    : bare.startsWith('text-embedding-');
  // text-embedding-3 models take a size; the index records the one it was built with.
  const embeddingProviderOptions = bare.startsWith('text-embedding-3-')
    ? { openai: { dimensions: embedding.dimensions } }
    : undefined;
  const sized = embeddingProviderOptions ? { embeddingProviderOptions } : {};
  if (fromOpenAI && OPENAI_API_KEY) {
    return {
      model,
      embeddingModel: (await openaiProvider()).embedding(bare),
      ...sized,
      description: `${bare} embeddings from OpenAI, ${answers}`,
    };
  }
  if ((gateway || fromOpenAI) && AI_GATEWAY_API_KEY) {
    const id = gateway ? embedding.model : `openai/${bare}`;
    return {
      model,
      embeddingModel: id,
      ...sized,
      description: `${id} embeddings through AI Gateway, ${answers}`,
    };
  }
  if (fromOpenAI || gateway) {
    throw new DevError(
      `The index was embedded with ${embedding.model}, so questions must be too: set ` +
        `${fromOpenAI ? 'OPENAI_API_KEY or ' : ''}AI_GATEWAY_API_KEY. To try it without a key, ` +
        'rebuild the index with --embedding mock.',
    );
  }
  throw new UnknownEmbeddingModelError(
    `The index was embedded with ${embedding.model}, which ondocs dev cannot load: it ` +
      'embeds with OpenAI, AI Gateway, Workers AI or the mock model. Serve this index with your own ' +
      'createAskHandler, or rebuild it with --embedding mock to try it.',
  );
}

/** The index to serve: `--index`, else the first of {@link INDEX_FILES} in `cwd`. */
export function findIndexFile(cwd: string, index?: string): string {
  if (index !== undefined) {
    const file = resolve(cwd, index);
    if (!existsSync(file)) throw new DevError(`No index at ${index}.`);
    return file;
  }
  const file = INDEX_FILES.map((name) => resolve(cwd, name)).find((path) => existsSync(path));
  if (file) return file;
  throw new DevError(
    `No index found: looked for ${INDEX_FILES.join(', ')}. Build one with ` +
      '`ondocs index <dir>` (or your site’s build, with the Docusaurus, Astro, Starlight or ' +
      'VitePress plugin), or pass --index <file>.',
  );
}

export interface DevServerOptions {
  /** The index file, absolute. */
  file: string;
  /** Default 8787; 0 picks a free port. */
  port?: number;
  /**
   * Origins allowed to call the endpoint besides local ones (localhost, 127.0.0.1 and [::1], on
   * any port), or `*` for any.
   */
  origins?: readonly string[];
  /** OpenAI model for answers, when OPENAI_API_KEY is set. */
  answerModel?: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  error: (line: string) => void;
}

export interface DevServer {
  /** `http://localhost:<port>/api/ask` */
  endpoint: string;
  /** `http://localhost:<port>/api/mcp` */
  mcp: string;
  /** How questions are embedded and answered. */
  description: string;
  chunks: number;
  close: () => Promise<void>;
}

/** Largest request body `dev` reads, as `createAskHandler`'s default `maxBodyBytes`. */
const MAX_BODY_BYTES = 64 * 1024;

/** `localhost`, a name under it, `127.0.0.1` or `[::1]`: names only this machine answers to. */
const LOCAL_HOSTNAME = /^(?:(?:[a-z\d-]+\.)*localhost|127\.0\.0\.1|\[::1\])$/i;

/** Whether a `Host` header names this machine (with any port), not a name that resolves to it. */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '');
  return LOCAL_HOSTNAME.test(name);
}

/** Whether an `Origin` is a page served from this machine: http(s) on a local host name. */
export function isLocalOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && isLocalHost(url.host);
}

/**
 * Serves `createAskHandler` at `/api/ask` on 127.0.0.1. Only pages on this machine may call it,
 * plus any of `origins`, so a site you visit cannot spend your key through it; requests must name
 * this machine in `Host` (which defeats DNS rebinding, where another name resolves to 127.0.0.1);
 * and bodies are capped as the handler caps them. The index is read again, with its models chosen
 * again, when the file changes, so rebuilding the site is enough.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const origins = options.origins ?? [];
  const anyOrigin = origins.includes('*');
  const originAllowed = (origin: string): boolean =>
    anyOrigin || isLocalOrigin(origin) || origins.includes(origin);
  const load = async () => {
    const index = await readIndexFile(options.file);
    if (!index) throw new DevError(`No index at ${options.file}.`);
    const { description, ...models } = await devModels(index, options.env, options.answerModel);
    const handler = createAskHandler({
      index,
      ...models,
      // Every question comes from this machine, so one bucket, roomier than a public endpoint's
      // default, still bounds what a runaway page can spend of your key.
      rateLimit: memoryRateLimit({ limit: 30, windowMs: 60_000, key: () => 'local' }),
      onFinish: ({ question, refused, lowConfidence, sources, followUp }) => {
        const outcome = refused
          ? 'refused'
          : `answered from ${String(sources.length)} sources${lowConfidence ? ', citing none' : ''}`;
        const rewritten = followUp ? ` (asked as: ${followUp.question})` : '';
        options.log(`  ${outcome}: ${question}${rewritten}`);
      },
      // The dialog offers thumbs and a comment when the endpoint takes them; here they are only
      // printed, to try it.
      onFeedback: ({ rating, comment, question }) => {
        options.log(
          `  feedback ${rating === 'up' ? 'up' : 'down'}: ${question}${comment ? ` (${comment})` : ''}`,
        );
      },
      onError: (error) => {
        options.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    // The MCP endpoint, keyword-only as by default: it calls no model, so it spends nothing.
    const mcp = createMcpHandler({
      index,
      siteName: 'the docs',
      // The site runs on another port, which this server does not know: keep the index's paths.
      siteUrl: false,
      rateLimit: memoryRateLimit({ limit: 120, windowMs: 60_000, key: () => 'local' }),
      // The server checks Host and Origin itself, before the request gets here.
      allowedOrigins: '*',
      onToolCall: ({ tool, arguments: args, isError }) => {
        const detail = [args.query, args.id, args.prefix].find(
          (value) => typeof value === 'string',
        );
        options.log(`  mcp ${tool}${isError ? ' (error)' : ''}: ${detail ?? ''}`);
      },
      onError: (error) => {
        options.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    return { handler, mcp, description, chunks: index.chunks.length };
  };

  let current = await load();
  let loadedAt = (await stat(options.file)).mtimeMs;
  // A rebuilt index replaces the handler before the next question is answered.
  const handlerFor = async () => {
    const modified = (await stat(options.file)).mtimeMs;
    if (modified !== loadedAt) {
      loadedAt = modified;
      current = await load();
      options.log(`Reloaded the index (${String(current.chunks)} chunks).`);
    }
    return current;
  };

  const cors = (request: IncomingMessage, path?: string): Record<string, string> => {
    const origin = request.headers.origin;
    const allowed = anyOrigin ? '*' : origin && originAllowed(origin) ? origin : undefined;
    const mcp = path === '/api/mcp';
    return {
      ...(allowed ? { 'access-control-allow-origin': allowed } : {}),
      'access-control-allow-methods': 'POST, OPTIONS',
      // A browser MCP client sends the headers the MCP handler allows, Mcp-Method and Mcp-Name
      // among them on 2026-07-28.
      'access-control-allow-headers': mcp ? MCP_CORS_HEADERS : 'content-type, mcp-protocol-version',
      // The dialog reads how long to wait after a 429, and an MCP client the version answered.
      'access-control-expose-headers': mcp ? 'mcp-protocol-version, retry-after' : 'retry-after',
      ...(allowed === '*' ? {} : { vary: 'origin' }),
    };
  };

  const refuse = (
    request: IncomingMessage,
    response: ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void => {
    response.writeHead(status, {
      'content-type': 'application/json',
      connection: 'close',
      ...cors(request),
    });
    response.end(JSON.stringify({ error: { code, message } }));
  };

  const server = createServer((request, response) => {
    void serve(request, response).catch((error: unknown) => {
      options.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json', ...cors(request) });
      }
      response.end(
        JSON.stringify({ error: { code: 'internal_error', message: 'See the dev server log.' } }),
      );
    });
  });

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A page on another site can reach 127.0.0.1 through a name it controls that resolves there
    // (DNS rebinding), and then its requests are same-origin, so CORS cannot stop them. Its Host
    // header still carries that name.
    if (!isLocalHost(request.headers.host)) {
      options.error(`  ✗ Refused a request for host ${request.headers.host ?? '(none)'}.`);
      refuse(request, response, 403, 'forbidden', 'ondocs dev only answers on localhost.');
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !originAllowed(origin)) {
      options.error(
        origin === 'null'
          ? '  ✗ Refused a request from origin null: a page opened from a file, or in a sandboxed frame, has no origin to allow. Serve it over http://localhost.'
          : `  ✗ Refused a request from ${origin}: pass --allow-origin ${origin} to allow it.`,
      );
      refuse(request, response, 403, 'forbidden', `Origin ${origin} is not allowed.`);
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/ask' && url.pathname !== '/api/mcp') {
      response.writeHead(404, { 'content-type': 'application/json', ...cors(request) });
      response.end(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: 'ondocs dev answers POST /api/ask, and MCP at /api/mcp.',
          },
        }),
      );
      return;
    }
    const tooLarge = (): void => {
      refuse(request, response, 413, 'payload_too_large', 'Request body too large.');
      // Discard what is left of it for a moment, so the client reads the 413 rather than a reset,
      // then hang up: an endless upload must not keep the connection.
      request.resume();
      response.on('finish', () => {
        setTimeout(() => request.destroy(), 1000).unref();
      });
    };
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      tooLarge();
      return;
    }
    const body = await readBody(request, MAX_BODY_BYTES);
    if (body === null) {
      tooLarge();
      return;
    }
    // Stops the answer when the browser goes away, as a platform would.
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) controller.abort();
    });
    const method = request.method ?? 'GET';
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const handlers = await handlerFor();
    const answer = await (url.pathname === '/api/mcp' ? handlers.mcp : handlers.handler)(
      new Request(url, {
        method,
        headers,
        signal: controller.signal,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
      }),
    );
    response.writeHead(answer.status, {
      ...Object.fromEntries(answer.headers),
      ...cors(request, url.pathname),
    });
    if (answer.body) {
      for await (const chunk of answer.body) response.write(chunk);
    }
    response.end();
  }

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new DevError(`Port ${String(options.port ?? 8787)} is in use: pass --port <n>.`)
          : error,
      );
    });
    server.listen(options.port ?? 8787, '127.0.0.1', () => {
      const address = server.address();
      resolvePort(typeof address === 'object' && address ? address.port : 0);
    });
  });

  return {
    endpoint: `http://localhost:${String(port)}/api/ask`,
    mcp: `http://localhost:${String(port)}/api/mcp`,
    description: current.description,
    chunks: current.chunks,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections();
        server.close(() => {
          resolveClose();
        });
      }),
  };
}

/**
 * The request body, or `null` as soon as it passes `limit` bytes, without reading the rest: a
 * chunked upload has no length to check up front, and could otherwise go on forever.
 */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer<ArrayBuffer> | null> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.byteLength;
      if (size <= limit) {
        chunks.push(chunk);
        return;
      }
      request.off('data', onData).off('end', onEnd).pause();
      resolveBody(null);
    };
    const onEnd = (): void => {
      resolveBody(Buffer.concat(chunks));
    };
    request.on('data', onData).once('end', onEnd).once('error', reject);
  });
}

/** Aborts on Ctrl+C or a termination signal. */
function untilInterrupted(): AbortSignal {
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) {
    process.once(name, () => {
      controller.abort();
    });
  }
  return controller.signal;
}

/** `ondocs dev`: runs until `io.signal` aborts (Ctrl+C by default). Returns the exit code. */
export async function dev(args: string[], io: CliIO): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      options: {
        index: { type: 'string' },
        port: { type: 'string' },
        'allow-origin': { type: 'string', multiple: true },
        // The flag's earlier name.
        origin: { type: 'string', multiple: true },
        model: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${DEV_USAGE}`);
    return 2;
  }
  if (values.help) {
    io.stdout(DEV_USAGE);
    return 0;
  }
  const port = Number(values.port ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    io.stderr('--port must be a port number.');
    return 2;
  }

  const origins = [...(values['allow-origin'] ?? []), ...(values.origin ?? [])];
  const invalid = origins.find((origin) => origin !== '*' && !/^https?:\/\/[^/]+$/.test(origin));
  if (invalid !== undefined) {
    io.stderr(
      `--allow-origin takes an origin, such as https://docs.example.com, or * (got ${invalid}).`,
    );
    return 2;
  }

  let server: DevServer;
  let file: string;
  try {
    file = findIndexFile(io.cwd, values.index);
    server = await startDevServer({
      file,
      port,
      origins,
      ...(values.model ? { answerModel: values.model } : {}),
      env: io.env,
      log: io.stdout,
      error: io.stderr,
    });
  } catch (error) {
    if (!(error instanceof DevError)) throw error;
    io.stderr(`✗ ${error.message}`);
    return 1;
  }

  const { endpoint } = server;
  const label = relative(io.cwd, file) || file;
  const cors = origins.includes('*') ? 'any origin' : ['localhost', ...origins].join(', ');
  const mcp = mcpInstallLinks({ url: server.mcp, name: 'docs' });
  io.stdout(
    [
      `ondocs dev: ${label} (${String(server.chunks)} chunks), ${server.description}`,
      '',
      `  Endpoint  ${endpoint}  (CORS: ${cors})`,
      `  MCP       ${server.mcp}`,
      `            Claude Code  ${mcp.claudeCode}`,
      `            Codex        ${mcp.codex}`,
      `            Gemini CLI   ${mcp.gemini}`,
      '',
      'Point the dialog at it:',
      `  Docusaurus, Astro, Starlight, VitePress  start the site with ASK_ENDPOINT=${endpoint}`,
      `                                           or set endpoint: '${endpoint}' in the plugin's options`,
      `  React                                    <AskDialog endpoint="${endpoint}" />`,
      `  Script embed                             data-endpoint="${endpoint}"`,
      '',
      'Ctrl+C stops it.',
    ].join('\n'),
  );

  const signal = io.signal ?? untilInterrupted();
  if (!signal.aborted) {
    await new Promise((resolveAbort) => {
      signal.addEventListener('abort', resolveAbort, { once: true });
    });
  }
  await server.close();
  return 0;
}
