'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { watchOverflow } from './overflow';

export { markOverflow } from './overflow';

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

/**
 * The tab a key moves to from this one, as ARIA's tabs pattern has it: the arrow keys to the
 * next or previous, wrapping around, and Home and End to the first and last.
 */
export function tabTarget(tab: HTMLElement, key: string): HTMLElement | undefined {
  const tabs = [...(tab.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
  const index = tabs.indexOf(tab);
  const moves: Partial<Record<string, number>> = {
    ArrowRight: (index + 1) % tabs.length,
    ArrowLeft: (index - 1 + tabs.length) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  };
  const target = moves[key];
  return target === undefined ? undefined : tabs[target];
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
 * The docs pages' small behaviors, on their static HTML: tabs (the package manager remembered
 * across blocks and visits), and the overflow marks on tables. Mounted once in the docs layout.
 */
export function DocsEnhancements() {
  const pathname = usePathname();

  useEffect(() => {
    for (const [sync, value] of Object.entries(readChoices())) selectEverywhere(sync, value);
    // Code blocks are watched on every page (components/copy-buttons.tsx); tables here.
    return watchOverflow('.prose .table-scroll');
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
      if (!tab) return;
      const next = tabTarget(tab, event.key);
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
