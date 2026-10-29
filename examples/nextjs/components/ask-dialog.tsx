'use client';

import { AskDialog } from 'ondocs/react';
import { useRouter } from 'next/navigation';

import { SUGGESTIONS } from '../lib/site';
import { usePageScheme } from './theme-switch';

/**
 * The Turnstile widget's site key, which is public. With it set, and the endpoint's secret key
 * (`askChallenge` in lib/ask-handler.ts), the dialog solves a bot check for each question.
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

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
      // The site handles ⌘K and ⌘I itself (components/ask.tsx): the dialog takes one shortcut key.
      shortcut={false}
      theme={scheme ?? 'auto'}
      title="Ask the ondocs documentation"
      placeholder="Ask the docs a question…"
      suggestions={SUGGESTIONS}
      {...(TURNSTILE_SITE_KEY ? { challenge: { turnstile: TURNSTILE_SITE_KEY } } : {})}
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
