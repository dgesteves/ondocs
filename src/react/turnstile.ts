// Cloudflare Turnstile in the dialog, for an endpoint that checks for bots (`challenge` on
// `createAskHandler`). Turnstile's script loads from challenges.cloudflare.com the first time the
// dialog opens with a site key, and a widget in the dialog solves a token before each question:
// invisibly, unless Turnstile wants the visitor to click. Part of the dialog's own chunk, so a
// page carries none of it until the dialog is wanted.

/** Turnstile's script, rendering only the widgets it is asked to. Not to be proxied or cached. */
export const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The part of Turnstile's API the dialog uses. */
export interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | null | undefined;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/**
 * How long a script tag for Turnstile that the page added is waited for. One that failed before
 * `loadTurnstile` listened never settles: past this, it is replaced with a new tag.
 */
export const PAGE_SCRIPT_WAIT_MS = 5_000;

/**
 * Turnstile's API: the page's own, if it has loaded Turnstile, else its script, added once. A tag
 * for the script that the page added and that is still loading is waited for, not added again, so
 * Turnstile does not run twice; without Turnstile after `PAGE_SCRIPT_WAIT_MS`, it is replaced.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    /**
     * Settles on `tag`'s load or error, calling `done` as it does. Returns a function that stops
     * listening.
     */
    const watch = (tag: HTMLScriptElement, done?: () => void): (() => void) => {
      const stop = (): void => {
        done?.();
        tag.removeEventListener('load', loaded);
        tag.removeEventListener('error', failed);
      };
      const loaded = (): void => {
        stop();
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile’s script loaded without its API.'));
      };
      const failed = (): void => {
        stop();
        // A failed tag never runs, the page's included: without it, the next widget adds a new one.
        tag.remove();
        reject(
          new Error(
            `Could not load ${TURNSTILE_SCRIPT}. A Content-Security-Policy must allow https://challenges.cloudflare.com for scripts and frames.`,
          ),
        );
      };
      tag.addEventListener('load', loaded);
      tag.addEventListener('error', failed);
      return stop;
    };
    const add = (): void => {
      const tag = document.createElement('script');
      tag.src = TURNSTILE_SCRIPT;
      tag.async = true;
      watch(tag);
      document.head.append(tag);
    };

    const found = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    if (!found) {
      add();
      return;
    }
    const timer = setTimeout(() => {
      stopWatching();
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      // Failed before this listened, or stuck: replaced, as a failed tag is.
      found.remove();
      add();
    }, PAGE_SCRIPT_WAIT_MS);
    const stopWatching = watch(found, () => {
      clearTimeout(timer);
    });
  }).finally(() => {
    // Loaded, `window.turnstile` answers from now on; failed, the next widget tries again.
    loading = null;
  });
  return loading;
}

export interface TurnstileWidget {
  /**
   * A token for one question: the one solved already, or the next one, once it is. `undefined`
   * when Turnstile fails, or none comes in time: the question is then sent without one, and the
   * endpoint says so.
   */
  token: () => Promise<string | undefined>;
  /** Removes the widget, as the dialog closes. */
  remove: () => void;
}

/**
 * A Turnstile widget in `container`, solving a token as soon as it renders and the next one each
 * time one is taken, so a question rarely waits for one. A token is used once, and expires after
 * five minutes, when Turnstile solves a new one by itself.
 */
export function turnstileWidget(
  container: HTMLElement,
  siteKey: string,
  { theme = 'auto', wait = 30_000 }: { theme?: 'auto' | 'light' | 'dark'; wait?: number } = {},
): TurnstileWidget {
  let api: TurnstileApi | null = null;
  let id: string | null = null;
  let ready: string | null = null;
  let broken = false;
  let removed = false;
  const waiting: ((token: string | undefined) => void)[] = [];
  const solveNext = (): void => {
    if (api && id !== null) api.reset(id);
  };
  const giveUp = (): void => {
    for (const settle of waiting.splice(0)) settle(undefined);
  };

  loadTurnstile().then(
    (turnstile) => {
      if (removed) return;
      api = turnstile;
      id =
        turnstile.render(container, {
          sitekey: siteKey,
          // Invisible unless Turnstile asks the visitor to click, in the dialog, where they can.
          appearance: 'interaction-only',
          theme,
          'response-field': false,
          callback: (token: string) => {
            const settle = waiting.shift();
            if (!settle) {
              ready = token;
              return;
            }
            settle(token);
            solveNext();
          },
          'expired-callback': () => {
            ready = null;
          },
          'error-callback': () => {
            // Turnstile tries again by itself; the question waiting now goes without a token.
            ready = null;
            giveUp();
            return true;
          },
        }) ?? null;
    },
    (error: unknown) => {
      broken = true;
      giveUp();
      console.error('[ondocs]', error);
    },
  );

  return {
    token: () => {
      if (ready !== null) {
        const token = ready;
        ready = null;
        solveNext();
        return Promise.resolve(token);
      }
      if (broken || removed) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        const settle = (token: string | undefined): void => {
          clearTimeout(timer);
          resolve(token);
        };
        const timer = setTimeout(() => {
          const at = waiting.indexOf(settle);
          if (at !== -1) waiting.splice(at, 1);
          resolve(undefined);
        }, wait);
        waiting.push(settle);
      });
    },
    remove: () => {
      removed = true;
      ready = null;
      giveUp();
      if (api && id !== null) api.remove(id);
      id = null;
    },
  };
}
