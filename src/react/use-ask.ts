import { useCallback, useEffect, useRef, useState } from 'react';

import type { AskErrorBody, AskFeedbackBody, AskSource } from '../protocol';
import { readAskStream } from './stream';

export type AskStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export interface AskError {
  /** `rate-limited` (429), `http` (other non-2xx), `network` (no response), `stream` (failed mid-answer). */
  kind: 'rate-limited' | 'http' | 'network' | 'stream';
  message: string;
  status?: number;
  /**
   * The server's error code, when it sent one: `rate_limited` or `budget_exceeded` for a 429
   * (the second when the site's daily budget is spent), `invalid_request`, and so on.
   */
  code?: string;
  /** Seconds until a rate-limited client may retry, from `Retry-After`. */
  retryAfter?: number;
  /**
   * What happened, for words of your own: `unavailable` (no endpoint there, a 404), `no-body`,
   * `interrupted` (the stream broke off), `cut-off` (it ended without finishing), or `server`
   * (the server's own message, such as the model failing).
   */
  reason?: 'unavailable' | 'no-body' | 'interrupted' | 'cut-off' | 'server';
}

/** A question asked earlier in the thread, with its answer. */
export interface AskTurn {
  question: string;
  answer: string;
  /** The answer's own sources, which its citations number. */
  sources: AskSource[];
  refused: boolean;
  truncated: boolean;
}

export interface AskState {
  status: AskStatus;
  /** The question being (or last) answered. */
  question: string | null;
  /** The answer so far; it grows while `status` is `streaming`. */
  answer: string;
  /** Numbered sources, available before the first word of the answer. */
  sources: AskSource[];
  /** True when the server found nothing relevant and answered "I don't know". */
  refused: boolean;
  /**
   * True when the answer stopped at the model's output limit (`maxOutputTokens`), so it is
   * probably incomplete even though `status` is `done`.
   */
  truncated: boolean;
  retrieval: 'hybrid' | 'keyword' | null;
  error: AskError | null;
  /**
   * The questions asked before this one, oldest first, each with its answer and sources. `ask`
   * adds the current answer here when the next question is asked; `reset` starts a new thread.
   */
  turns: AskTurn[];
  /** The answer's id, from the server, which feedback on it carries. */
  id: string | null;
  /** Whether the endpoint takes feedback on its answers (its `onFeedback`). */
  feedbackEnabled: boolean;
  /** The rating sent for this answer, if any. */
  rating: 'up' | 'down' | null;
}

export interface UseAskOptions {
  /** The handler's URL. Default `/api/ask`. */
  endpoint?: string;
  /** Extra request headers, e.g. an auth token. */
  headers?: Record<string, string>;
  /** Custom fetch, e.g. for tests or instrumentation. */
  fetch?: typeof fetch;
  /**
   * The page's locale, sent with each question, so an endpoint with an index per locale
   * (`indexes`) answers from this one's. The plugins set it from Docusaurus and Starlight.
   */
  locale?: string;
  /** Called once an answer completes or fails. */
  onFinish?: (state: AskState) => void;
  /**
   * Send the thread with each question, as `{ messages }`, so the endpoint can answer a
   * follow-up such as "and on Netlify?" (it rewrites it to stand on its own). Default `true`;
   * `false` asks every question on its own, as `{ question }`.
   */
  followUps?: boolean;
  /**
   * For an endpoint that checks for bots (`challenge` on `createAskHandler`): returns a fresh
   * token before each question, sent as `challenge` with it. A token is used once. `AskDialog`
   * sets it from its `challenge` option; set it yourself with your own Turnstile widget.
   */
  challengeToken?: () => Promise<string | undefined> | string | undefined;
}

export interface UseAsk extends AskState {
  /** Asks a question, aborting any answer in flight. */
  ask: (question: string) => Promise<void>;
  /** Stops the current answer, keeping what has streamed so far. */
  stop: () => void;
  /** Back to idle, with a new thread. */
  reset: () => void;
  /**
   * Sends a rating of the current answer, and optionally a comment, to the endpoint's
   * `onFeedback`. Resolves to whether it was taken. Only once the answer is done, and only when
   * `feedbackEnabled`.
   */
  rate: (rating: 'up' | 'down', comment?: string) => Promise<boolean>;
}

/** Earlier questions sent with a follow-up, with their answers. */
const MAX_TURNS = 3;

const INITIAL: AskState = {
  status: 'idle',
  question: null,
  answer: '',
  sources: [],
  refused: false,
  truncated: false,
  retrieval: null,
  error: null,
  turns: [],
  id: null,
  feedbackEnabled: false,
  rating: null,
};

