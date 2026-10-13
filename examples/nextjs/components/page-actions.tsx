'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { SITE_URL } from '../lib/site';
import { CopyIcon } from './icons';

/** The prompt that opens a chat about the page: its Markdown copy, by URL. */
export const chatPrompt = (slug: string): string =>
  `Read ${SITE_URL}/docs/${slug}.md so I can ask you questions about it.`;

export const chatLinks = (slug: string) => ({
  chatgpt: `https://chatgpt.com/?q=${encodeURIComponent(chatPrompt(slug))}`,
  claude: `https://claude.ai/new?q=${encodeURIComponent(chatPrompt(slug))}`,
});

/**
 * Copies the page's Markdown, the `.md` copy `pnpm index` writes into public/. The text is
 * fetched inside the click, as a promise the clipboard waits on, so Safari keeps the click's
 * permission to write.
 */
async function copyMarkdown(href: string): Promise<void> {
  const text = fetch(href).then((response) => {
    if (!response.ok) throw new Error(`${href}: ${String(response.status)}`);
    return response.text();
  });
  if (typeof ClipboardItem === 'function' && typeof navigator.clipboard.write === 'function') {
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
  } else {
    await navigator.clipboard.writeText(await text);
  }
}

/** Copy page, and a menu: the same as Markdown, the .md copy, and the page in ChatGPT or Claude. */
export function PageActions({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'' | 'Copied' | 'Copy failed'>('');
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const href = `/docs/${slug}.md`;
  const links = chatLinks(slug);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => {
      setStatus('');
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status]);

  const copy = () => {
    setOpen(false);
    copyMarkdown(href).then(
      () => {
        setStatus('Copied');
      },
      () => {
        setStatus('Copy failed');
      },
    );
  };

  return (
    <div ref={root} className="page-actions">
      <button type="button" className="page-actions-copy" onClick={copy}>
        <CopyIcon />
        <span aria-live="polite">{status || 'Copy page'}</span>
      </button>
      <button
        ref={toggle}
        type="button"
        className="page-actions-toggle"
        aria-label="More page actions"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <ul id={menuId} className="page-actions-menu" hidden={!open}>
        <li>
          <button type="button" onClick={copy}>
            Copy page as Markdown
          </button>
        </li>
        <li>
          <a href={href}>View .md</a>
        </li>
        <li>
          <a href={links.chatgpt} target="_blank" rel="noopener noreferrer">
            Open in ChatGPT
          </a>
        </li>
        <li>
          <a href={links.claude} target="_blank" rel="noopener noreferrer">
            Open in Claude
          </a>
        </li>
      </ul>
    </div>
  );
}
