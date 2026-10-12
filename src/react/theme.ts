// The color scheme the dialog and its button render in, from their `theme` option. `auto` means
// the same in React, the script embed and the plugins: the `data-theme` on `<html>` when it says
// light or dark, as Docusaurus, Starlight and VitePress set it, else `prefers-color-scheme`.
import { useSyncExternalStore } from 'react';

import { warnDeprecated } from '../deprecation';
import type { OndocsTheme } from '../embed/options';

const DARK = '(prefers-color-scheme: dark)';

/** The `data-theme` on `<html>`, when it says light or dark. */
function htmlTheme(): 'light' | 'dark' | undefined {
  const theme = document.documentElement.dataset.theme;
  return theme === 'light' || theme === 'dark' ? theme : undefined;
}

/** The page's color scheme: `<html data-theme>` when it says light or dark, else the system's. */
export function pageScheme(): 'light' | 'dark' {
  return (
    htmlTheme() ?? (typeof matchMedia === 'function' && matchMedia(DARK).matches ? 'dark' : 'light')
  );
}

/** Calls `onChange` when `<html data-theme>` changes, and with `media`, the system's scheme. */
function subscribe(onChange: () => void, media: boolean): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const query = media && typeof matchMedia === 'function' ? matchMedia(DARK) : undefined;
  query?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    query?.removeEventListener('change', onChange);
  };
}

export const subscribeToScheme = (onChange: () => void) => subscribe(onChange, true);
const subscribeToHtmlTheme = (onChange: () => void) => subscribe(onChange, false);
const noSubscription = () => () => undefined;

/** `AskDialog`'s `theme`, with `system`, its name before 0.9, read as `auto`. */
export function themeOption(theme: OndocsTheme | 'system' | undefined): OndocsTheme {
  if (theme !== 'system') return theme ?? 'auto';
  warnDeprecated('theme="system"', 'theme="auto"');
  return 'auto';
}

/**
 * The `data-ask-theme` the dialog and its button carry: the scheme `theme` pins, or with `auto`,
 * the one `<html data-theme>` names, kept up to date. Without either, nothing, and the stylesheet
 * follows `prefers-color-scheme`, as it does on the server.
 */
export function useThemeAttribute(theme: OndocsTheme): 'light' | 'dark' | undefined {
  const auto = theme === 'auto';
  return useSyncExternalStore(
    auto ? subscribeToHtmlTheme : noSubscription,
    () => (auto ? htmlTheme() : theme),
    () => (auto ? undefined : theme),
  );
}
