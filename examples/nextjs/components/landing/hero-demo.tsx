'use client';

import { AskAnswer, citedSourceIds, useAsk, type AskSource } from 'ondocs/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';

import type { SampleAnswer } from '../../lib/sample-answer';
import { Spark } from '../icons';
import { DemoSources } from './demo-sources';

/**
 * The Turnstile widget's site key, which is public. With it set, and the endpoint's secret key
 * (`askChallenge` in lib/ask-handler.ts), each question the demo asks carries a bot check's token,
 * as the dialog's do (ask-dialog.tsx).
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** Turnstile's script, rendering only the widgets it is asked to, as the dialog loads it. */
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long a question waits for its token. Then it goes without one, and the endpoint says so. */
const TOKEN_WAIT_MS = 30_000;

/** The part of Turnstile's API the demo uses. */
interface Turnstile {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | null | undefined;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
}

const pageTurnstile = (): Turnstile | undefined => (window as { turnstile?: Turnstile }).turnstile;

/** Turnstile's API: the page's, if the dialog has loaded it, else its script, added once. */
function loadTurnstile(): Promise<Turnstile> {
  const loaded = pageTurnstile();
  if (loaded) return Promise.resolve(loaded);
  return new Promise((resolve, reject) => {
    // The dialog's script, still loading, or a new one.
    let tag = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    if (!tag) {
      tag = document.createElement('script');
      tag.src = TURNSTILE_SCRIPT;
      tag.async = true;
      document.head.append(tag);
    }
    const script = tag;
    script.addEventListener('load', () => {
      const api = pageTurnstile();
      if (api) resolve(api);
      else reject(new Error('Turnstile’s script loaded without its API.'));
    });
    script.addEventListener('error', () => {
      // So the next question tries again.
      script.remove();
      reject(new Error(`Could not load ${TURNSTILE_SCRIPT}.`));
    });
  });
}

interface Challenge {
  /** A token for one question: the one solved already, or the next one, once it is. */
  token: () => Promise<string | undefined>;
  remove: () => void;
}

/**
 * A Turnstile widget in `container`, as the dialog renders one (ondocs/react does not export its
 * own): invisible unless Turnstile asks the visitor to click, it solves a token as it renders and
 * the next one each time one is taken. `onFail` is called when Turnstile does not load.
 */
function turnstileWidget(
  container: HTMLElement,
  siteKey: string,
  theme: 'light' | 'dark',
  onFail: () => void,
): Challenge {
  let api: Turnstile | null = null;
  let id: string | null = null;
  let ready: string | null = null;
  let over = false;
  const waiting: ((token: string | undefined) => void)[] = [];
  const solveNext = (): void => {
    if (api && id !== null) api.reset(id);
  };
  const giveUp = (): void => {
    for (const settle of waiting.splice(0)) settle(undefined);
  };

  loadTurnstile().then(
    (turnstile) => {
      if (over) return;
      api = turnstile;
      id =
        turnstile.render(container, {
          sitekey: siteKey,
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
      over = true;
      giveUp();
      onFail();
      console.error(error);
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
      if (over) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        const settle = (token: string | undefined): void => {
          clearTimeout(timer);
          resolve(token);
        };
        const timer = setTimeout(() => {
          const at = waiting.indexOf(settle);
          if (at !== -1) waiting.splice(at, 1);
          resolve(undefined);
        }, TOKEN_WAIT_MS);
        waiting.push(settle);
      });
    },
    remove: () => {
      over = true;
      ready = null;
      giveUp();
      if (api && id !== null) api.remove(id);
      id = null;
    },
  };
}

interface HeroDemoProps {
  suggestions: readonly string[];
  /** The answer to the first suggestion, asked while the page was built. */
  initial: SampleAnswer | null;
  mode: 'openai' | 'mock';
}

/**
 * The ask endpoint, inline: `useAsk` and `AskAnswer` from ondocs/react, the same pieces the
 * dialog is made of, posting to this site's own `/api/ask`.
 */
