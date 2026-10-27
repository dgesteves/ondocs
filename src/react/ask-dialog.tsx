import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { keyBuffer } from '../embed/mount';
import type { OndocsTheme } from '../embed/options';
import type { AnswerLinks, SourceUrls } from './answer';
import type { AskDialogLabels } from './labels';
import { themeOption, useThemeAttribute } from './theme';
import type { AskState, UseAskOptions } from './use-ask';

export type AskDialogSlot =
  'overlay' | 'content' | 'input' | 'list' | 'item' | 'answer' | 'sources' | 'footer';

export interface AskDialogProps extends Omit<UseAskOptions, 'onFinish'> {
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Key that opens the dialog with ⌘ (macOS) or Ctrl. Default `"i"`, as in the plugins and the
   * script embed, so ⌘K stays with the site's search; `"k"` for ⌘K. `false` disables it. It does
   * not open the dialog while a text field or editor has focus.
   */
  shortcut?: string | false;
  /** Element that opens the dialog, e.g. a search button. Rendered with Radix `asChild`. */
  trigger?: ReactNode;
  /**
   * A floating "Ask AI" button in the corner of the page, as the framework plugins and the script
   * embed show, with the shortcut on it: `true`, or the button's label. Import
   * `ondocs/embed/launcher.css` for its look, or style `.ondocs-launcher` yourself.
   */
  launcher?: boolean | string;
  /**
   * Every string the dialog shows or announces, in your language: any of them, over the English
   * defaults. `title`, `placeholder` and `launcher` win over their labels.
   */
  labels?: Partial<AskDialogLabels>;
  /** Accessible dialog title. Default `labels.title`, "Ask this site". */
  title?: string;
  placeholder?: string;
  /** Questions offered before the visitor types. */
  suggestions?: readonly string[];
  /**
   * Called when a citation or source is clicked. Call `event.preventDefault()` and route
   * yourself for client-side navigation (e.g. `router.push(url)`). The dialog closes either way.
   */
  onNavigate?: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  /**
   * `auto` (the default) follows a `data-theme="light"` or `"dark"` on `<html>`, and
   * `prefers-color-scheme` on a page without one; `light` or `dark` pins one. `system`, its name
   * before 0.9, still works, with a warning, until 1.0.
   */
  theme?: OndocsTheme | 'system';
  /** Extra class names per part, e.g. for Tailwind. Default classes stay. */
  classNames?: Partial<Record<AskDialogSlot, string>>;
  /** Replaces the default footer. */
  footer?: ReactNode;
  /**
   * Which links in an answer stay links: `"sources"` (the default), only links to the pages the
   * answer's sources are on, or `"all"`. See `AskAnswer`.
   */
  links?: AnswerLinks;
  /**
   * For an endpoint that answers from another site's index, such as a copy of its docs: where the
   * citations, the sources and the answer's links point. `pages` maps a page's URL in that index
   * to the same page here, keeping the anchor; `base` is that site's address, which any other
   * relative URL resolves against. See `SourceUrls`.
   */
  sourceUrls?: SourceUrls;
  /**
   * A bot check before each question, for an endpoint with `challenge` set:
   * `{ turnstile: '<site key>' }`, a Cloudflare Turnstile widget's site key. When the dialog opens
   * it loads Turnstile's script from challenges.cloudflare.com and solves a token, invisibly
   * unless Turnstile asks the visitor to click, and it sends a fresh token with each question.
   */
  challenge?: { turnstile: string };
  /**
   * A question to ask, as if typed and sent: when the dialog opens with it, and again when it
   * changes while the dialog is open, each time in a new thread. With a controlled `open`, set
   * both to open the dialog on a question, as a "Try asking" link on a landing page does.
   */
  question?: string;
  onFinish?: (state: AskState) => void;
}

let panel: Promise<typeof import('./dialog-panel')> | undefined;
/**
 * The dialog, once its code has loaded, which `AskDialog` then renders in the same render as the
 * open. Behind `Suspense`, React held its first render back for about 300 ms, even with the code
 * already there.
 */
let loadedPanel: (typeof import('./dialog-panel'))['DialogPanel'] | undefined;

/**
 * Loads the dialog's code (Radix Dialog, cmdk and the answer), once. `AskDialog` calls it when
 * the dialog is first wanted: a pointer over or focus on its button or trigger, its shortcut, or
 * opening it. Call it yourself to load the dialog sooner, e.g. when the page is idle.
 */
export function loadAskDialog(): Promise<unknown> {
  panel ??= import('./dialog-panel').then((module) => {
    loadedPanel = module.DialogPanel;
    return module;
  });
  return panel;
}

// A layout effect, so what is typed is kept from the commit that opens the dialog, before the
// dialog's own effects move focus into it. The server runs neither.
const useBrowserLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

const noSubscription = () => () => undefined;
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** Text fields, selects and rich text editors. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

/**
 * A ⌘I "ask" palette: a Radix dialog with a cmdk input, a streaming answer with numbered
 * citations, and the list of sources.
 *
 * Light on the page: what renders at first is only its shortcut and, if asked for, its button.
 * The dialog's own code loads on first use (a pointer over or focus on the button or `trigger`,
 * the shortcut, or `open`), and a shortcut pressed before it has loaded opens it once it has.
 *
 * Accessible by construction: focus moves into the dialog on open and back to where it was on
 * close, Escape closes it, the answer region is `aria-live` (and `aria-busy` while streaming),
 * and status changes are announced through a separate `role="status"` region. Motion is
 * disabled under `prefers-reduced-motion`.
 *
 * Unstyled-friendly: every part has a stable `ask-*` class and accepts extra classes through
 * `classNames`. Import `ondocs/react/styles.css` for the default theme.
 */
