'use client';

import { AskAnswer, citedSourceIds, useAsk, type AskSource } from 'ondocs/react';
import { useRouter } from 'next/navigation';
import { useId, useState, type MouseEvent } from 'react';

import type { SampleAnswer } from '../../lib/sample-answer';
import { Spark } from '../icons';
import { DemoSources } from './demo-sources';

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
  const ask = useAsk({ endpoint: '/api/ask' });
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
