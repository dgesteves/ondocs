// The part of the embed every page runs: the "Ask AI" button and the shortcut, in plain DOM, with
// no React. The dialog (React, Radix, cmdk) loads on first use: a pointer over or focus on the
// button or a `data-ondocs-open` element, the shortcut, or `open()`. A shortcut pressed while it
// loads opens it once it has.
import { warnDeprecated } from '../deprecation';
import { asked, listenForOpen } from './open';
import type { OndocsDialogOptions, OndocsTheme } from './options';

export interface MountAskDialogOptions extends OndocsDialogOptions {
  /** URL the dialog posts questions to. Default `/api/ask`. */
  endpoint?: string;
  /** The page's locale, sent with each question, for an endpoint with an index per locale. */
  locale?: string;
  /** Default `auto`: the page's `data-theme` on `<html>` if it has one, else the system's. */
  theme?: OndocsTheme;
  /** Extra request headers, e.g. an auth token. */
  headers?: Record<string, string>;
  /** Where to render. Default: a new `<div class="ondocs">` at the end of `<body>`. */
  container?: Element;
  /**
   * Called when a citation or source is clicked. Call `event.preventDefault()` to route with
   * your own router; otherwise the link navigates. The dialog closes either way.
   */
  onNavigate?: (url: string, event: MouseEvent) => void;
}

export interface MountedAskDialog {
  /** Opens the dialog, and asks `question` in it when one is given, in a new thread. */
  open: (question?: string) => void;
  close: () => void;
  /** Removes the dialog, the button and, if it created it, the container. */
  unmount: () => void;
}

/** The dialog, rendered once its code has loaded: what `ondocs/embed`'s dialog module does. */
export interface DialogRenderer {
  render: (
    element: Element,
    options: DialogRenderOptions,
  ) => {
    /** Opens or closes the dialog; opening it with a question asks that question. */
    setOpen: (open: boolean, question?: string) => void;
    unmount: () => void;
  };
}

export interface DialogRenderOptions extends Omit<
  MountAskDialogOptions,
  'container' | 'shortcut' | 'launcher' | 'buttonLabel'
> {
  open: boolean;
  /** A question to ask as the dialog opens. */
  question?: string;
  onOpenChange: (open: boolean) => void;
}

const DARK = '(prefers-color-scheme: dark)';

/** The page's color scheme: `<html data-theme>` when it says light or dark, else the system's. */
function pageScheme(): 'light' | 'dark' {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'light' || theme === 'dark') return theme;
  return typeof matchMedia === 'function' && matchMedia(DARK).matches ? 'dark' : 'light';
}

/** Text fields, selects and rich text editors. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

/**
 * Mounts the launcher, and the dialog through `load` when it is first wanted. What
 * `mountAskDialog` from `ondocs/embed` and the script tag share; they differ in how the
 * dialog's code arrives (a dynamic import, or a second script).
 */
export function mountWithLoader(
  options: MountAskDialogOptions,
  load: () => Promise<DialogRenderer>,
): MountedAskDialog {
  const {
    container: given,
    shortcut = 'i',
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- its name before 0.9, still read
    buttonLabel,
    launcher = buttonLabel ?? true,
    theme = 'auto',
    ...dialogOptions
  } = options;
  if (buttonLabel !== undefined) warnDeprecated('buttonLabel', 'launcher');
  const label = launcher === true ? (options.labels?.launcher ?? 'Ask AI') : launcher;
  const container = given ?? document.createElement('div');
  // Astro's <ClientRouter /> replaces <body> on navigation, and the dialog's container with it.
  const reattach = (): void => {
    if (!container.isConnected) document.body.append(container);
  };
  if (!given) {
    container.className = 'ondocs';
    document.body.append(container);
    document.addEventListener('astro:after-swap', reattach);
  }

  let open = false;
  // The question the dialog was last opened with, for a dialog whose code is still loading.
  let question: string | undefined;
  let dialog: ReturnType<DialogRenderer['render']> | null = null;
  let loading: Promise<void> | null = null;
  let unmounted = false;

  const key = shortcut ? shortcut.toUpperCase() : '';
  let button: HTMLButtonElement | null = null;
  if (label !== false) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'ondocs-launcher';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    if (key) button.setAttribute('aria-keyshortcuts', `Meta+${key} Control+${key}`);
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✦';
    button.append(icon, ` ${label}`);
    if (key) {
      const kbd = document.createElement('kbd');
      kbd.setAttribute('aria-hidden', 'true');
      kbd.textContent = `${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : `${options.labels?.controlKey ?? 'Ctrl'} `}${key}`;
      button.append(kbd);
    }
    container.append(button);
  }

  // The button follows the page's light or dark scheme, as the dialog does.
  const applyScheme = (): void => {
    button?.setAttribute('data-ask-theme', theme === 'auto' ? pageScheme() : theme);
  };
  applyScheme();
  const observer = theme === 'auto' ? new MutationObserver(applyScheme) : null;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const media = theme === 'auto' && typeof matchMedia === 'function' ? matchMedia(DARK) : null;
  media?.addEventListener('change', applyScheme);

  const setOpen = (next: boolean, asking?: string): void => {
    open = next;
    if (next) question = asking;
    button?.setAttribute('aria-expanded', String(next));
    if (next && asking) dialog?.setOpen(next, asking);
    else dialog?.setOpen(next);
  };

  /** Loads the dialog's code, once, and renders it closed or open as it is wanted by then. */
  const prepare = (): Promise<void> => {
    loading ??= load()
      .then((renderer) => {
        if (unmounted) return;
        const element = document.createElement('div');
        container.append(element);
        dialog = renderer.render(element, {
          ...dialogOptions,
          theme,
          open,
          ...(open && question ? { question } : {}),
          onOpenChange: (next) => {
            setOpen(next);
          },
        });
      })
      .catch((error: unknown) => {
        loading = null;
        console.error('[ondocs] The dialog could not load.', error);
      });
    return loading;
  };

  const show = (asking?: string): void => {
    setOpen(true, asking);
    void prepare();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Opened before its code has arrived, the dialog is not there to close on Escape yet.
    if (event.key === 'Escape' && open && !dialog) {
      setOpen(false);
      return;
    }
    if (!key || !(event.metaKey || event.ctrlKey) || event.key.toUpperCase() !== key) return;
    // In a text field the keys are often the field's own (⌘I is italic), so they are left to it.
    // The dialog's own input still closes it.
    if (!open && isEditable(event.target)) return;
    event.preventDefault();
    if (open) setOpen(false);
    else show();
  };
  window.addEventListener('keydown', onKeyDown);

  const prefetch = (): void => {
    void prepare();
  };
  // openAskDialog(), and the page's own buttons and forms with data-ondocs-open.
  const stopListening = listenForOpen(show, prefetch);
  button?.addEventListener('pointerenter', prefetch);
  button?.addEventListener('focus', prefetch);
  button?.addEventListener('click', (event) => {
    // Focus stays on the button (Safari does not move it there on a click), so it gets it back
    // when the dialog closes.
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    show();
  });

  return {
    open: (asking) => {
      show(asked(asking));
    },
    close: () => {
      setOpen(false);
    },
    unmount: () => {
      unmounted = true;
      window.removeEventListener('keydown', onKeyDown);
      stopListening();
      observer?.disconnect();
      media?.removeEventListener('change', applyScheme);
      dialog?.unmount();
      dialog = null;
      button?.remove();
      if (!given) {
        document.removeEventListener('astro:after-swap', reattach);
        container.remove();
      }
    },
  };
}
