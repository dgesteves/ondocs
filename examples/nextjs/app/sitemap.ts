import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { MetadataRoute } from 'next';

import { getDocs } from '../lib/docs';
import { SITE_URL } from '../lib/site';

const git = (args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The commits a shallow clone stops at, where every older file looks newly added. */
function shallowBoundary(): Set<string> {
  try {
    const file = git(['rev-parse', '--git-path', 'shallow']);
    return new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

/**
 * When the files last changed, from git: the sitemap's only freshness signal, as search engines
 * ignore `changefreq`. A page whose last change is past a shallow clone's
 * history, as CI and hosts clone, gets no date rather than a wrong one.
 */
function lastModified(boundary: Set<string>, ...paths: string[]): Date | undefined {
  try {
    const [sha, date] = git(['log', '-1', '--format=%H %cI', '--', ...paths]).split(' ');
    return sha && date && !boundary.has(sha) ? new Date(date) : undefined;
  } catch {
    return undefined;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await getDocs();
  const boundary = shallowBoundary();
  return [
    {
      url: SITE_URL,
      lastModified: lastModified(boundary, 'app/(home)', 'components/landing'),
      priority: 1,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified: lastModified(boundary, 'app/docs/page.tsx', 'content/docs'),
      priority: 0.8,
    },
    ...docs.map((doc) => ({
      url: `${SITE_URL}/docs/${doc.slug}`,
      lastModified: lastModified(boundary, `content/docs/${doc.slug}.md`),
      priority: doc.section === 'Get started' || doc.section === 'Integrations' ? 0.8 : 0.6,
    })),
  ];
}
