import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { McpInstall } from '../../../components/mcp-install';
import { getDoc, getDocs } from '../../../lib/docs';
import { MCP_URL } from '../../../lib/site';

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getDocs()).map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata(props: PageProps<'/docs/[slug]'>): Promise<Metadata> {
  const doc = await getDoc((await props.params).slug);
  if (!doc) return {};
  const url = `/docs/${doc.slug}`;
  const title = `${doc.title} · ondocs`;
  return {
    title: doc.title,
    description: doc.description,
    // The page's Markdown copy, which `pnpm index` writes to public/docs/<slug>.md.
    alternates: { canonical: url, types: { 'text/markdown': `${url}.md` } },
    openGraph: {
      type: 'article',
      siteName: 'ondocs',
      title,
      description: doc.description,
      url,
    },
    twitter: { card: 'summary_large_image', title, description: doc.description },
  };
}

export default async function DocPage(props: PageProps<'/docs/[slug]'>) {
  const doc = await getDoc((await props.params).slug);
  if (!doc) notFound();
  const toc = doc.headings.filter((heading) => heading.depth === 2);
  return (
    <div className="doc-layout">
      <article className="doc">
        <p className="doc-section">{doc.section}</p>
        <h1>{doc.title}</h1>
        {doc.description ? <p className="lead">{doc.description}</p> : null}
        {/* This site's own server, ready to add, above the page that explains it. */}
        {doc.slug === 'mcp' ? <McpInstall url={MCP_URL} name="ondocs" /> : null}
        <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        {doc.previous || doc.next ? (
          <nav aria-label="Previous and next pages" className="pager">
            {doc.previous ? (
              <Link href={`/docs/${doc.previous.slug}`} className="pager-link" rel="prev">
                <span className="pager-kicker">Previous</span>
                <span className="pager-title">{doc.previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {doc.next ? (
              <Link href={`/docs/${doc.next.slug}`} className="pager-link pager-next" rel="next">
                <span className="pager-kicker">Next</span>
                <span className="pager-title">{doc.next.title}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>
      {toc.length > 0 ? (
        <nav aria-label="On this page" className="toc">
          <p className="sidebar-heading">On this page</p>
          <ul>
            {toc.map((heading) => (
              <li key={heading.id}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
