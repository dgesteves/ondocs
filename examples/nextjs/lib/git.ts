import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Run in the build's working directory, which relative paths are from.
const git = (args: string[]): string =>
  execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

let boundary: Set<string> | undefined;

/** The commits a shallow clone stops at, where every older file looks newly added. */
function shallowBoundary(): Set<string> {
  if (boundary) return boundary;
  try {
    const file = path.resolve(process.cwd(), git(['rev-parse', '--git-path', 'shallow']));
    boundary = new Set(
      existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [],
    );
  } catch {
    boundary = new Set();
  }
  return boundary;
}

/**
 * When the files last changed, from git, at build time. A file whose last change is past a
 * shallow clone's history, as CI and hosts clone, gets no date rather than a wrong one, and so
 * does a build without git.
 */
export function lastModified(...paths: string[]): Date | undefined {
  try {
    const [sha, date] = git(['log', '-1', '--format=%H %cI', '--', ...paths]).split(' ');
    return sha && date && !shallowBoundary().has(sha) ? new Date(date) : undefined;
  } catch {
    return undefined;
  }
}
