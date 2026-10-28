import {
  type BudgetOptions,
  type BudgetStore,
  type ChallengeVerifier,
  createAskHandler,
  memoryBudgetStore,
  memoryRateLimit,
  turnstile,
  upstashBudgetStore,
  type UpstashRedisCounterLike,
} from 'ondocs/server';

import index from '../ask-index.json';
import { chatModel, embeddingModel, embeddingProviderOptions, minSimilarity } from './ai';
import { askCount } from './counters';
import { DEMO_ORIGINS, SITE_URL } from './site';

type Env = Readonly<Record<string, string | undefined>>;

/** `next build`, which asks the handler for the home page's sample answer (lib/sample-answer.ts). */
const building = (env: Env): boolean => env.NEXT_PHASE === 'phase-production-build';

/** How long an Upstash command may take before the budget is counted in memory instead. */
export const UPSTASH_TIMEOUT_MS = 1_500;

/**
 * Why a command got no answer, naming Upstash and the command but never the database's URL or
 * token: fetch's own message can quote the URL, and the cause's code (ECONNREFUSED) cannot.
 */
function unanswered(command: string, error: unknown): Error {
  if (error instanceof Object && 'name' in error && error.name === 'TimeoutError') {
    return new Error(
      `Upstash did not answer ${command} within ${String(UPSTASH_TIMEOUT_MS / 1000)} s`,
    );
  }
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = cause instanceof Object && 'code' in cause ? cause.code : undefined;
  return new Error(
    `Upstash could not be reached for ${command}${typeof code === 'string' ? ` (${code})` : ''}`,
  );
}

/**
 * Upstash Redis through its REST API, with the two commands `upstashBudgetStore` runs, so the
 * site needs no Redis client. Each command is a JSON array posted with the token, and Upstash
 * answers `{ result }`, or `{ error }` with an error status. A command throws, with an error that
 * names Upstash, on no answer within `UPSTASH_TIMEOUT_MS`, on an error, and for `INCRBY` on a
 * result that is not a number.
 */
export function upstashRest(
  url: string,
  token: string,
  fetcher: typeof fetch = fetch,
): UpstashRedisCounterLike {
  const command = async (...args: (string | number)[]): Promise<unknown> => {
    const name = String(args[0]);
    let response: Response;
    let text: string;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args.map(String)),
        // Never cached: Next.js would keep the replies, with the URL, in .next/cache.
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      throw unanswered(name, error);
    }
    let body: { result?: unknown; error?: unknown } = {};
    try {
      body = (JSON.parse(text) as typeof body | null) ?? {};
    } catch {
      // Not JSON, as a proxy's error page: the status says the rest.
    }
    if (!response.ok || body.error !== undefined) {
      const reason = typeof body.error === 'string' ? `: ${body.error}` : '';
      throw new Error(`Upstash answered ${name} with HTTP ${String(response.status)}${reason}`);
    }
    return body.result;
  };
  return {
    incrby: async (key, increment) => {
      const result = await command('INCRBY', key, increment);
      // A count, as a number or a string of digits; anything else would count as NaN.
      const total = typeof result === 'string' && /^-?\d+$/.test(result) ? Number(result) : result;
      if (typeof total !== 'number' || !Number.isFinite(total)) {
        throw new Error('Upstash answered INCRBY with a result that is not a number');
      }
      return total;
    },
    expire: (key, seconds) => command('EXPIRE', key, seconds),
  };
}

/** How long the counts stay in memory after Upstash fails, without asking it. */
export const FALLBACK_COOL_OFF_MS = 30_000;
/** At most one line a minute about the shared store failing, per instance. */
const FALLBACK_LOG_MS = 60_000;

/**
 * `shared`, with this instance's memory while it fails (Upstash errs, times out or answers
 * something else than a count), so the endpoint keeps answering: those counts are per instance,
 * as without the Upstash keys, and still capped. After a failure, the counts go to memory for
 * `FALLBACK_COOL_OFF_MS` without asking `shared`, so a hang costs one wait, not one per count;
 * the first count after that asks `shared` again, and a count it answers ends the cool-off.
 * Failures are logged, at most one line a minute. An `EXPIRE` that fails after its `INCRBY`
 * counts that question in both, on the safe side.
 */
export function withMemoryFallback(
  shared: BudgetStore,
  {
    log = console.warn,
    now = () => Date.now(),
  }: { log?: (line: string) => void; now?: () => number } = {},
): BudgetStore {
  const memory = memoryBudgetStore({ now });
  let coolOffUntil = -Infinity;
  let loggedAt = -Infinity;
  let failures = 0;
  return {
    async increment(key, amount, ttlSeconds) {
      if (now() < coolOffUntil) return memory.increment(key, amount, ttlSeconds);
      try {
        const total = await shared.increment(key, amount, ttlSeconds);
        coolOffUntil = -Infinity;
        return total;
      } catch (error) {
        coolOffUntil = now() + FALLBACK_COOL_OFF_MS;
        failures++;
        if (now() - loggedAt >= FALLBACK_LOG_MS) {
          loggedAt = now();
          const reason = error instanceof Error ? error.message : String(error);
          const count = failures > 1 ? ` (${String(failures)} failures since the last line)` : '';
          log(
            `The Upstash budget store failed, so this instance counts in memory for ${String(FALLBACK_COOL_OFF_MS / 1000)} s: ${reason}${count}.`,
          );
          failures = 0;
        }
        return memory.increment(key, amount, ttlSeconds);
      }
    },
  };
}

