import { ImageResponse } from 'next/og';

import { getDoc, getDocs } from '../../../lib/docs';
import { DocCard, OG_SIZE, ogFonts } from '../../../lib/og';

export const alt = 'The title and summary of a page in the ondocs documentation';
export const size = OG_SIZE;
export const contentType = 'image/png';

export async function generateStaticParams() {
  return (await getDocs()).map((doc) => ({ slug: doc.slug }));
}

/** A docs page's card: its section, title and description, from its frontmatter. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const doc = await getDoc((await params).slug);
  return new ImageResponse(
    <DocCard
      section={doc?.section ?? 'Documentation'}
      title={doc?.title ?? 'ondocs'}
      description={doc?.description ?? ''}
      path={`/docs/${doc?.slug ?? ''}`}
    />,
    { ...size, fonts: await ogFonts() },
  );
}
