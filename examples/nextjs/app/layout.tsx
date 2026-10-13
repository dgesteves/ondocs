import { Analytics } from '@vercel/analytics/next';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import 'ondocs/react/styles.css';
import './globals.css';

import { Ask } from '../components/ask';
import { CopyButtons } from '../components/copy-buttons';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { mode } from '../lib/ai';
import { mono, sans } from '../lib/fonts';
import { HOME_DESCRIPTION, HOME_TITLE, SITE_URL } from '../lib/site';
import { THEME_SCRIPT } from '../lib/theme';

// Each page sets its own canonical URL and share card: the home page, the docs, and none on the
// 404 page, so nothing here is inherited by a page it doesn't describe.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: '%s · ondocs' },
  description: HOME_DESCRIPTION,
  applicationName: 'ondocs',
  authors: [{ name: 'Diogo Esteves', url: 'https://github.com/dgesteves' }],
  keywords: [
    'Ask AI',
    'MCP server',
    'llms.txt',
    'docs search',
    'RAG',
    'Docusaurus plugin',
    'Starlight plugin',
    'VitePress plugin',
    'Astro integration',
    'Next.js',
    'AI SDK',
    'BM25',
    'hybrid search',
  ],
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f12' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme class is added before paint by THEME_SCRIPT, so the server's markup can't match it.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Ask mode={mode} />
        <CopyButtons />
        <Analytics />
      </body>
    </html>
  );
}