/**
 * Where the daily budget is counted: in the Upstash database when `KV_REST_API_URL` and
 * `KV_REST_API_TOKEN` are set (the names Vercel's Upstash integration gives them), so every
 * instance shares one budget, with this instance's memory for 30 s after Upstash fails
 * (`withMemoryFallback`); else in each instance's memory, as ondocs does by default. In memory
 * while `next build` runs too, so building the site spends none of the live budget.
 */
export function budgetStore(env: Env, fetcher?: typeof fetch): BudgetStore | undefined {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token || building(env)) return undefined;
  return withMemoryFallback(upstashBudgetStore(upstashRest(url, token, fetcher)));
}

/** The hostnames the site's Turnstile widget may be solved on: this site's and the demos'. */
export const TURNSTILE_HOSTNAMES = [SITE_URL, ...DEMO_ORIGINS].map(
  (origin) => new URL(origin).hostname,
);

/**
 * The bot check on every question, once both of the widget's keys are set:
 * `TURNSTILE_SECRET_KEY` for the endpoint, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, which the site's
 * dialog (components/ask-dialog.tsx) and the home page's inline demo
 * (components/landing/hero-demo.tsx) read: the keys are on or off together, and the dialog and
 * the demo both send a token with each question. Off while `next build` asks the handler for the
 * home page's sample answer (lib/sample-answer.ts): no visitor, so no token. The live demos send
 * one with their own `TURNSTILE_SITE_KEY`, which they need before the site key is set here.
 */
export function askChallenge(env: Env): ChallengeVerifier | undefined {
  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (!secretKey || !env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return undefined;
  if (building(env)) return undefined;
  return turnstile({ secretKey, hostnames: TURNSTILE_HOSTNAMES });
}

/**
 * A daily cap for the whole site and the live demos that send their questions here
 * (`allowedOrigins` below), so rotating IPs cannot run up the bill. Raised for launch week from 300
 * questions and 1M model tokens: an answer is about 3k tokens, so 5M leaves about 3,300 for each
 * of the 1,500 questions and the token cap does not run out first. Back to 300 and 1M after launch
 * week, from Thu 2026-10-29. With the Upstash keys set, the counts are one budget for every
 * instance (`budgetStore`); without them, or while Upstash fails, each instance has its own. The
 * hard cap is the spend limit on the OpenAI project.
 */
const store = budgetStore(process.env);
export const ASK_BUDGET = {
  requestsPerDay: 1_500,
  tokensPerDay: 5_000_000,
  ...(store ? { store } : {}),
  message: `The live demo has answered all the questions it can today. The docs are at ${SITE_URL}/docs. To try it on your own docs with no key: npx ondocs index ./docs -e mock, then npx ondocs dev.`,
} satisfies BudgetOptions;

const challenge = askChallenge(process.env);

// `ask-index.json` is generated by `pnpm index`, which runs before `dev` and `build`.
export const askHandler = createAskHandler({
  index,
  model: chatModel,
  embeddingModel,
  ...(embeddingProviderOptions ? { embeddingProviderOptions } : {}),
  siteName: 'the ondocs documentation',
  ...(minSimilarity ? { retrieval: { minSimilarity } } : {}),
  // The live demos (examples/docusaurus, starlight and vitepress, each on Vercel) show these docs
  // on another origin and send their questions here, with no model key of their own. Their
  // origins, and only theirs, get CORS headers; any other origin gets none, so a browser on it
  // cannot get past the preflight a JSON post needs. The rate limit and the daily budget below
  // are the same for them as for the site's own dialog.
  allowedOrigins: DEMO_ORIGINS,
  // Five questions a minute per visitor: in production every answer is a paid model call. A
  // token bucket, so a burst of five, then one more every 12 seconds. Keyed by the last
  // X-Forwarded-For entry, which Vercel sets, and by the /64 for IPv6. On Netlify, Cloudflare or
  // Fly, pass `trustedHeader`: see /docs/security#which-client-ip-header-to-trust.
  rateLimit: memoryRateLimit({ limit: 5, windowMs: 60_000 }),
  budget: ASK_BUDGET,
  // A Turnstile token with each question, when the widget's keys are set (`askChallenge`).
  ...(challenge ? { challenge } : {}),
  // The suggested questions are asked over and over: answer a repeat from memory, for free.
  answerCache: true,
  // A counter line for each answer, with the tokens it spent (lib/counters.ts).
  onFinish: (event) => {
    console.info(JSON.stringify(askCount(event)));
  },
});
