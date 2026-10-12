// scripts/consumer-site.mjs makes a fresh site for each framework, and the consumers job in
// .github/workflows/ci.yml runs it once for each site in its matrix, so the two lists must agree.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '..');
const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')) as {
  jobs: { consumers: { strategy: { matrix: { site: string[] } } } };
};

describe('the consumers job', () => {
  it('builds each site scripts/consumer-site.mjs makes, Fumadocs and Nextra included', () => {
    // Without arguments, the script prints its usage, which names its sites, and makes nothing.
    const usage = spawnSync(process.execPath, [join(root, 'scripts/consumer-site.mjs')], {
      encoding: 'utf8',
    });
    expect(usage.status).toBe(2);
    const sites = (/<([^>]+)>/.exec(usage.stderr)?.[1] ?? '').split('|').sort();
    expect([...workflow.jobs.consumers.strategy.matrix.site].sort()).toEqual(sites);
    expect(sites).toEqual([
      'docusaurus',
      'docusaurus-plugin-ondocs',
      'fumadocs',
      'next',
      'nextra',
      'starlight',
      'starlight-ondocs',
      'vitepress',
    ]);
  });
});
