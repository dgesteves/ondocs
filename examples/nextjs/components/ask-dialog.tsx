'use client';

import { AskDialog } from 'ondocs/react';
import { useRouter } from 'next/navigation';

import { SUGGESTIONS } from '../lib/site';
import { usePageScheme } from './theme-switch';

/** The site's dialog: the library's `AskDialog`, routing citations through the Next.js router. */
export function SiteAskDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: 'openai' | 'mock';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  // The site's theme is a class on <html>, which the dialog's `auto` doesn't read: it is told.
  const scheme = usePageScheme();
  return (
    <AskDialog
      endpoint="/api/ask"
      open={open}
      onOpenChange={onOpenChange}
      // The site handles ⌘K and ⌘I itself, so they work before this component has loaded.
      shortcut={false}
      theme={scheme ?? 'auto'}
      title="Ask the ondocs documentation"
      placeholder="Ask the docs a question…"
      suggestions={SUGGESTIONS}
      onNavigate={(url, event) => {
        // Same-site links go through the client router; anything else navigates normally.
        if (url.startsWith('/')) {
          event.preventDefault();
          router.push(url);
        }
      }}
      footer={
        <div className="ask-footer">
          <span>
            {mode === 'mock'
              ? 'Mock mode: offline embeddings, answers quoted from these docs.'
              : 'Answers are generated from these docs and can be wrong. Check the sources.'}
          </span>
          {/* The input row shows esc already. */}
          <span className="ask-footer-keys" aria-hidden="true">
            <kbd className="ask-kbd">↵</kbd> ask
          </span>
        </div>
      }
    />
  );
}
