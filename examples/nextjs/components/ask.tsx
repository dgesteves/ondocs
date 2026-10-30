'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { SiteAskDialog } from './ask-dialog';

const OPEN_EVENT = 'ondocs:open';

/** Opens the dialog from anywhere on the page. */
export function openAsk(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** ⌘K, as the dialog is this site's only search, and ⌘I, its shortcut in the plugins. */
const SHORTCUT_KEYS = new Set(['k', 'i']);

/**
 * The letter a key types, or, on a layout that types no Latin letters (Russian, Greek), the one
 * in its place on a US keyboard, as the library's shortcut reads it. Not with Alt or Option, which
 * type other characters from the same place (AltGr+I types í on US International).
 */
const letterOf = (event: KeyboardEvent): string => {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key) || event.altKey) return key;
  return /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase() ?? key;
};

/** Text fields and editors keep ⌘K and ⌘I, as the dialog's own shortcut does. */
const isEditable = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
    null;

/** The ask dialog, mounted once in the root layout and opened by ⌘K, ⌘I or any `AskButton`. */
export function Ask({ mode }: { mode: 'openai' | 'mock' }) {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const setOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  }, []);

  useEffect(() => {
    const show = () => {
      setOpen(true);
    };
    // The shortcuts are handled here rather than by the dialog, which takes one key, and the site
    // has two. As in the dialog: a text field keeps them, except the dialog's own input, which
    // closes it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !SHORTCUT_KEYS.has(letterOf(event))) return;
      if (!openRef.current && isEditable(event.target)) return;
      event.preventDefault();
      setOpen(!openRef.current);
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setOpen]);

  // Rendered from the start, closed: the dialog's own code (Radix, cmdk, the answer) still loads
  // when it first opens, and what is typed after ⌘K or ⌘I until its input has focus is kept for it.
  return <SiteAskDialog mode={mode} open={open} onOpenChange={setOpen} />;
}

const noSubscription = () => () => undefined;

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere; the server renders the Mac form. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noSubscription,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'),
    () => '⌘K',
  );
}

/** A button that opens the dialog, with the keyboard shortcut on devices that have a keyboard. */
export function AskButton({
  className,
  children,
  label,
}: {
  className: string;
  children: ReactNode;
  /** The button's name, when its text is shorter or hidden on narrow screens. */
  label?: string;
}) {
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      className={className}
      onClick={openAsk}
      aria-label={label}
      aria-keyshortcuts="Meta+K Control+K Meta+I Control+I"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" className="spark">
        <path
          d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
          fill="currentColor"
        />
      </svg>
      <span className="ask-button-text">{children}</span>
      <kbd className="shortcut-hint" aria-hidden="true">
        {shortcut}
      </kbd>
    </button>
  );
}
