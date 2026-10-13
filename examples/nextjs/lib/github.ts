import { GITHUB_REPO } from './site';

/** Below this, the header shows the GitHub icon alone: a count that small says nothing. */
export const MIN_STARS = 10;

let stars: Promise<number | null> | undefined;

/**
 * The repository's star count, read once per build process from GitHub's API without a token.
 * The pages are prerendered, so it is the count when the site was built. Null when the request
 * fails or times out: the build never waits on GitHub for long, and never fails because of it.
 *
 * Each build asks GitHub again (`no-store`). Next.js would otherwise keep the response in its
 * data cache for a year, which hosts carry from one build to the next (Vercel restores
 * `.next/cache`), so every later build would show the first count. A revalidate time would
 * instead regenerate every page on the server once a day, where there is no git history for the
 * docs' Last updated dates. The root layout keeps the pages static, which no-store alone doesn't.
 */
export function githubStars(): Promise<number | null> {
  stars ??= fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
    headers: { accept: 'application/vnd.github+json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as { stargazers_count?: unknown };
      return typeof data.stargazers_count === 'number' ? data.stargazers_count : null;
    })
    .catch(() => null);
  return stars;
}

/** "42", "1.2k": the count as the header shows it, or null under `MIN_STARS` or when unknown. */
export function starLabel(count: number | null): string | null {
  if (count === null || count < MIN_STARS) return null;
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? String(Math.floor(thousands * 10) / 10) : String(Math.floor(thousands))}k`;
}
