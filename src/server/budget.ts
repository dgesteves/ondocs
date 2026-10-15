/**
 * A daily spend cap: questions per day and model tokens per day, counted in a pluggable store.
 * The memory store counts per process or isolate; a shared store (Upstash, or anything with an
 * atomic increment) gives one budget across every instance.
 */

export interface BudgetStore {
  /**
   * Adds `amount` (negative to give some back) to the counter at `key` and returns the new
   * total. A counter that does not exist starts at 0 and expires `ttlSeconds` after it is created.
   * The increment must be atomic, as Redis `INCRBY` is.
   */
  increment(key: string, amount: number, ttlSeconds: number): number | Promise<number>;
}

export interface BudgetOptions {
  /**
   * Questions a day that go on to retrieval and the model. A question answered from the answer
   * cache, or turned away by the rate limit or by validation, does not count.
   */
  requestsPerDay?: number;
  /**
   * Model tokens a day, input plus output, from each answer's `usage`. Before the model is
   * called, the answer's worst case (its prompt plus `maxOutputTokens`) is reserved, and the
   * answer goes ahead only if that fits in what is left; the reservation is corrected to the real
   * usage once the answer ends. So concurrent answers cannot overshoot the cap, and an answer the
   * visitor abandons keeps its reservation. An answer the model fails before writing a word (a bad
   * key, a quota, an outage, a timeout) gives its reservation back.
   */
  tokensPerDay?: number;
  /**
   * Where the counts live. Default {@link memoryBudgetStore}: per instance, so on a serverless
   * platform each instance has its own budget. Use {@link upstashBudgetStore} for one budget
   * shared by every instance.
   */
  store?: BudgetStore;
  /**
   * Prepended to the store's keys. Default `"ask-my-site:budget:"`, the name from before ondocs,
   * so a shared store keeps the day's counts across the upgrade.
   */
  prefix?: string;
  /** What visitors read once the day's budget is spent. */
  message?: string;
  /** Clock, for tests. */
  now?: () => number;
}

/** Whether a request fits in the budget, and if not, when the budget resets. */
export type BudgetDecision = { allowed: true } | { allowed: false; resetAt: number };

/**
 * A token reservation, corrected to the real usage with `settle` once the answer ends: to
 * `actual`, or back to the worst case when it is `undefined`. A later call corrects an earlier one.
 */
export type TokenReservation =
  | { allowed: true; settle: (actual: number | undefined) => Promise<void> }
  | { allowed: false; resetAt: number };

export interface Budget {
  /** Counts one question against `requestsPerDay`. */
  admit(): Promise<BudgetDecision>;
  /** Reserves `estimate` tokens against `tokensPerDay`. */
  reserve(estimate: number): Promise<TokenReservation>;
  readonly message: string;
}

const DAY_MS = 86_400_000;
/** Counters are per UTC day; they outlive it by a day so a clock that runs late finds its own. */
const COUNTER_TTL_SECONDS = 2 * 86_400;

export const BUDGET_EXCEEDED_MESSAGE =
  'The assistant has reached its daily limit. Please try again later.';

const nothingToSettle = (): Promise<void> => Promise.resolve();

/** The counters behind `budget`, built once per handler. Throws on an invalid limit. */
export function createBudget(options: BudgetOptions): Budget {
  const { requestsPerDay, tokensPerDay } = options;
  for (const [name, value] of [
    ['requestsPerDay', requestsPerDay],
    ['tokensPerDay', tokensPerDay],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new RangeError(`budget.${name} must be a positive integer (got ${String(value)}).`);
    }
  }
  const now = options.now ?? Date.now;
  const store = options.store ?? memoryBudgetStore({ now });
  const prefix = options.prefix ?? 'ask-my-site:budget:';

  const today = (): { day: string; resetAt: number } => {
    const day = Math.floor(now() / DAY_MS);
    return { day: new Date(day * DAY_MS).toISOString().slice(0, 10), resetAt: (day + 1) * DAY_MS };
  };

  return {
    message: options.message ?? BUDGET_EXCEEDED_MESSAGE,
    async admit() {
      if (requestsPerDay === undefined) return { allowed: true };
      const { day, resetAt } = today();
      const used = await store.increment(`${prefix}requests:${day}`, 1, COUNTER_TTL_SECONDS);
      return used <= requestsPerDay ? { allowed: true } : { allowed: false, resetAt };
    },
    async reserve(estimate) {
      if (tokensPerDay === undefined) return { allowed: true, settle: nothingToSettle };
      const { day, resetAt } = today();
      const key = `${prefix}tokens:${day}`;
      const used = await store.increment(key, estimate, COUNTER_TTL_SECONDS);
      if (used > tokensPerDay) {
        // Turned away, so this answer spends nothing: give the reservation back.
        await store.increment(key, -estimate, COUNTER_TTL_SECONDS);
        return { allowed: false, resetAt };
      }
      let counted = estimate;
      return {
        allowed: true,
        settle: async (actual) => {
          const change = (actual ?? estimate) - counted;
          if (change === 0) return;
          counted += change;
          await store.increment(key, change, COUNTER_TTL_SECONDS);
        },
      };
    },
  };
}

export interface MemoryBudgetStoreOptions {
  /** Clock, for tests. */
  now?: () => number;
}

/**
 * Counters in the memory of one process or isolate. On a serverless platform each instance
 * counts on its own, so the budget is per instance: N instances can spend N times it. Your model
 * provider's spend limit is the hard cap; use {@link upstashBudgetStore} for a shared count.
 */
export function memoryBudgetStore(options: MemoryBudgetStoreOptions = {}): BudgetStore {
  const now = options.now ?? Date.now;
  const counters = new Map<string, { value: number; expiresAt: number }>();
  return {
    increment(key, amount, ttlSeconds) {
      const time = now();
      let counter = counters.get(key);
      if (!counter || counter.expiresAt <= time) {
        for (const [name, entry] of counters) if (entry.expiresAt <= time) counters.delete(name);
        counter = { value: 0, expiresAt: time + ttlSeconds * 1000 };
        counters.set(key, counter);
      }
      counter.value += amount;
      return counter.value;
    },
  };
}

/** The part of `@upstash/redis`'s `Redis` that {@link upstashBudgetStore} uses. */
export interface UpstashRedisCounterLike {
  incrby(key: string, increment: number): Promise<number | string>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * A budget store in Redis through `@upstash/redis` (or any client with `incrby` and `expire`), so
 * every instance of your app shares one daily budget. ondocs does not depend on Upstash; you
 * pass in the client you configured.
 *
 * ```ts
 * budget: { tokensPerDay: 2_000_000, store: upstashBudgetStore(Redis.fromEnv()) }
 * ```
 */
export function upstashBudgetStore(redis: UpstashRedisCounterLike): BudgetStore {
  return {
    async increment(key, amount, ttlSeconds) {
      const total = Number(await redis.incrby(key, amount));
      // The increment that creates a counter gives it its lifetime.
      if (total === amount) await redis.expire(key, ttlSeconds);
      return total;
    },
  };
}
