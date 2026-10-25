// The config module `ondocs index -c` builds with and `ondocs eval -c` embeds questions with.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AskConfig } from '../node';

/**
 * Imports the config module at `path`, relative to `cwd`. `fail` makes the error each command
 * reports a missing file or a module without a config object as.
 */
export async function loadConfigModule(
  path: string,
  cwd: string,
  fail: (message: string) => Error,
): Promise<AskConfig> {
  const absolute = resolve(cwd, path);
  if (!existsSync(absolute)) throw fail(`Config file not found: ${path}`);
  const module = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  const config = module.default;
  if (!config || typeof config !== 'object') {
    throw fail(`${path} must export a config object as its default export.`);
  }
  return config;
}
