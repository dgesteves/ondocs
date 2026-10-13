import type { Metadata } from 'next';
import Link from 'next/link';

import { getSections } from '../../lib/docs';
import { DOCS_DESCRIPTION as description } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Documentation',
  description,
  alternates: { canonical: '/docs' },
  openGraph: {
    type: 'website',
    siteName: 'ondocs',
    title: 'ondocs documentation',
    description,
    url: '/docs',
  },
  twitter: { card: 'summary_large_image', title: 'ondocs documentation', description },
};

export default async function DocsHome() {
  const sections = await getSections();
  return (
    <article className="docs-home">
      <h1>Documentation</h1>
      <p className="lead">
        Everything about ondocs, from the first install to the index format. Every page here is also
        in the index, so you can ask instead.
      </p>
      {sections.map((section) => {
        // #integrations is the header's Integrations link.
        const id = section.title.toLowerCase().replace(/\s+/g, '-');
        return (
          <section key={section.title} className="card-section" aria-labelledby={id}>
            <h2 id={id} className="sidebar-heading">
              {section.title}
            </h2>
            <ul className="cards">
              {section.docs.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="card">
                    <span className="card-title">{doc.title}</span>
                    <span className="card-description">{doc.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </article>
  );
}
