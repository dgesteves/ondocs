import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DocsBar, Toc } from '../../../components/docs-nav';
import { McpInstall } from '../../../components/mcp-install';
import { PageActions } from '../../../components/page-actions';
import { getDoc, getDocs, getNavSections } from '../../../lib/docs';
import { MCP_URL, editUrl } from '../../../lib/site';

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
  const [doc, sections] = await Promise.all([getDoc((await props.params).slug), getNavSections()]);
  if (!doc) notFound();
  const toc = doc.headings.filter((heading) => heading.depth === 2);
  return (
    <>
      <DocsBar sections={sections} headings={toc} />
      <div className={`doc-layout${toc.length > 0 ? '' : ' doc-layout-single'}`}>
        <article className="doc">
          <div className="doc-header">
            <p className="doc-section">{doc.section}</p>
            <PageActions slug={doc.slug} />
          </div>
          <h1>{doc.title}</h1>
          {doc.description ? <p className="lead">{doc.description}</p> : null}
          {/* This site's own server, ready to add, above the page that explains it. */}
          {doc.slug === 'mcp' ? <McpInstall url={MCP_URL} name="ondocs" /> : null}
          <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
          <footer className="doc-footer">
            <a href={editUrl(doc.slug)}>Edit this page on GitHub</a>
            {doc.updated ? (
              <p>
                Last updated{' '}
                <time dateTime={doc.updated.toISOString()}>
                  {doc.updated.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </time>
              </p>
            ) : null}
          </footer>
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
        {toc.length > 0 ? <Toc headings={toc} /> : null}
      </div>
    </>
  );
}
