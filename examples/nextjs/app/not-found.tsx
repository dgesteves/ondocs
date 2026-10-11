import type { Metadata } from 'next';
import Link from 'next/link';

import { AskButton } from '../components/ask';

export const metadata: Metadata = { title: 'Page not found' };

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
