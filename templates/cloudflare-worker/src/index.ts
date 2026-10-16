// The Worker that answers questions for your docs, with Workers AI: no API key to set, and within
// Workers AI's free daily allowance for a small site. Written by `npx ondocs init`: edit it as you
// like, and init asks before it overwrites it.
//
// It fetches the index from the live site, SITE_URL/ask-index.json, and checks it again every five
// minutes, so it follows the site's deploys. The site's pages call it across origins, so it sends
// CORS headers for SITE_URL's origin, and only for it.
//
// Questions are embedded with the Workers AI model the index records, as with `ondocs index -e
// workers-ai:@cf/baai/bge-small-en-v1.5`, and matched on keywords for an index built without one.
// CHAT_MODEL, in wrangler.jsonc, writes the answers.
//
// Deploy with `npx wrangler deploy`.
import {
  createAskHandler,
  createMcpHandler,
  memoryRateLimit,
  remoteIndex,
  turnstile,
} from 'ondocs/server';
import { createWorkersAI } from 'workers-ai-provider';

interface Env {
  /** The site's URL, with its base path. */
  SITE_URL: string;
  /** The Workers AI model that writes the answers. */
  CHAT_MODEL: string;
  AI: Ai;
  /** A Turnstile widget's secret key, for a bot check on each question. */
  TURNSTILE_SECRET_KEY?: string;
}

type Handler = (request: Request) => Promise<Response>;
let handlers: Promise<{ ask: Handler; mcp: Handler }> | undefined;

/** The site's URL, with a trailing slash, as a base for its files' URLs. */
const siteOf = (env: Env): URL => new URL(`${env.SITE_URL.replace(/\/+$/, '')}/`);

/** CORS for the site's origin, and only for it. The dialog reads Retry-After on a 429. */
const corsFor = (env: Env): Record<string, string> => ({
  'access-control-allow-origin': siteOf(env).origin,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'retry-after',
  'access-control-max-age': '86400',
  vary: 'origin',
});

/** The endpoints, made on the first request, once the index has been fetched. */
async function create(env: Env) {
  const index = remoteIndex(new URL('ask-index.json', siteOf(env)));
  const workersai = createWorkersAI({ binding: env.AI });
  // Questions are embedded as the index was: with its Workers AI model. An index embedded with
  // another provider's model is searched by keywords instead.
  const { embedding } = await index();
  const embeddingModel = embedding?.model.startsWith('@cf/')
    ? workersai.textEmbedding(embedding.model)
    : undefined;
  if (embedding && !embeddingModel) {
    console.warn(
      `[ondocs] The index was embedded with ${embedding.model}, which Workers AI does not run, so questions are matched on keywords. Build it with -e workers-ai:@cf/baai/bge-small-en-v1.5, or -e none.`,
    );
  }
  const cors = corsFor(env);
  return {
    ask: createAskHandler({
      index,
      model: workersai(env.CHAT_MODEL),
      ...(embeddingModel ? { embeddingModel } : {}),
      siteName: 'your docs',
      // 10 questions a minute per client, keyed on cf-connecting-ip, the client IP Cloudflare sets.
      rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000, trustedHeader: 'cf-connecting-ip' }),
      // A daily cap, counted per instance: about Workers AI's free allowance of 10,000 neurons with
      // Llama 4 Scout, at some 3,000 tokens a question. On the Workers Free plan nothing is charged
      // past the allowance; on Workers Paid, raise these to what you will spend.
      budget: { requestsPerDay: 100, tokensPerDay: 300_000 },
      // A question asked again is answered from memory, without a model call.
      answerCache: true,
      // A bot check on each question, once TURNSTILE_SECRET_KEY holds a Turnstile widget's secret
      // key. Give the dialog the widget's site key as challenge.turnstile.
      ...(env.TURNSTILE_SECRET_KEY
        ? { challenge: turnstile({ secretKey: env.TURNSTILE_SECRET_KEY }) }
        : {}),
      // The site's pages post here from their own origin.
      headers: cors,
    }),
    mcp: createMcpHandler({
      index,
      siteName: 'your docs',
      // 60 tool calls a minute per client, keyed on cf-connecting-ip, the client IP Cloudflare sets.
      rateLimit: memoryRateLimit({ limit: 60, windowMs: 60_000, trustedHeader: 'cf-connecting-ip' }),
      // Results link to the pages on the site, not on this Worker.
      siteUrl: siteOf(env).origin,
    }),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api/ask' && pathname !== '/api/mcp') {
      return new Response('Not found', { status: 404 });
    }
    handlers ??= create(env).catch((error: unknown) => {
      handlers = undefined;
      throw error;
    });
    let ready: Awaited<typeof handlers>;
    try {
      ready = await handlers;
    } catch (error) {
      // The index could not be fetched or used; the next request tries again.
      console.error('[ondocs]', error);
      return Response.json(
        { error: { code: 'internal_error', message: 'The ask endpoint is misconfigured.' } },
        { status: 500, headers: corsFor(env) },
      );
    }
    return pathname === '/api/ask' ? ready.ask(request) : ready.mcp(request);
  },
};
