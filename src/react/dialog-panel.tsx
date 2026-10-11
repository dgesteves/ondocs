// The dialog itself: Radix Dialog, cmdk and the answer. `AskDialog` loads this module when the
// dialog is first wanted (a hover or focus on its button, its shortcut, or opening it), so a
// page carries none of it until then.
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { AskAnswer, citedSourceIds, safeHref, type AnswerLinks } from './answer';
import type { AskDialogProps, AskDialogSlot } from './ask-dialog';
import { fill, resolveLabels, type ResolvedLabels } from './labels';
import { turnstileWidget, type TurnstileWidget } from './turnstile';
import { useAsk, type AskError, type AskState } from './use-ask';

/** What `AskDialog` hands the dialog: its props, with the open state it keeps. */
export type DialogPanelProps = Omit<
  AskDialogProps,
  'open' | 'defaultOpen' | 'onOpenChange' | 'shortcut' | 'trigger' | 'launcher'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const cx = (...names: (string | undefined | false)[]): string => names.filter(Boolean).join(' ');

function SearchIcon(): ReactNode {
  return (
    <svg className="ask-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Thumb({ down = false }: { down?: boolean }): ReactNode {
  return (
    <svg
      className="ask-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      style={down ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path
        d="M7 10v11H3V10h4Zm2 11V10l4.6-7.4A1.6 1.6 0 0 1 16.5 3.6L15.6 8H20a2 2 0 0 1 2 2.3l-1.3 8.6A2.5 2.5 0 0 1 18.2 21H9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Thumbs up and down on the answer, then an optional comment, sent to the endpoint's
 * `onFeedback`. Shown only when the endpoint says it takes feedback.
 */
function Feedback({
  state,
  labels,
}: {
  state: ReturnType<typeof useAsk>;
  labels: ResolvedLabels;
}): ReactNode {
  const labelId = useId();
  const [comment, setComment] = useState<'closed' | 'open' | 'sent'>('closed');
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const send = async (rating: 'up' | 'down', withComment?: string): Promise<void> => {
    const ok = await state.rate(rating, withComment);
    setFailed(!ok);
    if (ok && withComment !== undefined) setComment('sent');
  };
  // Enter sends the comment, rather than reaching the command palette around it; Escape still
  // closes the dialog.
  const keepKeys = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') event.stopPropagation();
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (state.rating && text.trim()) void send(state.rating, text);
  };
  return (
    <div className="ask-feedback">
      {state.rating === null ? (
        <>
          <span id={labelId} className="ask-feedback-label">
            {labels.helpfulQuestion}
          </span>
          <span role="group" aria-labelledby={labelId} className="ask-feedback-buttons">
            <button
              type="button"
              className="ask-feedback-button"
              aria-label={labels.helpful}
              onClick={() => void send('up')}
            >
              <Thumb />
            </button>
            <button
              type="button"
              className="ask-feedback-button"
              aria-label={labels.notHelpful}
              onClick={() => void send('down')}
            >
              <Thumb down />
            </button>
          </span>
        </>
      ) : comment === 'sent' ? (
        <span className="ask-feedback-label" role="status">
          {labels.thanksComment}
        </span>
      ) : (
        <>
          <span className="ask-feedback-label" role="status">
            {labels.thanks}
          </span>
          {comment === 'closed' ? (
            <button
              type="button"
              className="ask-feedback-more"
              onClick={() => {
                setComment('open');
              }}
            >
              {labels.addComment}
            </button>
          ) : (
            <form className="ask-feedback-form" onSubmit={submit} onKeyDown={keepKeys}>
              <input
                className="ask-feedback-input"
                aria-label={labels.comment}
                placeholder={labels.commentPlaceholder}
                maxLength={1000}
                value={text}
                autoFocus
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
              <button type="submit" className="ask-feedback-more">
                {labels.send}
              </button>
            </form>
          )}
        </>
      )}
      {failed ? (
        <span className="ask-feedback-error" role="alert">
          {labels.feedbackFailed}
        </span>
      ) : null}
    </div>
  );
}

/**
 * An error in the labels' words. The endpoint's own messages (rate limits, the daily budget, a
 * failed answer) show as it sends them, unless a label for them was given.
 */
export function errorText(error: AskError | null, labels: ResolvedLabels): string {
  if (!error) return labels.errorUnknown;
  if (error.kind === 'network') return labels.errorNetwork;
  if (error.kind === 'rate-limited') {
    return (
      (error.code === 'budget_exceeded' ? labels.budgetExceeded : labels.rateLimited) ??
      error.message
    );
  }
  if (error.code === 'challenge_required') return labels.challengeRequired;
  if (error.code === 'challenge_failed') return labels.challengeFailed;
  switch (error.reason) {
    case 'unavailable':
      return labels.errorUnavailable;
    case 'no-body':
      return labels.errorNoBody;
    case 'interrupted':
      return labels.errorInterrupted;
    case 'cut-off':
      return labels.errorCutOff;
    case 'server':
      return labels.answerFailed ?? error.message;
    case undefined:
      break;
  }
  if (error.kind === 'http' && labels.serverError !== undefined) {
    return fill(labels.serverError, { status: error.status ?? '' });
  }
  return error.message || labels.errorUnknown;
}

function statusMessage(state: AskState, labels: ResolvedLabels): string {
  switch (state.status) {
    case 'loading':
      return labels.searching;
    case 'streaming':
      return labels.writing;
    case 'done':
      if (state.refused) return labels.noAnswerFound;
      if (state.truncated) return labels.answerTruncated;
      return state.sources.length === 1
        ? labels.answerReadyOne
        : fill(labels.answerReadyMany, { count: state.sources.length });
    case 'error':
      return errorText(state.error, labels);
    case 'idle':
      return '';
  }
}

/** The dialog, open or closed as `open` says. Stays mounted, so its answer survives closing. */
export function DialogPanel({
  open,
  onOpenChange: setOpen,
  labels: given,
  title: titleProp,
  placeholder: placeholderProp,
  suggestions = [],
  onNavigate,
  theme = 'system',
  classNames = {},
  footer,
  links = 'all',
  challenge,
  ...askOptions
}: DialogPanelProps): ReactNode {
  const labels = resolveLabels(given);
  const title = titleProp ?? labels.title;
  const placeholder = placeholderProp ?? labels.placeholder;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');

  // The bot check: a Turnstile widget in the dialog while it is open, rendered as it opens so a
  // token is solved before the first question, and the next one after each question takes one.
  const siteKey = challenge?.turnstile;
  const [challengeElement, setChallengeElement] = useState<HTMLDivElement | null>(null);
  const widgetRef = useRef<TurnstileWidget | null>(null);
  useEffect(() => {
    if (!siteKey || !challengeElement) return;
    const widget = turnstileWidget(challengeElement, siteKey, {
      theme: theme === 'system' ? 'auto' : theme,
    });
    widgetRef.current = widget;
    return () => {
      widget.remove();
      if (widgetRef.current === widget) widgetRef.current = null;
    };
  }, [siteKey, challengeElement, theme]);
  const state = useAsk(
    siteKey ? { ...askOptions, challengeToken: () => widgetRef.current?.token() } : askOptions,
  );
  const descriptionId = useId();

  // Closing the dialog, however it happens, cancels the answer in flight: nobody is reading it,
  // and the model would otherwise keep generating (and billing) to the end.
  const { stop } = state;
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const submit = (question: string): void => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    void state.ask(trimmed);
  };

  const navigate = (url: string, event: MouseEvent<HTMLAnchorElement>): void => {
    onNavigate?.(url, event);
    setOpen(false);
  };

  /** Starts a new thread: the next question is asked on its own. */
  const newQuestion = (): void => {
    state.reset();
    setQuery('');
    inputRef.current?.focus();
  };

  const busy = state.status === 'loading' || state.status === 'streaming';
  const trimmedQuery = query.trim();
  const answering = state.status !== 'idle';
  const showList = !answering || trimmedQuery !== (state.question ?? '');
  // With an answer on screen, a new question follows up on it, and the suggestions are done with.
  const followingUp = answering && askOptions.followUps !== false;
  const normalized = trimmedQuery.toLowerCase();
  const matchingSuggestions = answering
    ? []
    : normalized
      ? suggestions.filter((s) => s.toLowerCase().includes(normalized) && s.trim() !== trimmedQuery)
      : suggestions;
  const themeAttribute = theme === 'system' ? undefined : theme;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cx('ask-overlay', classNames.overlay)}
          data-ask-theme={themeAttribute}
        />
        <Dialog.Content
          className={cx('ask-dialog', classNames.content)}
          data-ask-theme={themeAttribute}
          aria-describedby={descriptionId}
          onOpenAutoFocus={() => {
            // Runs before focus moves in, however the dialog was opened (shortcut, trigger,
            // controlled prop), so this is still the element to give focus back to.
            const active = document.activeElement;
            returnFocusRef.current =
              active instanceof HTMLElement && active !== document.body ? active : null;
          }}
          onCloseAutoFocus={(event) => {
            // Opened by the shortcut there is no trigger to return to, so Radix would drop focus
            // on <body>. Return it to whatever had it, without scrolling away from a citation
            // target the visitor just jumped to.
            const target = returnFocusRef.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
        >
          <Dialog.Title className="ask-sr-only">{title}</Dialog.Title>
          <Dialog.Description id={descriptionId} className="ask-sr-only">
            {labels.description}
          </Dialog.Description>

          <Command label={title} shouldFilter={false} loop className="ask-command">
            <div className="ask-input-row">
              <SearchIcon />
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                maxLength={500}
                className={cx('ask-input', classNames.input)}
              />
              {busy ? (
                <button type="button" className="ask-stop" onClick={state.stop}>
                  {labels.stop}
                </button>
              ) : (
                <kbd className="ask-kbd">{labels.escapeKey}</kbd>
              )}
            </div>

            {/* Always mounted, as the input's aria-controls points at it. While the answer shows,
                it is hidden and empty, so Enter selects nothing. */}
            <Command.List
              label={labels.list}
              className={cx('ask-list', classNames.list)}
              hidden={!showList}
            >
              {showList ? (
                <>
                  {trimmedQuery ? (
                    <Command.Item
                      value={`ask:${trimmedQuery}`}
                      onSelect={() => {
                        submit(trimmedQuery);
                      }}
                      className={cx('ask-item', 'ask-item-primary', classNames.item)}
                    >
                      <span className="ask-item-label">
                        {followingUp ? labels.followUp : labels.ask}
                      </span>
                      <span className="ask-item-text">{trimmedQuery}</span>
                      <kbd className="ask-kbd">↵</kbd>
                    </Command.Item>
                  ) : null}
                  {matchingSuggestions.length > 0 ? (
                    <Command.Group heading={labels.suggested} className="ask-group">
                      {matchingSuggestions.map((suggestion) => (
                        <Command.Item
                          key={suggestion}
                          value={suggestion}
                          onSelect={() => {
                            submit(suggestion);
                          }}
                          className={cx('ask-item', classNames.item)}
                        >
                          <span className="ask-item-text">{suggestion}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                </>
              ) : null}
            </Command.List>
            {answering ? (
              <AnswerPanel
                state={state}
                labels={labels}
                onNavigate={navigate}
                onNewQuestion={newQuestion}
                classNames={classNames}
                links={links}
              />
            ) : null}
          </Command>

          {/* Turnstile's widget, shown only when it asks the visitor to click. */}
          {siteKey ? <div ref={setChallengeElement} className="ask-challenge" /> : null}

          <p role="status" className="ask-sr-only">
            {statusMessage(state, labels)}
          </p>
          {footer ?? (
            <div className={cx('ask-footer', classNames.footer)}>
              <span>{labels.footer}</span>
              <span className="ask-footer-keys" aria-hidden="true">
                <kbd className="ask-kbd">↵</kbd> {labels.footerAsk}{' '}
                <kbd className="ask-kbd">{labels.escapeKey}</kbd> {labels.footerClose}
              </span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AnswerPanel({
  state,
  labels,
  onNavigate,
  onNewQuestion,
  classNames,
  links,
}: {
  state: ReturnType<typeof useAsk>;
  labels: ResolvedLabels;
  onNavigate: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  onNewQuestion: () => void;
  classNames: Partial<Record<AskDialogSlot, string>>;
  links: AnswerLinks;
}): ReactNode {
  const streaming = state.status === 'streaming';
  const settled = state.status === 'done' || state.status === 'error';
  // Once the answer is complete, sources it never cites are de-emphasized.
  const cited = state.status === 'done' ? citedSourceIds(state.answer) : null;
  const thread = state.turns.length > 0;
  return (
    <div className="ask-panel">
      {/* The thread so far: each answer with its own citations, which link to its own sources. */}
      {state.turns.map((turn, i) => (
        <div key={i} className="ask-turn">
          <p className="ask-turn-question">{turn.question}</p>
          <div className="ask-answer" data-refused={turn.refused || undefined}>
            <AskAnswer
              text={turn.refused && labels.noAnswer !== undefined ? labels.noAnswer : turn.answer}
              sources={turn.sources}
              onNavigate={onNavigate}
              links={links}
              citationLabel={labels.citation}
            />
          </div>
        </div>
      ))}
      {thread && state.question ? <p className="ask-turn-question">{state.question}</p> : null}
      <div
        className={cx('ask-answer', classNames.answer)}
        aria-live="polite"
        aria-busy={state.status === 'loading' || streaming}
        data-status={state.status}
        data-refused={state.refused || undefined}
      >
        {state.status === 'loading' ? (
          <p className="ask-thinking">
            <span className="ask-spinner" aria-hidden="true" />
            {labels.searching}
          </p>
        ) : (
          <AskAnswer
            text={state.refused && labels.noAnswer !== undefined ? labels.noAnswer : state.answer}
            sources={state.sources}
            onNavigate={onNavigate}
            links={links}
            citationLabel={labels.citation}
          />
        )}
        {streaming ? <span className="ask-caret" aria-hidden="true" /> : null}
      </div>

      {state.status === 'done' && state.truncated ? (
        <p className="ask-truncated">{labels.truncatedNotice}</p>
      ) : null}

      {state.error ? (
        <div className="ask-error" role="alert">
          <span>{errorText(state.error, labels)}</span>
          {state.question && state.error.kind !== 'rate-limited' ? (
            <button
              type="button"
              className="ask-retry"
              onClick={() => void state.ask(state.question ?? '')}
            >
              {labels.retry}
            </button>
          ) : null}
        </div>
      ) : null}

      {state.sources.length > 0 && !state.refused ? (
        <nav aria-label={labels.sources} className={cx('ask-sources', classNames.sources)}>
          <h2 className="ask-sources-heading">{labels.sources}</h2>
          <ol>
            {state.sources.map((source) => {
              const href = safeHref(source.url);
              return (
                <li key={source.id}>
                  <a
                    {...(href ? { href } : {})}
                    className="ask-source"
                    data-cited={cited ? cited.has(source.id) : undefined}
                    onClick={(event) => {
                      if (href) onNavigate(href, event);
                    }}
                  >
                    <span className="ask-source-id" aria-hidden="true">
                      {source.id}
                    </span>
                    <span className="ask-source-text">
                      <span className="ask-source-title">{source.title}</span>
                      {source.heading ? (
                        <span className="ask-source-heading">{source.heading}</span>
                      ) : null}
                    </span>
                    <span className="ask-source-url">{source.url}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      {settled ? (
        <div className="ask-actions">
          {state.status === 'done' && state.feedbackEnabled ? (
            <Feedback key={state.id ?? state.question ?? ''} state={state} labels={labels} />
          ) : null}
          <button type="button" className="ask-new" onClick={onNewQuestion}>
            {labels.newQuestion}
          </button>
        </div>
      ) : null}
    </div>
  );
}
