import pkg from 'ondocs/package.json';

/**
 * The published version, from the package at build time. Only server components import this:
 * the whole package.json comes with it, 2 KB gzipped that a client component would ship.
 */
export const VERSION: string = pkg.version;
