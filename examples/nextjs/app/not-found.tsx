import type { Metadata } from 'next';
import Link from 'next/link';

import { AskButton } from '../components/ask';

// Its own description, and no canonical URL or share card: the home page's are in app/(home), so
// none applies to an address that doesn't exist. Next.js marks the page noindex itself.
export const metadata: Metadata = {
  title: 'Page not found',
  description: 'There is no page at this address. Browse the ondocs documentation, or ask it.',
  alternates: null,
  openGraph: null,
  twitter: null,
};

export default function NotFound() {
  return (
    <main id="content" className="not-found">
      <p className="not-found-code">404</p>
      <h1>This page doesn’t exist.</h1>
      <p>It may have moved when the docs were reorganized. Try the docs, or ask them.</p>
      <div className="not-found-actions">
        <Link href="/docs" className="button button-secondary">
          Browse the docs
        </Link>
        <AskButton className="button button-ghost">Ask the docs</AskButton>
      </div>
    </main>
  );
}