/**
 * The request body: the thread as `useChat` sends it, or the question alone, with the locale and
 * the bot check's token.
 */
function requestBody(
  question: string,
  turns: readonly AskTurn[],
  locale: string | undefined,
  challenge: string | undefined,
): string {
  const where = { ...(locale ? { locale } : {}), ...(challenge ? { challenge } : {}) };
  if (turns.length === 0) return JSON.stringify({ question, ...where });
  const text = (value: string) => [{ type: 'text', text: value }];
  return JSON.stringify({
    ...where,
    messages: [
      ...turns.slice(-MAX_TURNS).flatMap((turn) => [
        { role: 'user', parts: text(turn.question) },
        { role: 'assistant', parts: text(turn.answer) },
      ]),
      { role: 'user', parts: text(question) },
    ],
  });
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: unknown } | null)?.name === 'AbortError';

async function errorFrom(response: Response, endpoint: string): Promise<AskError> {
  let message =
    response.status === 404
      ? 'Answers aren’t available here right now.'
      : `Something went wrong (${String(response.status)}). Please try again.`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as Partial<AskErrorBody>;
    if (typeof body.error?.message === 'string') message = body.error.message;
    if (typeof body.error?.code === 'string') code = body.error.code;
  } catch {
    // Not JSON; keep the generic message.
  }
  if (response.status === 404 && isDevelopment()) {
    const url = typeof location === 'undefined' ? endpoint : new URL(endpoint, location.href).href;
    console.warn(
      `[ondocs] POST ${url} returned 404: no ask endpoint answers there. While you ` +
        'develop, run `npx ondocs dev` and point the dialog’s `endpoint` at ' +
        'http://localhost:8787/api/ask; to deploy one, see https://github.com/dgesteves/ondocs#readme.',
    );
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      kind: 'rate-limited',
      message,
      status: 429,
      ...(code ? { code } : {}),
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
    };
  }
  return {
    kind: 'http',
    message,
    status: response.status,
    ...(code ? { code } : {}),
    ...(response.status === 404 ? { reason: 'unavailable' as const } : {}),
  };
}

/** A development build (as the bundler defines `NODE_ENV`), or a page served from this machine. */
function isDevelopment(): boolean {
  let env: string | undefined;
  try {
    env = process.env.NODE_ENV;
  } catch {
    // No bundler defined it, and there is no `process` in a browser.
  }
  return (env !== undefined && env !== 'production') || isLocalPage();
}

const isLocalPage = (): boolean =>
  typeof location !== 'undefined' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/** Coalesces text deltas into at most one state update per animation frame. */
function frameScheduler(): { schedule: (fn: () => void) => void; flush: () => void } {
  let pending: (() => void) | null = null;
  let handle: number | ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    handle = null;
    const fn = pending;
    pending = null;
    fn?.();
  };
  return {
    schedule: (fn) => {
      pending = fn;
      if (handle !== null) return;
      handle =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(run)
          : setTimeout(run, 16);
    },
    flush: () => {
      if (handle !== null) {
        if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') {
          cancelAnimationFrame(handle);
        } else {
          clearTimeout(handle);
        }
      }
      run();
    },
  };
}

/**
 * Asks questions of an ondocs handler and exposes the streaming answer as state.
 *
 * ```tsx
 * const { ask, answer, sources, status } = useAsk();
 * ```
 *
 * Sources arrive before the answer, so citations are clickable as soon as they appear. Text
 * deltas are batched to one render per animation frame.
 */
