/**
 * ondocs/react: the ⌘I ask palette and the hook behind it.
 *
 * Import `ondocs/react/styles.css` once for the default theme, or style the `ask-*`
 * classes yourself.
 */

export { AskDialog, loadAskDialog } from './ask-dialog';
export type { AskDialogProps, AskDialogSlot } from './ask-dialog';
export { AskAnswer, citedSourceIds, safeHref } from './answer';
export type { AnswerLinks, AskAnswerProps, SourceUrls } from './answer';
export { McpInstall } from './mcp-install';
export type { McpInstallProps } from './mcp-install';
export { DEFAULT_LABELS } from './labels';
export type { AskDialogLabels } from './labels';
export { useAsk } from './use-ask';
export type { AskError, AskState, AskStatus, AskTurn, UseAsk, UseAskOptions } from './use-ask';
export { readAskStream } from './stream';
export type { AskStreamHandlers } from './stream';
export type { AskMetadata, AskSource } from '../protocol';
