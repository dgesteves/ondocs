// The buttons that open the dialog. `AskButton` is part of the public `ondocs/react` API. The
// dialog with its floating "Ask AI" button, and the site's color scheme, are what the Docusaurus
// theme and ondocs/embed render, and not part of it.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { listenForOpen } from '../embed/open';
import type { OndocsDialogOptions, OndocsTheme } from '../embed/options';
import { AskDialog, loadAskDialog, type AskDialogProps } from './ask-dialog';
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

export interface AskButtonProps extends Omit<AskDialogProps, 'trigger' | 'launcher'> {
  /** The button's label. Default `labels.launcher`, "Ask AI". */
  children?: ReactNode;
  /** Class names for the button, after `ondocs-button`. */
  className?: string;
  /**
   * A credit line at the end of the dialog's footer, whose link opens ondocs.vercel.app in a new
   * tab. Off by default. `true` shows `labels.poweredBy`, "Answers by {ondocs}."; a string is the
   * line in your own words. `{ondocs}` is where the link goes. A `footer` of your own replaces it
   * with the rest.
   */
  poweredBy?: boolean | string;
}

const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * An "Ask AI" button with the shortcut on it, and the `AskDialog` it opens, with the same props.
 * Put it in the site's header. The shortcut (⌘I or Ctrl+I by default; `shortcut="k"` for ⌘K) opens
 * the dialog too, also before the dialog's code has loaded, and so do `openAskDialog()` from
 * `ondocs/embed` and any element with a `data-ondocs-open` attribute, so the page's other ways in
 * need no code of their own. Render one per page.
 *
 * It is the button the plugins put in the navbar: `ondocs-button`, its label in
 * `ondocs-button-label`, then the key in a `<kbd>` whose `data-control` is the Ctrl key's name.
 * Import `ondocs/embed/button.css` for their look, filled with the accent and only the icon on a
 * phone; it shows ⌘ instead of Ctrl on Apple devices, which this marks on `<html>` with
 * `data-ondocs-mac`. Or style the classes yourself.
 */
export function AskButton({
  children,
  className,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  question,
  shortcut = 'i',
  ...props
}: AskButtonProps): ReactNode {
  // Open, and with the question it was opened with from elsewhere on the page.
  const [opened, setOpened] = useState<{ open: boolean; question?: string }>({
    open: defaultOpen,
  });
  const open = openProp ?? opened.open;
  // That question is asked when the dialog opens, and dropped when it closes, however it closes:
  // a controlled parent can close it without `onOpenChange`, as on a route change, and opening it
  // again must not ask it again in a new thread. A parent that opens it a render later still gets
  // the question.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open && opened.question !== undefined) setOpened({ open: opened.open });
  }

  // The latest `open` and `onOpenChange`, so the listeners below subscribe once, and the parent
  // hears of each change once: one Escape can reach both the dialog and its fallback for before
  // its code has loaded.
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });
  const setOpen = useCallback((next: boolean, asking?: string) => {
    setOpened(asking ? { open: next, question: asking } : { open: next });
    if (next === openRef.current) return;
    openRef.current = next;
    onOpenChangeRef.current?.(next);
  }, []);

  useEffect(
    () =>
      listenForOpen(
        (asking) => {
          setOpen(true, asking);
        },
        () => void loadAskDialog(),
      ),
    [setOpen],
  );

  // What ondocs/embed/button.css reads to show ⌘ rather than Ctrl, as the plugins' pages set it.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-ondocs-mac', isMac());
  }, []);

  const key = shortcut ? shortcut.toUpperCase() : '';
  const asking = question ?? opened.question;
  return (
    <AskDialog
      {...props}
      shortcut={shortcut}
      open={open}
      onOpenChange={setOpen}
      {...(asking ? { question: asking } : {})}
      trigger={
        <button
          type="button"
          className={className ? `ondocs-button ${className}` : 'ondocs-button'}
          aria-keyshortcuts={key ? `Meta+${key} Control+${key}` : undefined}
        >
          <span className="ondocs-button-label">
            {children ?? props.labels?.launcher ?? 'Ask AI'}
          </span>
          {key ? (
            <kbd aria-hidden="true" data-control={props.labels?.controlKey ?? 'Ctrl'}>
              {key}
            </kbd>
          ) : null}
        </button>
      }
    />
  );
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
