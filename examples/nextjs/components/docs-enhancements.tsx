'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const SYNC_KEY = 'ondocs-tabs';

function readChoices(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Shows one tab of a group: its panel visible, the others hidden, as ARIA's tabs pattern has it. */
export function selectTab(tab: HTMLElement): void {
  const list = tab.closest('[role="tablist"]');
  const group = tab.closest('[data-tabs]');
  if (!list || !group) return;
  for (const other of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const selected = other === tab;
    other.setAttribute('aria-selected', String(selected));
    other.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(other.getAttribute('aria-controls') ?? '');
    if (panel) panel.hidden = !selected;
  }
}

/** Every group with this `data-sync` key shows the tab with this value. */
function selectEverywhere(sync: string, value: string) {
  for (const tab of document.querySelectorAll<HTMLElement>(
    `[data-sync="${CSS.escape(sync)}"] [role="tab"][data-value="${CSS.escape(value)}"]`,
  )) {
    selectTab(tab);
  }
}

/**
 * Marks each code block and table that scrolls sideways: a fade at its right edge until it is
 * scrolled to the end, a tab stop so the keyboard can scroll it, and for a table, a name after
 * its heading. Content that fits gets none of these, so a page has no tab stop per table.
 */
export function markOverflow(scroller: HTMLElement): void {
  // A tab that isn't showing has no size to measure; it is measured when it shows.
  if (scroller.closest('[hidden]')) return;
  const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
  scroller.toggleAttribute('data-overflow', overflows);
  scroller.toggleAttribute(
    'data-scrolled-end',
    scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1,
  );
  if (overflows) scroller.tabIndex = 0;
  else scroller.removeAttribute('tabindex');
  if (!scroller.classList.contains('table-scroll')) return;
  if (overflows) {
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', scroller.dataset.name ?? 'Table');
  } else {
    scroller.removeAttribute('role');
    scroller.removeAttribute('aria-label');
  }
}

/**
 * The docs pages' small behaviors, on their static HTML: tabs (the package manager remembered
 * across blocks and visits), and the overflow marks above. Mounted once in the docs layout.
 */
export function DocsEnhancements() {
  const pathname = usePathname();

  useEffect(() => {
    for (const [sync, value] of Object.entries(readChoices())) selectEverywhere(sync, value);
    const scrollers = [
      ...document.querySelectorAll<HTMLElement>('.prose pre, .prose .table-scroll'),
    ];
    const check = () => {
      for (const scroller of scrollers) markOverflow(scroller);
    };
    check();
    const onScroll = (event: Event) => {
      if (event.target instanceof HTMLElement && scrollers.includes(event.target)) {
        markOverflow(event.target);
      }
    };
    const observer = new ResizeObserver(check);
    for (const scroller of scrollers) observer.observe(scroller);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [pathname]);

  useEffect(() => {
    const choose = (tab: HTMLElement) => {
      selectTab(tab);
      const sync = tab.closest<HTMLElement>('[data-sync]')?.dataset.sync;
      const value = tab.dataset.value;
      if (!sync || !value) return;
      selectEverywhere(sync, value);
      try {
        localStorage.setItem(SYNC_KEY, JSON.stringify({ ...readChoices(), [sync]: value }));
      } catch {
        // Not remembered.
      }
    };
    const onClick = (event: MouseEvent) => {
      const tab =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tabs] [role="tab"]')
          : null;
      if (tab) choose(tab);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const tab =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tabs] [role="tab"]')
          : null;
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!tab || !step) return;
      const tabs = [...(tab.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
      const next = tabs.at((tabs.indexOf(tab) + step) % tabs.length);
      if (!next) return;
      event.preventDefault();
      choose(next);
      next.focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return null;
}
