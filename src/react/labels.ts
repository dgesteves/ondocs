// Every string the dialog and its button show or announce, so a site can give them in its own
// language. No React here: the script embed's button reads its two from the same type.

/**
 * The dialog's words. Each has an English default; pass any of them as `labels`. A `{name}` in a
 * label is filled in: `{count}` and `{n}` with numbers, `{title}` with a page's title, `{status}`
 * with an HTTP status.
 */
export interface AskDialogLabels {
  /** The floating button. */
  launcher: string;
  /** The Ctrl key, on the button's shortcut hint outside macOS. */
  controlKey: string;
  /** The dialog's accessible name. */
  title: string;
  /** What screen readers hear about the dialog. */
  description: string;
  placeholder: string;
  /** The item that asks what was typed. */
  ask: string;
  /** The same item, once an answer is on screen. */
  followUp: string;
  /** The heading over the suggested questions. */
  suggested: string;
  /** The list under the input (the item that asks, and the suggestions), for screen readers. */
  list: string;
  /** The button that stops an answer. */
  stop: string;
  /** The Escape key, on its hints. */
  escapeKey: string;
  /** The footer's disclaimer. */
  footer: string;
  /**
   * The footer's disclaimer under an answer that shows no sources: a refusal, or an answer that
   * cites none. When `footer` is given and this is not, `footer` is shown there too.
   */
  footerNoSources: string;
  /** The footer's hint for Enter, after the ↵ key. */
  footerAsk: string;
  /** The footer's hint for Escape, after the esc key. */
  footerClose: string;
  /** While the site is searched. */
  searching: string;
  /** Announced while the answer streams. */
  writing: string;
  /** Announced when nothing on the site answers. */
  noAnswerFound: string;
  /** Announced when the answer is ready, with one source. */
  answerReadyOne: string;
  /** Announced when the answer is ready, with `{count}` sources. */
  answerReadyMany: string;
  /** Announced when the answer stopped at its length limit. */
  answerTruncated: string;
  /** Shown under an answer that stopped at its length limit. */
  truncatedNotice: string;
  retry: string;
  /** The heading over the sources, and their list's name. */
  sources: string;
  /** A citation's accessible name: `{n}` its number, `{title}` its page. */
  citation: string;
  /** The button that starts a new thread. */
  newQuestion: string;
  helpfulQuestion: string;
  helpful: string;
  notHelpful: string;
  thanks: string;
  addComment: string;
  /** The comment field's accessible name. */
  comment: string;
  commentPlaceholder: string;
  send: string;
  thanksComment: string;
  feedbackFailed: string;
  /** The endpoint could not be reached. */
  errorNetwork: string;
  /** The endpoint answered 404: there is none at the dialog's `endpoint`. */
  errorUnavailable: string;
  /** The response had no body. */
  errorNoBody: string;
  /** The answer's stream broke off. */
  errorInterrupted: string;
  /** The answer's stream ended without finishing. */
  errorCutOff: string;
  /**
   * The endpoint checks for bots, and the question went without a token: the check could not
   * run, as when the page blocks Turnstile's script.
   */
  challengeRequired: string;
  /** The endpoint's bot check failed. */
  challengeFailed: string;
  /** Any other error the dialog has no words for. */
  errorUnknown: string;
  /**
   * The endpoint's own words, shown as it sends them unless one of these is given: its "I don't
   * know" answer (`noAnswerMessage`), its rate limit and daily budget messages, its other errors
   * (with `{status}`), and the message for an answer the model failed to write.
   */
  noAnswer?: string;
  rateLimited?: string;
  budgetExceeded?: string;
  serverError?: string;
  answerFailed?: string;
}

/** The labels with a default; the endpoint's own words have none. */
type DefaultLabels = Omit<
  AskDialogLabels,
  'noAnswer' | 'rateLimited' | 'budgetExceeded' | 'serverError' | 'answerFailed'
>;

export const DEFAULT_LABELS: Readonly<DefaultLabels> = {
  launcher: 'Ask AI',
  controlKey: 'Ctrl',
  title: 'Ask this site',
  description:
    'Type a question and press Enter. Answers are generated from this site’s pages and cite them.',
  placeholder: 'Ask a question…',
  ask: 'Ask',
  followUp: 'Follow up',
  suggested: 'Suggested',
  list: 'Suggestions',
  stop: 'Stop',
  escapeKey: 'esc',
  footer: 'Answers come from this site and can be wrong. Check the sources.',
  footerNoSources: 'Answers come from this site and can be wrong.',
  footerAsk: 'ask',
  footerClose: 'close',
  searching: 'Searching the site…',
  writing: 'Writing an answer…',
  noAnswerFound: 'No answer found on this site.',
  answerReadyOne: 'Answer ready, citing 1 source.',
  answerReadyMany: 'Answer ready, citing {count} sources.',
  answerTruncated: 'Answer ready, but cut short at its length limit.',
  truncatedNotice: 'This answer reached its length limit and may be incomplete.',
  retry: 'Retry',
  sources: 'Sources',
  citation: 'Source {n}: {title}',
  newQuestion: 'New question',
  helpfulQuestion: 'Was this helpful?',
  helpful: 'Yes, it helped',
  notHelpful: 'No, it did not help',
  thanks: 'Thanks for the feedback.',
  addComment: 'Add a comment',
  comment: 'Comment',
  commentPlaceholder: 'What was missing or wrong?',
  send: 'Send',
  thanksComment: 'Thanks for the comment.',
  feedbackFailed: 'The feedback could not be sent.',
  errorNetwork: 'Could not reach the server. Check your connection.',
  errorUnavailable: 'Answers aren’t available here right now.',
  errorNoBody: 'The response had no body.',
  errorInterrupted: 'The answer was interrupted. Please try again.',
  errorCutOff: 'The answer was cut off. Please try again.',
  challengeRequired: 'The check that you’re not a bot didn’t load. Reload the page and try again.',
  challengeFailed: 'The check that you’re not a bot failed. Please try again.',
  errorUnknown: 'Something went wrong.',
};

/** The defaults with `given` over them, every value a string. */
export type ResolvedLabels = DefaultLabels & Partial<AskDialogLabels>;

export function resolveLabels(given: Partial<AskDialogLabels> | undefined): ResolvedLabels {
  const own: Partial<AskDialogLabels> = {};
  for (const [key, value] of Object.entries(given ?? {})) {
    if (typeof value === 'string') own[key as keyof AskDialogLabels] = value;
  }
  // A site's own footer, likely in its own language, beats the English one without the sources.
  if (own.footer !== undefined) own.footerNoSources ??= own.footer;
  return { ...DEFAULT_LABELS, ...own };
}

/** A label with its `{name}`s filled in. */
export function fill(label: string, values: Record<string, string | number>): string {
  return label.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** The label names, for checking a `data-labels` object. */
export const LABEL_NAMES: readonly (keyof AskDialogLabels)[] = [
  ...(Object.keys(DEFAULT_LABELS) as (keyof AskDialogLabels)[]),
  'noAnswer',
  'rateLimited',
  'budgetExceeded',
  'serverError',
  'answerFailed',
];
