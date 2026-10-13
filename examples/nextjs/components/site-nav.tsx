'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { CloseIcon, MenuIcon } from './icons';

export interface NavItem {
  href: string;
  label: string;
  /** The pages this item is current on, when not its own and the pages under it. */
  paths?: readonly string[];
  /** Pages under it that another item claims. */
  except?: readonly string[];
}

/**
 * `page` on the item's own page, `true` on the pages it leads to (a section), else nothing: the
 * header marks the section a page is in, as the sidebar marks the page.
 */
export function currentState(item: NavItem, pathname: string): 'page' | 'true' | undefined {
  if (item.paths) return item.paths.includes(pathname) ? 'true' : undefined;
  if (item.except?.includes(pathname)) return undefined;
  const path = item.href.split('#')[0] ?? item.href;
  if (pathname === path) return 'page';
  return pathname.startsWith(`${path}/`) ? 'true' : undefined;
}

/** The site's pages as links, each marked when the page is in it. */
export function NavLinks({
  items,
  className,
  onNavigate,
}: {
  items: readonly NavItem[];
  className: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return items.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className={className}
      aria-current={currentState(item, pathname)}
      onClick={onNavigate}
    >
      {item.label}
    </Link>
  ));
}

const MENU_ID = 'site-menu';

/**
 * Phones: every nav item behind one button, in a native popover, which Escape and a click
 * outside close. Following a link closes it too.
 */
export function SiteMenu({ items, children }: { items: readonly NavItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const menu = document.getElementById(MENU_ID);
    const onToggle = (event: Event) => {
      setOpen((event as ToggleEvent).newState === 'open');
    };
    menu?.addEventListener('toggle', onToggle);
    return () => {
      menu?.removeEventListener('toggle', onToggle);
    };
  }, []);
  const close = () => {
    document.getElementById(MENU_ID)?.hidePopover();
  };
  return (
    <>
      <button
        type="button"
        popoverTarget={MENU_ID}
        className="header-icon header-menu-button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={MENU_ID}
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>
      <nav id={MENU_ID} popover="auto" aria-label="Site" className="site-menu">
        <div className="site-menu-links">
          <NavLinks items={items} className="site-menu-link" onNavigate={close} />
        </div>
        {children}
      </nav>
    </>
  );
}
