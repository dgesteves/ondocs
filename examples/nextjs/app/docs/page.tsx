import type { Metadata } from 'next';
import Link from 'next/link';

import { DocsBar } from '../../components/docs-nav';
import {
  INTEGRATIONS_SECTION,
  cardColumns,
  getNavSections,
  getSections,
  sectionId,
} from '../../lib/docs';
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
  const [sections, nav] = await Promise.all([getSections(), getNavSections()]);
  const start = sections.find((section) => section.title === 'Get started');
  const frameworks = sections.find((section) => section.title === INTEGRATIONS_SECTION);
  const rest = sections.filter((section) => section !== start && section !== frameworks);
  return (
    <>
      <DocsBar sections={nav} />
      <article className="docs-home">
        <h1>Documentation</h1>
        <p className="lead">
          Everything about ondocs, from the first install to the index format. Every page here is
          also in the index, so you can ask instead.
        </p>
        {start ? (
          <section className="card-section" aria-labelledby="start-here">
            <h2 id="start-here" className="sidebar-heading">
              Start here
            </h2>
            <ol className="cards start-cards" data-columns={cardColumns(start.docs.length)}>
              {start.docs.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="card">
                    <span className="card-title">{doc.title}</span>
                    <span className="card-description">{doc.description}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {frameworks ? (
          <section className="card-section" aria-labelledby="integrations">
            {/* #integrations is the header's Integrations link. */}
            <h2 id="integrations" className="sidebar-heading">
              Pick your framework
            </h2>
            <ul className="chooser">
              {frameworks.docs.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="chooser-link">
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {rest.map((section) => {
          const id = sectionId(section.title);
          return (
            <section key={section.title} className="card-section" aria-labelledby={id}>
              <h2 id={id} className="sidebar-heading">
                {section.title}
              </h2>
              <ul className="cards" data-columns={cardColumns(section.docs.length)}>
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
    </>
  );
}
