// Sizes the landing page quotes, measured from the ondocs package as the site builds, so they
// always match what it ships. Server only: it reads the package's files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * A file of the package's build, gzipped at level 9, in KB of 1,024 bytes, as
 * scripts/js-weight.mjs and the docs count them: `embed.global.js` → "2.7 KB".
 */
export function gzippedSize(file: string): string {
  const path = join(process.cwd(), 'node_modules', 'ondocs', 'dist', file);
  const bytes = gzipSync(readFileSync(path), { level: 9 }).length;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