export function AskDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  shortcut = 'i',
  trigger,
  launcher = false,
  theme: themeProp,
  ...props
}: AskDialogProps): ReactNode {
  const theme = themeOption(themeProp);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const openRef = useRef(open);
  // The dialog mounts the first time it opens, and stays, so its answer survives closing.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const wanted = mounted || open;
  const loadedRef = useRef(false);
  const [, setArrived] = useState(false);
  // What is typed while the dialog is open and its input does not have focus yet: on the first
  // open, while its code loads. The input starts with it, unless the dialog opened on a question.
  const [typed] = useState(keyBuffer);
  const asking = Boolean(props.question?.trim());
  // The server renders "Ctrl", and the browser corrects it after hydration.
  const mac = useSyncExternalStore(noSubscription, isMac, () => false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useBrowserLayoutEffect(() => {
    if (!open || asking) return;
    typed.start();
    return () => {
      typed.take();
    };
  }, [open, asking, typed]);

  // Wanted before its code is there, the dialog renders as the code arrives.
  useEffect(() => {
    if (!wanted || loadedPanel) return;
    let current = true;
    loadAskDialog().then(
      () => {
        if (current) setArrived(true);
      },
      (error: unknown) => {
        // Without a dialog to type into, the page has its keys back.
        typed.take();
        console.error('[ondocs] The dialog could not load.', error);
      },
    );
    return () => {
      current = false;
    };
  }, [wanted, typed]);

  const setOpen = useCallback(
    (next: boolean) => {
      // Controlled: the parent decides, and `openRef` follows the prop. Uncontrolled: update the
      // ref now, so two shortcut presses in one tick cannot both open.
      if (openProp === undefined) {
        openRef.current = next;
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const load = useCallback(() => {
    void loadAskDialog().then(() => {
      loadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Opened before its code has arrived, the dialog is not there to close on Escape yet.
      if (event.key === 'Escape' && openRef.current && !loadedRef.current) {
        setOpen(false);
        return;
      }
      if (shortcut === false) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== shortcut.toLowerCase()) {
        return;
      }
      // In a text field the keys are often the field's own (⌘I is italic), so they are left to it.
      // The dialog's own input still closes it.
      if (!openRef.current && isEditable(event.target)) return;
      event.preventDefault();
      load();
      setOpen(!openRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shortcut, setOpen, load]);

  /** Opens the dialog from a button, which gets focus back when it closes, as Radix's trigger did. */
  const openFrom = (event: MouseEvent<HTMLElement>): void => {
    event.currentTarget.focus({ preventScroll: true });
    load();
    setOpen(true);
  };
  const intent = { onPointerEnter: load, onFocus: load };
  const state = {
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'data-state': open ? 'open' : 'closed',
  } as const;
  const themeAttribute = useThemeAttribute(theme);
  const key = shortcut ? shortcut.toUpperCase() : '';
  const DialogPanel = wanted ? loadedPanel : undefined;

  return (
    <>
      {isValidElement<TriggerProps>(trigger) ? (
        <Trigger element={trigger} onOpen={openFrom} onIntent={load} state={state} />
      ) : (
        (trigger ?? null)
      )}
      {launcher === false ? null : (
        <button
          type="button"
          className="ondocs-launcher"
          data-ask-theme={themeAttribute}
          aria-keyshortcuts={key ? `Meta+${key} Control+${key}` : undefined}
          onClick={openFrom}
          {...intent}
          {...state}
        >
          <span aria-hidden="true">✦</span>{' '}
          {launcher === true ? (props.labels?.launcher ?? 'Ask AI') : launcher}
          {key ? (
            <kbd aria-hidden="true">
              {mac ? '⌘' : `${props.labels?.controlKey ?? 'Ctrl'} `}
              {key}
            </kbd>
          ) : null}
        </button>
      )}
      {DialogPanel ? (
        <DialogPanel
          {...props}
          theme={theme}
          open={open}
          onOpenChange={setOpen}
          draft={typed.take}
        />
      ) : null}
    </>
  );
}

interface TriggerProps {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onPointerEnter?: (event: unknown) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * `element` with what opens the dialog added to its own handlers, as Radix's `asChild` trigger
 * did: its click opens it (unless the element's own handler prevents that), and a pointer over
 * it or focus on it loads the dialog's code.
 */
function Trigger({
  element,
  onOpen,
  onIntent,
  state,
}: {
  element: ReactElement<TriggerProps>;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  onIntent: () => void;
  state: Record<string, unknown>;
}): ReactNode {
  const own = element.props;
  return cloneElement(element, {
    ...state,
    onClick: (event: MouseEvent<HTMLElement>) => {
      own.onClick?.(event);
      if (!event.defaultPrevented) onOpen(event);
    },
    onPointerEnter: (event: unknown) => {
      own.onPointerEnter?.(event);
      onIntent();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      own.onFocus?.(event);
      onIntent();
    },
  } as Partial<TriggerProps>);
}
