'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { NavSection } from '../lib/docs';
import type { Heading } from '../lib/markdown';

function DocsLinks({ sections, pathname }: { sections: NavSection[]; pathname: string }) {
  return sections.map((section) => (
    <details key={section.title} className="sidebar-section" open>
      <summary className="sidebar-heading">{section.title}</summary>
      <ul>
        {section.docs.map((doc) => {
          const href = `/docs/${doc.slug}`;
          return (
            <li key={doc.slug}>
              <Link href={href} aria-current={pathname === href ? 'page' : undefined}>
                {doc.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  ));
}

/** The docs sidebar, from 800px up, grouped, with the current page kept in its own scroll. */
export function Sidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const sidebar = nav.current;
    const link = sidebar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!sidebar || !link) return;
    const top = link.offsetTop - sidebar.offsetTop;
    if (
      top < sidebar.scrollTop ||
      top + link.offsetHeight > sidebar.scrollTop + sidebar.clientHeight
    ) {
      sidebar.scrollTop = top - sidebar.clientHeight / 2;
    }
  }, [pathname]);
  return (
    <nav ref={nav} aria-label="Documentation" className="sidebar">
      <DocsLinks sections={sections} pathname={pathname} />
    </nav>
  );
}

/**
 * The heading the reader is at: the last one whose top has passed under the sticky header
 * (the page's scroll-padding-top), or at the end of the page, the last one.
 */
export function useActiveHeading(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string>();
  const key = ids.join(' ');
  useEffect(() => {
    const elements = key
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((element) => element !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      let current: string | undefined;
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= offset + 8) current = element.id;
        else break;
      }
      const end = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(end && current ? elements.at(-1)?.id : current);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [key]);
  return active;
}

function TocLinks({
  headings,
  active,
  onNavigate,
}: {
  headings: readonly Heading[];
  active: string | undefined;
  onNavigate?: () => void;
}) {
  return (
    <ul>
      {headings.map((heading) => (
        <li key={heading.id}>
          <a
            href={`#${heading.id}`}
            aria-current={heading.id === active ? 'location' : undefined}
            onClick={onNavigate}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "On this page", from 1024px up, beside the page, marking the section being read. */
export function Toc({ headings }: { headings: readonly Heading[] }) {
  const active = useActiveHeading(headings.map((heading) => heading.id));
  return (
    <nav aria-label="On this page" className="toc">
      <p className="sidebar-heading">On this page</p>
      <TocLinks headings={headings} active={active} />
    </nav>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="chevron">
    <path
      d="m4 6 4 4 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** A button that names where the reader is, and opens a list below the bar. */
function BarMenu({
  className,
  kicker,
  label,
  open,
  onToggle,
  onClose,
  children,
}: {
  className: string;
  kicker: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Escape closes the list, and so does a click or tap anywhere outside it and its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);
  return (
    <div ref={root} className={`docs-bar-item ${className}`}>
      <button
        ref={button}
        type="button"
        className="docs-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="docs-menu-label">
          <span className="docs-menu-kicker">{kicker}</span>
          <span className="docs-menu-current">{label}</span>
        </span>
        <Chevron />
      </button>
      <div id={panelId} className="docs-menu-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/**
 * The bar under the header below 1024px: the docs' pages below 800px, where the sidebar goes,
 * and the page's sections, where "On this page" goes. It stays as the page scrolls.
 */
export function DocsBar({
  sections,
  headings = [],
}: {
  sections: NavSection[];
  headings?: readonly Heading[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<'pages' | 'toc' | null>(null);
  const [openedAt, setOpenedAt] = useState(pathname);
  const active = useActiveHeading(headings.map((heading) => heading.id));
  const current = sections.flatMap((s) => s.docs).find((doc) => `/docs/${doc.slug}` === pathname);

  // Following a link to another page closes the menu.
  if (open && openedAt !== pathname) {
    setOpen(null);
    setOpenedAt(pathname);
  }
  const toggle = (menu: 'pages' | 'toc') => () => {
    setOpen(open === menu ? null : menu);
    setOpenedAt(pathname);
  };
  const close = () => {
    setOpen(null);
  };

  return (
    <div className={`docs-bar${headings.length > 0 ? ' docs-bar-toc' : ''}`}>
      <BarMenu
        className="docs-bar-pages"
        kicker="Docs"
        label={current?.label ?? 'All pages'}
        open={open === 'pages'}
        onToggle={toggle('pages')}
        onClose={close}
      >
        <nav aria-label="Documentation">
          <DocsLinks sections={sections} pathname={pathname} />
        </nav>
      </BarMenu>
      {headings.length > 0 ? (
        <BarMenu
          className="docs-bar-toc-menu"
          kicker="On this page"
          label={headings.find((heading) => heading.id === active)?.text ?? 'Overview'}
          open={open === 'toc'}
          onToggle={toggle('toc')}
          onClose={close}
        >
          <nav aria-label="On this page" className="toc-menu">
            <TocLinks headings={headings} active={active} onNavigate={close} />
          </nav>
        </BarMenu>
      ) : null}
    </div>
  );
}
