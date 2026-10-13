// The question box at the top of the first page. Plain markup: the form and the chips open the
// dialog through their data-ondocs-open attribute, which the ondocs plugin listens for, so the
// box adds no JavaScript of its own.
import type { ReactNode } from 'react';

import { suggestions } from '../../suggestions';

export default function AskBox(): ReactNode {
  return (
    <section className="demo-ask" aria-label="Ask these docs">
      <p className="demo-ask__title">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
            fill="currentColor"
          />
        </svg>
        Try it: ask these docs a question
      </p>
      <form className="demo-ask__form" data-ondocs-open="">
        <input
          className="demo-ask__input"
          name="question"
          type="text"
          placeholder="Ask these docs a question…"
          aria-label="Ask these docs a question"
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button className="demo-ask__submit" type="submit">
          Ask
        </button>
      </form>
      <div className="demo-ask__chips">
        <span>Or try:</span>
        {suggestions.map((question) => (
          <button
            key={question}
            type="button"
            className="demo-ask__chip"
            data-ondocs-open={question}
          >
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}
