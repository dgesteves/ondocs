import type { MetadataRoute } from 'next';

import { INTEGRATIONS_SECTION, getDocs } from '../lib/docs';
import { lastModified } from '../lib/git';
import { SITE_URL } from '../lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await getDocs();
  return [
    {
      url: SITE_URL,
      lastModified: lastModified('app/(home)', 'components/landing'),
      priority: 1,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified: lastModified('app/docs/page.tsx', 'content/docs'),
      priority: 0.8,
    },
    ...docs.map((doc) => ({
      url: `${SITE_URL}/docs/${doc.slug}`,
      lastModified: lastModified(`content/docs/${doc.slug}.md`),
      priority: doc.section === 'Get started' || doc.section === INTEGRATIONS_SECTION ? 0.8 : 0.6,
    })),
  ];
}
