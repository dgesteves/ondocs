'use client';

import { useEffect, useRef } from 'react';

/**
 * Makes every `[data-copy]` button copy its code block, or the text in its `data-copy` value.
 * One delegated listener covers the static HTML of the docs and the home page.
 */
export function CopyButtons() {
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onClick = (event: MouseEvent) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-copy]')
          : null;
      if (!button) return;
      // In a block with tabs, the tab that shows.
      const block = button.closest('.code-block');
      const text =
        button.dataset.copy ||
        (block?.querySelector('[role="tabpanel"]:not([hidden]) pre') ?? block?.querySelector('pre'))
          ?.textContent ||
        '';
      void navigator.clipboard.writeText(text.replace(/\n$/, '')).then(
        () => {
          const label = button.querySelector('.copy-label') ?? button;
          const original = button.dataset.label ?? label.textContent;
          button.dataset.label = original;
          label.textContent = 'Copied';
          button.dataset.copied = '';
          if (status.current) status.current.textContent = 'Copied to the clipboard';
          window.clearTimeout(timers.get(button));
          timers.set(
            button,
            window.setTimeout(() => {
              label.textContent = original;
              delete button.dataset.copied;
              if (status.current) status.current.textContent = '';
            }, 1600),
          );
        },
        () => undefined,
      );
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
    };
  }, []);
  return <p ref={status} className="sr-only" aria-live="polite" />;
}
