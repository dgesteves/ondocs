import { execFileSync } from 'node:child_process';

// Run in the build's working directory, which relative paths are from.
const git = (args: string[]): string =>
  execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

let shallow: boolean | undefined;

/**
 * When the files last changed, from git, at build time. A shallow clone, as CI and hosts clone,
 * stops at commits whose parents it doesn't have, where every older file looks newly added: a
 * file whose last change is one of those gets no date rather than a wrong one, and so does a
 * build without git. Git answers both questions: reading its files by a path only known at run
 * time would make Next.js trace, and deploy, the whole project with each route that dates pages.
 */
export function lastModified(...paths: string[]): Date | undefined {
  try {
    const [sha, date, parents] = git(['log', '-1', '--format=%H %cI %P', '--', ...paths]).split(
      ' ',
    );
    if (!sha || !date) return undefined;
    shallow ??= git(['rev-parse', '--is-shallow-repository']) === 'true';
    return shallow && !parents ? undefined : new Date(date);
  } catch {
    return undefined;
  }
}
