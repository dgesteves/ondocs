import { ImageResponse } from 'next/og';

import { getDoc, getDocs } from '../../../lib/docs';
import { Brand, COLORS, OG_SIZE, Spark, ogFonts } from '../../../lib/og';

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '64px 72px',
        fontFamily: 'Geist',
        color: COLORS.fg,
        background: `radial-gradient(900px 520px at 90% 0%, rgba(34, 211, 238, 0.14), rgba(13, 15, 18, 0) 70%), ${COLORS.ink}`,
      }}
    >
      <Brand suffix="docs" />
      <div
        style={{
          display: 'flex',
          marginTop: 72,
          fontFamily: 'Geist Mono',
          fontSize: 22,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: COLORS.cyan,
        }}
      >
        {doc?.section ?? 'Documentation'}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 18,
          fontSize: 76,
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: '-0.035em',
        }}
      >
        {doc?.title ?? 'ondocs'}
      </div>
      <div
        style={{
          display: 'flex',
          maxWidth: 940,
          marginTop: 24,
          fontSize: 30,
          lineHeight: 1.4,
          color: COLORS.muted,
        }}
      >
        {doc?.description ?? ''}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
          fontFamily: 'Geist Mono',
          fontSize: 20,
          color: COLORS.subtle,
        }}
      >
        <span>ondocs.vercel.app/docs/{doc?.slug ?? ''}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: COLORS.soft }}>
          <Spark size={20} />
          Ask these docs
        </span>
      </div>
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
