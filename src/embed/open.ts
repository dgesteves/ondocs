// Opening the dialog from outside it: `openAskDialog(question?)`, and any element on the page with
// a `data-ondocs-open` attribute. Both reach whichever dialog the page has (the Docusaurus,
// Starlight or VitePress plugin's, the script tag's, or one from `mountAskDialog`), through an
// event on `window`, so they work from any framework and any copy of the package.

/** The event `openAskDialog` sends; its `detail` may carry a `question`. */
export const OPEN_EVENT = 'ondocs:open';

/**
 * Opens the ask dialog the page has, and asks `question` in it when one is given, in a new thread.
 * Does nothing on a page without a dialog. In the browser only.
 *
 * ```ts
 * import { openAskDialog } from 'ondocs/embed';
 *
 * openAskDialog('How do I deploy it?');
 * ```
 */
export function openAskDialog(question?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { question } }));
}

/** A question given from outside the dialog: its text, trimmed, or `undefined` for none. */
export const asked = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim()) || undefined;

/** The element with `data-ondocs-open` that an event happened in, if any. */
const trigger = (event: Event): Element | null =>
  event.target instanceof Element ? event.target.closest('[data-ondocs-open]') : null;

/**
 * Calls `open` for each request to open the dialog: `openAskDialog()`, a click on an element with
 * `data-ondocs-open` (its value, when it has one, is the question), and the submit of a form with
 * `data-ondocs-open` (the question is its `question` field, else its first input). A pointer
 * over or focus on one calls `prefetch`, to load the dialog's code. Returns a function that stops.
 */
export function listenForOpen(open: (question?: string) => void, prefetch: () => void): () => void {
  const onOpen = (event: Event): void => {
    open(asked((event as CustomEvent<{ question?: unknown } | null>).detail?.question));
  };
  const onClick = (event: MouseEvent): void => {
    const element = trigger(event);
    // A form opens on submit, and a link opened in a new tab or window stays a link.
    if (!element || element instanceof HTMLFormElement || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    // Focus goes back to it when the dialog closes (Safari does not focus a button on a click).
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    open(asked(element.getAttribute('data-ondocs-open')));
  };
  const onSubmit = (event: SubmitEvent): void => {
    const form = trigger(event);
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
    event.preventDefault();
    open(asked(new FormData(form).get('question') ?? form.querySelector('input')?.value));
  };
  const onIntent = (event: Event): void => {
    if (trigger(event)) prefetch();
  };
  const stop = new AbortController();
  const options = { signal: stop.signal };
  window.addEventListener(OPEN_EVENT, onOpen, options);
  document.addEventListener('click', onClick, options);
  document.addEventListener('submit', onSubmit, options);
  document.addEventListener('pointerover', onIntent, options);
  document.addEventListener('focusin', onIntent, options);
  return () => {
    stop.abort();
  };
}
