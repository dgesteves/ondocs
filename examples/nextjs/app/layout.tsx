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
import { SITE_URL } from '../lib/site';

const description =
  'Make your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own key. No vector database.';

const title = 'ondocs: make your docs answerable by people and by agents';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: '%s · ondocs' },
  description,
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
  openGraph: { type: 'website', siteName: 'ondocs', title, description, url: '/' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport: Viewport = {
  themeColor: '#0d0f12',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Ask mode={mode} />
        <CopyButtons />
      </body>
    </html>
  );
}
