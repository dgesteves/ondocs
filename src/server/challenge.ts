// A bot check for the ask endpoint: a token the dialog gets before each question, checked with
// the provider before anything is spent on the question. Cloudflare Turnstile first.

/** What a challenge provider says about a token. */
export interface ChallengeResult {
  /** Whether the token is good: solved for this site, not used before and not expired. */
  success: boolean;
  /** The provider's reasons when it is not, such as Turnstile's `timeout-or-duplicate`. */
  errorCodes?: string[];
}

/**
 * Checks the token a question came with. Resolves `{ success: false }` for a bad token, which the
 * endpoint refuses with a 403, and rejects when it cannot tell (the provider is down, or the
 * secret is wrong), which the endpoint handles as `failureMode` says: a 503 by default.
 */
export type ChallengeVerifier = (token: string, request: Request) => Promise<ChallengeResult>;

export interface TurnstileOptions {
  /** The widget's secret key, from the Cloudflare dashboard: `TURNSTILE_SECRET_KEY` in the guides. */
  secretKey: string;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** How long to wait for Turnstile before handling it as down. */
const TIMEOUT_MS = 10_000;
/** Turnstile's errors that mean the endpoint, not the token, is at fault, or Turnstile is down. */
const NOT_THE_TOKEN = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'bad-request',
  'internal-error',
]);

/**
 * Cloudflare Turnstile, for `createAskHandler`'s `challenge`: checks each question's token with
 * Turnstile's siteverify API. The dialog gets the token with `challenge: { turnstile: '<site key>' }`.
 *
 * ```ts
 * createAskHandler({
 *   index,
 *   model,
 *   challenge: turnstile({ secretKey: process.env.TURNSTILE_SECRET_KEY! }),
 * });
 * ```
 */
export function turnstile({ secretKey }: TurnstileOptions): ChallengeVerifier {
  if (typeof secretKey !== 'string' || !secretKey.trim()) {
    throw new TypeError(
      "turnstile: secretKey is missing. Pass the widget's secret key from the Cloudflare dashboard, such as process.env.TURNSTILE_SECRET_KEY.",
    );
  }
  return async (token, request) => {
    const signals = [request.signal, AbortSignal.timeout(TIMEOUT_MS)];
    const response = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token }),
      signal: typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : request.signal,
    });
    if (!response.ok) {
      throw new Error(`Turnstile's siteverify answered HTTP ${String(response.status)}.`);
    }
    const body = (await response.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (body.success === true) return { success: true };
    const errorCodes = Array.isArray(body['error-codes'])
      ? body['error-codes'].filter((code): code is string => typeof code === 'string')
      : [];
    if (errorCodes.some((code) => NOT_THE_TOKEN.has(code))) {
      throw new Error(
        `Turnstile could not check the token (${errorCodes.join(', ')}). Check the secret key, or try again if Turnstile is down.`,
      );
    }
    return { success: false, errorCodes };
  };
}
