'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { watchOverflow } from './overflow';

/**
 * Makes every `[data-copy]` button copy its code block, or the text in its `data-copy` value,
 * and keeps every code block's overflow marked, for the fade at its right edge. One delegated
 * listener covers the static HTML of the docs and the home page.
 */
export function CopyButtons() {
  const status = useRef<HTMLParagraphElement>(null);
  const pathname = usePathname();

  useEffect(() => watchOverflow('.code-block pre'), [pathname]);

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
          // A button with a text label says Copied; an icon button shows a check.
          const label = button.querySelector('.copy-label');
          if (label) {
            button.dataset.label ??= label.textContent;
            label.textContent = 'Copied';
          }
          button.dataset.copied = '';
          if (status.current) status.current.textContent = 'Copied to the clipboard';
          window.clearTimeout(timers.get(button));
          timers.set(
            button,
            window.setTimeout(() => {
              if (label) label.textContent = button.dataset.label ?? 'Copy';
              delete button.dataset.copied;
              if (status.current) status.current.textContent = '';
            }, 1600),
          );
        },
        () => {
          if (status.current)
            status.current.textContent = 'Copying failed: select the code instead';
        },
      );
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
    };
  }, []);
  return <p ref={status} className="sr-only" aria-live="polite" />;
}
