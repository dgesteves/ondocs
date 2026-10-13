// The doc's metadata, with its canonical link on the website. Every doc here is generated from the
// website's page of the same name (scripts/sync-example-docs.mjs): /<slug> here, the introduction
// at /, is /docs/<slug> there.
import Head from '@docusaurus/Head';
import { useLocation } from '@docusaurus/router';
import Metadata from '@theme-original/DocItem/Metadata';
import type { ReactNode } from 'react';

export default function MetadataWithCanonical(): ReactNode {
  const slug = useLocation().pathname.replace(/^\/+|\/+$/g, '') || 'introduction';
  return (
    <>
      <Metadata />
      <Head>
        <link rel="canonical" href={`https://ondocs.vercel.app/docs/${slug}`} />
      </Head>
    </>
  );
}
