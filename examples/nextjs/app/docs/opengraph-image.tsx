import { ImageResponse } from 'next/og';

import { DocCard, OG_SIZE, ogFonts } from '../../lib/og';
import { DOCS_DESCRIPTION } from '../../lib/site';

export const alt = 'The ondocs documentation, and what it covers';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** The docs home's card, in the docs pages' layout. */
export default async function Image() {
  return new ImageResponse(
    <DocCard
      section="Documentation"
      title="ondocs documentation"
      description={DOCS_DESCRIPTION}
      path="/docs"
    />,
    { ...size, fonts: await ogFonts() },
  );
}