export function useAsk(options: UseAskOptions = {}): UseAsk {
  const [state, setState] = useState<AskState>(INITIAL);
  // The state as last committed, for `ask` to read the thread from without depending on it.
  const stateRef = useRef<AskState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  // The in-flight answer, ahead of state by up to one animation frame; stop() keeps all of it.
  const liveAnswerRef = useRef('');
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => () => controllerRef.current?.abort(), []);

  const ask = useCallback(async (input: string): Promise<void> => {
    const question = input.trim();
    if (!question) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    liveAnswerRef.current = '';
    const {
      endpoint = '/api/ask',
      headers,
      fetch: fetcher = fetch,
      onFinish,
      followUps = true,
      locale,
      challengeToken,
    } = optionsRef.current;

    // The answer on screen joins the thread, if it is one: complete, or stopped with some text.
    const previous = stateRef.current;
    const turns =
      followUps && previous.question && previous.status === 'done'
        ? [
            ...previous.turns,
            {
              question: previous.question,
              answer: previous.answer,
              sources: previous.sources,
              refused: previous.refused,
              truncated: previous.truncated,
            },
          ]
        : followUps
          ? previous.turns
          : [];

    let current: AskState = { ...INITIAL, turns, status: 'loading', question };
    const commit = (next: Partial<AskState>): void => {
      current = { ...current, ...next };
      const snapshot = current;
      if (!controller.signal.aborted) {
        stateRef.current = snapshot;
        setState(snapshot);
      }
    };
    commit({});

    // The bot check's token, when the endpoint wants one. Without one, the endpoint says so.
    let challenge: string | undefined;
    if (challengeToken) {
      try {
        challenge = await challengeToken();
      } catch {
        challenge = undefined;
      }
      if (controller.signal.aborted) return;
    }

    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: requestBody(question, turns, locale, challenge),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbort(error)) return;
      commit({
        status: 'error',
        error: { kind: 'network', message: 'Could not reach the server. Check your connection.' },
      });
      onFinish?.(current);
      return;
    }

    if (!response.ok || !response.body) {
      const error = response.ok
        ? {
            kind: 'stream' as const,
            message: 'The response had no body.',
            reason: 'no-body' as const,
          }
        : await errorFrom(response, endpoint);
      // A newer question may have started while the error body was being read.
      if (controller.signal.aborted) return;
      commit({ status: 'error', error });
      onFinish?.(current);
      return;
    }

    const frames = frameScheduler();
    let answer = '';
    let streamError: string | null = null;
    let streamReason: AskError['reason'] = 'server';
    // An object, so the flags set inside the stream callback are visible to control-flow analysis.
    const progress = { finished: false, truncated: false };
    try {
      await readAskStream(response.body, {
        metadata: ({ refused, retrieval, feedback, id }) => {
          commit({ refused, retrieval, feedbackEnabled: feedback === true, id: id ?? null });
        },
        source: (source) => {
          commit({ sources: [...current.sources, source] });
        },
        delta: (text) => {
          answer += text;
          if (controllerRef.current === controller) liveAnswerRef.current = answer;
          frames.schedule(() => {
            commit({ status: 'streaming', answer });
          });
        },
        error: (message) => {
          streamError = message;
        },
        finish: (finishReason) => {
          progress.finished = true;
          progress.truncated = finishReason === 'length';
        },
      });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      streamError = 'The answer was interrupted. Please try again.';
      streamReason = 'interrupted';
    }
    frames.flush();
    if (controller.signal.aborted) return;
    // A stream that ends without `finish` was cut off by a proxy, a timeout or a crash: an
    // incomplete answer must not look complete.
    if (streamError === null && !progress.finished) {
      streamError = 'The answer was cut off. Please try again.';
      streamReason = 'cut-off';
    }
    commit(
      streamError === null
        ? { status: 'done', answer, truncated: progress.truncated }
        : {
            status: 'error',
            answer,
            error: { kind: 'stream', message: streamError, reason: streamReason },
          },
    );
    onFinish?.(current);
  }, []);

  const stop = useCallback((): void => {
    controllerRef.current?.abort();
    const answer = liveAnswerRef.current;
    setState((previous) => {
      if (previous.status !== 'loading' && previous.status !== 'streaming') return previous;
      const kept = answer.length > previous.answer.length ? answer : previous.answer;
      const next: AskState = { ...previous, answer: kept, status: kept ? 'done' : 'idle' };
      stateRef.current = next;
      return next;
    });
  }, []);

  const reset = useCallback((): void => {
    controllerRef.current?.abort();
    stateRef.current = INITIAL;
    setState(INITIAL);
  }, []);

  const rate = useCallback(async (rating: 'up' | 'down', comment?: string): Promise<boolean> => {
    const answered = stateRef.current;
    if (answered.status !== 'done' || !answered.feedbackEnabled || !answered.question) return false;
    const { endpoint = '/api/ask', headers, fetch: fetcher = fetch } = optionsRef.current;
    const body: AskFeedbackBody = {
      feedback: {
        rating,
        ...(comment?.trim() ? { comment: comment.trim().slice(0, 1000) } : {}),
        ...(answered.id ? { id: answered.id } : {}),
        question: answered.question,
        answer: answered.answer,
        sources: answered.sources.map((source) => source.url),
      },
    };
    let ok: boolean;
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      ok = response.ok;
    } catch {
      ok = false;
    }
    // A newer question may have replaced the answer meanwhile.
    if (ok && stateRef.current === answered) {
      const next = { ...answered, rating };
      stateRef.current = next;
      setState(next);
    }
    return ok;
  }, []);

  return { ...state, ask, stop, reset, rate };
}
