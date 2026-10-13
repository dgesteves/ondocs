/**
 * Marks a code block or table that scrolls sideways: a fade at its right edge until it is
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
 * Keeps the overflow marks of every element `selector` matches up to date, as they resize and
 * scroll. Returns the cleanup.
 */
export function watchOverflow(selector: string): () => void {
  const scrollers = [...document.querySelectorAll<HTMLElement>(selector)];
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
}
