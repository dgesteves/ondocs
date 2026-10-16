import type { SourceUrls } from '../react/answer';
import type { AskDialogLabels } from '../react/labels';

/** What the dialog and its floating launcher show, in the embed and the framework plugins. */
export interface OndocsDialogOptions {
  /**
   * Every string the dialog and its button show or announce, in your language, over the English
   * defaults. `title`, `placeholder` and a `launcher` label win over their labels.
   */
  labels?: Partial<AskDialogLabels>;
  /** The dialog's accessible name. */
  title?: string;
  placeholder?: string;
  /** Questions offered before the visitor types. */
  suggestions?: string[];
  /** Opens the dialog with ⌘ or Ctrl. Default `"i"`, so ⌘K stays with the site's search. `false` disables it. */
  shortcut?: string | false;
  /**
   * The floating "Ask AI" button, with the shortcut on it: `true` (the default), or the button's
   * label, or `false` to hide it (open the dialog with the shortcut). Its label is otherwise
   * `labels.launcher`, "Ask AI".
   */
  launcher?: boolean | string;
  /**
   * @deprecated Use `launcher`, which takes the same values. `buttonLabel` still works, with a
   * warning, until 1.0.
   */
  buttonLabel?: string | false;
  /**
   * Which links in an answer stay links: `"all"` (the default), or `"sources"` for only links to
   * the pages the answer's sources are on, so injected text cannot show visitors another site's
   * link. Citations link to their sources either way.
   */
  links?: 'all' | 'sources';
  /**
   * For an endpoint that answers from another site's index, such as a copy of its docs: where the
   * citations, the sources and the answer's links point. `pages` maps a page's URL in that index
   * (`/docs/setup`) to the same page here (`/setup`), keeping the anchor; `base` is that site's
   * address (`https://docs.acme.dev`), which any other relative URL resolves against.
   */
  sourceUrls?: SourceUrls;
  /**
   * A bot check before each question, for an endpoint with `challenge` set:
   * `{ turnstile: '<site key>' }`, a Cloudflare Turnstile widget's site key. The dialog loads
   * Turnstile's script from challenges.cloudflare.com when it opens, and sends a fresh token with
   * each question. Off by default.
   */
  challenge?: { turnstile: string };
}

/**
 * `auto` follows a `data-theme="light"` or `"dark"` on `<html>`, as Starlight and Docusaurus set
 * it, and `prefers-color-scheme` on a page without one, live in both cases.
 */
export type OndocsTheme = 'auto' | 'light' | 'dark';
