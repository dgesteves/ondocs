// An index fetched over HTTP, such as the live site's /ask-index.json, and fetched again when the
// site is redeployed. Web APIs only, so it runs in a Worker beside a static site.
import { loadIndex, type LoadedIndex } from '../search/retrieve';

/** Marks a source the handlers ask for the index on every request, as it can change. */
export const LIVE_INDEX = Symbol.for('ondocs.liveIndex');

export interface RemoteIndexOptions {
  /**
   * How long a fetched index is used before it is checked again, in seconds. The check runs in
   * the background: the request that finds the index due, and any during the check, are answered
   * from the index in memory. It is a conditional request (`If-None-Match`, `If-Modified-Since`):
   * a `304` keeps the index, and only a changed file is downloaded and loaded again. Default 300.
   */
  revalidateSeconds?: number;
  /**
   * How long one fetch of the index may take, response and file, in seconds, before it is given
   * up. Raise it for a very large index on a slow link. Default 10.
   */
  timeoutSeconds?: number;
  /**
   * The `fetch` to use: on Cloudflare, `env.ASSETS.fetch` reads the site's own static files
   * without leaving the Worker. Default: the global `fetch`.
   */
  fetch?: (request: Request) => Promise<Response>;
  /** Extra request headers, such as a token for a protected preview deployment. */
  headers?: Record<string, string>;
  /** Clock, for tests. */
  now?: () => number;
}

/** What {@link remoteIndex} returns: pass it as `index` to `createAskHandler` or `createMcpHandler`. */
export interface RemoteIndex {
  (): Promise<LoadedIndex>;
  readonly [LIVE_INDEX]: true;
  /** The URL it fetches. */
  readonly url: string;
}

interface Fetched {
  index: LoadedIndex;
  etag: string | null;
  lastModified: string | null;
  checkedAt: number;
}

/**
 * The index at `url`, fetched on first use and kept in memory, then checked again at most every
 * `revalidateSeconds`, so an endpoint that is deployed apart from the site, such as a Cloudflare
 * Worker answering for a GitHub Pages site, follows the site's deploys:
 *
 * ```ts
 * const index = remoteIndex('https://acme.github.io/docs/ask-index.json');
 * export default { fetch: createAskHandler({ index, model }) };
 * ```
 *
 * Only the first fetch holds up a request, and only its failure fails one; the next request tries
 * again. A check that fails (the site is down, answers with an error, sends a file that does not
 * load, or takes more than `timeoutSeconds`) keeps the index it has for another
 * `revalidateSeconds`. Both handlers given the same `remoteIndex` share one copy.
 */
export function remoteIndex(url: string | URL, options: RemoteIndexOptions = {}): RemoteIndex {
  const href = String(url);
  const revalidateMs = (options.revalidateSeconds ?? 300) * 1000;
  if (!Number.isFinite(revalidateMs) || revalidateMs < 0) {
    throw new RangeError(
      `remoteIndex: revalidateSeconds must be 0 or more (got ${String(options.revalidateSeconds)}).`,
    );
  }
  const timeoutSeconds = options.timeoutSeconds ?? 10;
  const timeoutMs = timeoutSeconds * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `remoteIndex: timeoutSeconds must be more than 0 (got ${String(options.timeoutSeconds)}).`,
    );
  }
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? ((request: Request) => fetch(request));
  let current: Fetched | null = null;
  let pending: Promise<LoadedIndex> | null = null;
  let pendingSince = 0;

  const download = async (
    signal: AbortSignal,
    inTime: <T>(step: Promise<T>) => Promise<T>,
  ): Promise<LoadedIndex> => {
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    if (current?.etag) headers.set('if-none-match', current.etag);
    else if (current?.lastModified) headers.set('if-modified-since', current.lastModified);
    let response: Response;
    try {
      response = await inTime(fetcher(new Request(href, { headers, signal })));
    } catch (error) {
      return failed(error);
    }
    if (response.status === 304 && current) {
      await response.body?.cancel();
      return keep(current);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (current) return keep(current);
      throw new Error(`Could not fetch the index at ${href}: HTTP ${String(response.status)}.`);
    }
    let text: string;
    try {
      text = await inTime(response.text());
    } catch (error) {
      // The connection dropped, or stalled, part-way through the file.
      return failed(error);
    }
    let index: LoadedIndex;
    try {
      index = loadIndex(text);
    } catch (error) {
      // A half-deployed site, say: keep answering from the index that worked.
      if (current) return keep(current);
      throw error;
    }
    current = {
      index,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      checkedAt: now(),
    };
    return index;
  };

  /**
   * {@link download}, given up after `timeoutSeconds`: a site that hangs, or stops part-way
   * through the file, also when `fetch` ignores the signal.
   */
  const downloadInTime = async (): Promise<LoadedIndex> => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException(
          `The index took more than ${String(timeoutSeconds)} s to download.`,
          'TimeoutError',
        );
        abort.abort(error);
        reject(error);
      }, timeoutMs);
    });
    try {
      return await download(abort.signal, (step) => Promise.race([step, timedOut]));
    } finally {
      clearTimeout(timer);
    }
  };

  /** Keeps the index in hand for another `revalidateSeconds`. */
  const keep = (fetched: Fetched): LoadedIndex => {
    fetched.checkedAt = now();
    return fetched.index;
  };

  /** A fetch that failed: a check keeps the index in hand, and the first fetch fails. */
  const failed = (error: unknown): LoadedIndex => {
    if (current) return keep(current);
    throw new Error(`Could not fetch the index at ${href}: ${String(error)}`, { cause: error });
  };

  /**
   * Downloads the index, or joins the download under way. One that has not settled in twice
   * `timeoutSeconds` is left behind for a new one: on a Worker, a fetch and its timer end with
   * the request that started them.
   */
  const refresh = (): Promise<LoadedIndex> => {
    if (pending && now() - pendingSince < 2 * timeoutMs) return pending;
    const started = downloadInTime().finally(() => {
      if (pending === started) pending = null;
    });
    pending = started;
    pendingSince = now();
    return started;
  };

  const get = (): Promise<LoadedIndex> => {
    if (!current) return refresh();
    // A check never holds up a question: it runs while this one is answered from the index in
    // hand, and a failed one keeps that index.
    if (now() - current.checkedAt >= revalidateMs) void refresh().catch(() => undefined);
    return Promise.resolve(current.index);
  };

  return Object.assign(get, { [LIVE_INDEX]: true as const, url: href });
}

/** Whether `source` is a {@link remoteIndex}, which the handlers call on every request. */
export function isLiveIndex(source: unknown): source is RemoteIndex {
  return typeof source === 'function' && LIVE_INDEX in source;
}