export function HeroDemo({ suggestions, initial, mode }: HeroDemoProps) {
  const router = useRouter();

  // The bot check, with the site's key: a Turnstile widget in the demo, rendered at the first sign
  // the demo is wanted (a pointer over it, focus in it, a question), so the page loads none of it
  // before, and a token is solved by the time a question is asked.
  const challengeRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<Challenge | null>(null);
  const startChallenge = useCallback((): Challenge | null => {
    if (widgetRef.current || !TURNSTILE_SITE_KEY || !challengeRef.current) return widgetRef.current;
    // In the page's scheme, as the dialog's widget is (the site's theme is a class on <html>).
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const widget = turnstileWidget(challengeRef.current, TURNSTILE_SITE_KEY, theme, () => {
      if (widgetRef.current === widget) widgetRef.current = null;
    });
    widgetRef.current = widget;
    return widget;
  }, []);
  useEffect(
    () => () => {
      widgetRef.current?.remove();
      widgetRef.current = null;
    },
    [],
  );
  const challengeToken = useCallback(() => startChallenge()?.token(), [startChallenge]);
  const ask = useAsk({ endpoint: '/api/ask', ...(TURNSTILE_SITE_KEY ? { challengeToken } : {}) });
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const live = ask.status !== 'idle';
  const question = live ? ask.question : (initial?.question ?? null);
  const answer = live ? ask.answer : (initial?.answer ?? '');
  const sources: readonly AskSource[] = live ? ask.sources : (initial?.sources ?? []);
  const refused = live && ask.refused;
  const busy = ask.status === 'loading' || ask.status === 'streaming';
  // The sources the answer cites show, numbered as it cites them; the others fold into one line
  // (DemoSources). An answer that cites none shows none.
  const complete = !live || ask.status === 'done';
  const cited = citedSourceIds(answer);
  const showSources =
    sources.length > 0 && !refused && !(complete && !sources.some((s) => cited.has(s.id)));

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void ask.ask(trimmed);
    setDraft('');
  };
  const navigate = (url: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (url.startsWith('/')) {
      event.preventDefault();
      router.push(url);
    }
  };

  return (
    <section
      className="demo"
      aria-labelledby={`${inputId}-title`}
      // On a phone the demo is a still of the answer asked at build time (landing.css). Without
      // one, it stays a demo to type in.
      data-still={initial ? '' : undefined}
      {...(TURNSTILE_SITE_KEY ? { onPointerEnter: startChallenge, onFocus: startChallenge } : {})}
    >
      <h2 id={`${inputId}-title`} className="sr-only">
        Ask these docs
      </h2>
      <form
        className="demo-input"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <span className="demo-spark">
          <Spark size={16} />
        </span>
        <label htmlFor={inputId} className="sr-only">
          Ask the ondocs documentation a question
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder="Ask the docs a question…"
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="demo-submit" disabled={!draft.trim() || busy}>
          Ask
        </button>
      </form>

      <div className="demo-chips" role="group" aria-label="Suggested questions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="chip"
            data-active={question === suggestion ? '' : undefined}
            disabled={busy}
            onClick={() => {
              submit(suggestion);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="demo-body">
        {question ? (
          <p className="demo-question">
            <span className="sr-only">Question: </span>
            {question}
          </p>
        ) : (
          <p className="demo-empty">Pick a question above, or ask your own.</p>
        )}
        <div className="demo-answer" aria-live="polite" aria-busy={busy}>
          {ask.status === 'loading' ? (
            <p className="demo-status">Searching the index…</p>
          ) : answer ? (
            <div
              className={refused ? 'demo-text demo-refused' : 'demo-text'}
              data-streaming={ask.status === 'streaming' ? '' : undefined}
            >
              <AskAnswer
                text={answer}
                sources={sources}
                onNavigate={navigate}
                className="ask-markdown"
              />
              {ask.status === 'streaming' ? (
                <span className="ask-caret" aria-hidden="true" />
              ) : null}
            </div>
          ) : null}
          {ask.error ? (
            <p role="alert" className="demo-error">
              {ask.error.code === 'rate_limited' && ask.error.retryAfter
                ? `Too many questions. Try again in ${String(ask.error.retryAfter)} seconds.`
                : ask.error.message}
            </p>
          ) : null}
        </div>
        {/* Turnstile's widget, shown only when it asks the visitor to click. */}
        {TURNSTILE_SITE_KEY ? <div ref={challengeRef} className="demo-challenge" /> : null}
        {showSources ? (
          // Keyed by the question, so the fold is closed again for each new one.
          <DemoSources
            key={question ?? ''}
            sources={sources}
            cited={cited}
            complete={complete}
            onNavigate={navigate}
          />
        ) : null}
      </div>

      <p className="demo-footer">
        {mode === 'mock'
          ? 'Running in mock mode: offline embeddings, and answers quoted from these docs instead of written by a model. Same index, retrieval and streaming as production.'
          : 'Answers come from these docs through OpenAI, and can be wrong. Check the sources.'}
      </p>
    </section>
  );
}
