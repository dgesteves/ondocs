// The dialog with its floating "Ask AI" button, and the site's color scheme: what the Docusaurus
// theme and ondocs/embed render. Not part of the public `ondocs/react` API.
import { useSyncExternalStore, type ReactNode } from 'react';

import type { OndocsDialogOptions, OndocsTheme } from '../embed/options';
import { AskDialog, type AskDialogProps } from './ask-dialog';
import { pageScheme, subscribeToScheme } from './theme';

export interface AskWithLauncherProps extends OndocsDialogOptions {
  endpoint: string;
  locale?: string;
  theme: 'light' | 'dark';
  headers?: Record<string, string>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  question?: string;
  onNavigate?: AskDialogProps['onNavigate'];
}

/**
 * `AskDialog` opened by ⌘/Ctrl+I (by default) and by its floating launcher button, with the
 * `ondocs-launcher` class, which the integration's stylesheet places and colors. The plugin has
 * already moved `buttonLabel`, the launcher's name before 0.9, to `launcher`, and warned.
 */
export function AskWithLauncher({
  launcher,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- swizzled data may still have it
  buttonLabel,
  ...props
}: AskWithLauncherProps): ReactNode {
  return <AskDialog {...props} launcher={launcher ?? buttonLabel ?? true} />;
}

const noSubscription = () => () => undefined;

/** The color scheme to render in: `theme` itself, or with `auto`, the page's, kept up to date. */
export function useColorScheme(theme: OndocsTheme = 'auto'): 'light' | 'dark' {
  const auto = theme === 'auto';
  return useSyncExternalStore(
    auto ? subscribeToScheme : noSubscription,
    () => (auto ? pageScheme() : theme),
    () => (auto ? 'light' : theme),
  );
}
