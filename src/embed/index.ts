/**
 * ondocs/embed: the ask dialog on any page, without writing React. `mountAskDialog` adds a
 * floating "Ask AI" button and the shortcut to the page, and loads the dialog (React, Radix and
 * cmdk, in a chunk of their own) the first time it is wanted: a pointer over or focus on the
 * button, the shortcut, or `open()`. The prebuilt `dist/embed.global.js` does the same from a
 * `<script>` tag. `openAskDialog(question?)`, and any element with `data-ondocs-open`, open
 * whichever dialog the page has, the framework plugins' included.
 *
 * Import `ondocs/react/styles.css` and `ondocs/embed/launcher.css` for the default look.
 */

import { mountWithLoader, type MountAskDialogOptions, type MountedAskDialog } from './mount';
import type { OndocsDialogOptions, OndocsTheme } from './options';

export { openAskDialog } from './open';
export type { OndocsDialogOptions, OndocsTheme } from './options';
export type { AskDialogLabels } from '../react/labels';
export type { SourceUrls } from '../react/answer';
export type { MountAskDialogOptions, MountedAskDialog } from './mount';

/** @deprecated Use `OndocsDialogOptions`. Its name from before ask-my-site became ondocs. */
export type AskMySiteDialogOptions = OndocsDialogOptions;
/** @deprecated Use `OndocsTheme`. Its name from before ask-my-site became ondocs. */
export type AskMySiteTheme = OndocsTheme;

/**
 * Renders the ask dialog's launcher into the page (a container of its own at the end of
 * `<body>`, unless you pass one) and returns controls for it. The dialog's code loads on first
 * use. In the browser only.
 *
 * ```ts
 * import { mountAskDialog } from 'ondocs/embed';
 * import 'ondocs/react/styles.css';
 * import 'ondocs/embed/launcher.css';
 *
 * const ask = mountAskDialog({ endpoint: '/api/ask', suggestions: ['How do I install it?'] });
 * ```
 */
export function mountAskDialog(options: MountAskDialogOptions = {}): MountedAskDialog {
  return mountWithLoader(options, () => import('./dialog'));
}
