// The support tiers on the limits page, and the integration freeze in CONTRIBUTING.md that links
// them. Tier 1 is what CI builds or tests, or what someone ran by hand on a date a pull request
// records; Tier 2 is documented only. The docs used to give every site type, host, provider and
// MCP client the same standing, the tested ones and the ones nobody ran. So each Tier 1 row must
// cite its evidence, every fresh site and deploy recipe CI runs must be on the page, and no row
// may cite a CI run or a file that is not there.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const workflow = parse(read('.github/workflows/ci.yml')) as {
  jobs: Record<string, { strategy?: { matrix?: Record<string, string[]> } } | undefined>;
};
/** CI's matrix runs, as `job: entry`, the way the page cites them. */
const MATRIX = [
  ...(workflow.jobs.consumers?.strategy?.matrix?.site ?? []).map((site) => `consumers: ${site}`),
  ...(workflow.jobs.recipes?.strategy?.matrix?.recipe ?? []).map((recipe) => `recipes: ${recipe}`),
];

/** The text under `## Support tiers` on the limits page, up to the next `## ` heading. */
const tiers = (() => {
  const lines = read('examples/nextjs/content/docs/limits.md').split('\n');
  const start = lines.indexOf('## Support tiers');
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
})();

/** Each table row: the `### ` heading it is under, and its name, tier and evidence. */
const rows = (() => {
  let group = '';
  const found: { group: string; name: string; tier: string; evidence: string }[] = [];
  for (const line of tiers.split('\n')) {
    if (line.startsWith('### ')) group = line.slice(4);
    if (!line.startsWith('|')) continue;
    const [name = '', tier = '', evidence = ''] = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (tier === 'Tier' || /^-+$/.test(tier)) continue;
    found.push({ group, name, tier, evidence });
  }
  return found;
})();

const REPO = 'https://github.com/dgesteves/ondocs';
/** A CI run, test, script or workflow the evidence names. */
const CITES_CI = new RegExp(
  `\`(?:consumers|recipes): [a-z0-9-]+\`|\\]\\(${REPO}/blob/main/(?:test|scripts|\\.github/workflows)/`,
);
/** A check by hand: its date, then the pull request that records it. */
const CITES_A_DATED_CHECK = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b.*\\]\\(${REPO}/pull/\\d+\\)`);

describe('the support tiers', () => {
  it('are a section of the limits page, with a table for each kind of integration', () => {
    expect(tiers).not.toBe('');
    expect([...new Set(rows.map((row) => row.group))]).toEqual([
      'Site types',
      'Deploy targets',
      'Model providers',
      'MCP clients',
    ]);
  });

  it('put each row in tier 1 or 2, and cite the CI run, test or dated check behind each tier 1', () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      expect(['1', '2'], row.name).toContain(row.tier);
      if (row.tier !== '1') continue;
      const cited = CITES_CI.test(row.evidence) || CITES_A_DATED_CHECK.test(row.evidence);
      expect(cited, `${row.name} is tier 1 without evidence`).toBe(true);
    }
  });

  it('cite every fresh site and deploy recipe CI runs, and none it does not', () => {
    const cited = [...tiers.matchAll(/`((?:consumers|recipes): [a-z0-9-]+)`/g)].map(
      ([, run]) => run,
    );
    expect(MATRIX.length).toBeGreaterThan(10);
    expect([...new Set(cited)].sort()).toEqual([...MATRIX].sort());
  });

  it('link only files that exist', () => {
    const files = [...tiers.matchAll(new RegExp(`${REPO}/blob/main/([^)#\\s]+)`, 'g'))].map(
      ([, file = '']) => file,
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(existsSync(join(root, file)), file).toBe(true);
  });

  // CI builds a fresh Fumadocs and Nextra site on every run, so they are tier 1. Nothing runs the
  // other providers or the editors, whatever the README's badges show.
  it.each([
    ['Site types', 'Fumadocs', '1'],
    ['Site types', 'Nextra', '1'],
    ['Model providers', 'OpenAI', '1'],
    ['Model providers', 'Anthropic', '2'],
    ['Model providers', 'Google Gemini', '2'],
    ['Model providers', 'xAI Grok', '2'],
    ['MCP clients', 'Claude Code', '2'],
    ['MCP clients', 'Cursor', '2'],
    ['MCP clients', 'VS Code', '2'],
    ['MCP clients', 'ChatGPT', '2'],
  ])('put %s: %s in tier %s', (group, name, tier) => {
    expect(rows.find((row) => row.group === group && row.name === name)?.tier).toBe(tier);
  });

  // Each provider the model providers page has a section for, and each client the MCP page names.
  it.each([
    [
      'Model providers',
      ['OpenAI', 'Anthropic', 'Google Gemini', 'xAI Grok', 'Workers AI', 'AI Gateway'],
    ],
    [
      'MCP clients',
      ['Claude Code', 'Codex', 'Gemini CLI', 'Cursor', 'VS Code', 'ChatGPT', 'Claude'],
    ],
  ])('give a tier to each of the %s the docs name', (group, names) => {
    const listed = rows.filter((row) => row.group === group).map((row) => row.name);
    for (const name of names) {
      const has = listed.some(
        (row) => row === name || row.startsWith(`${name} (`) || row.startsWith(`${name},`),
      );
      expect(has, name).toBe(true);
    }
  });
});

describe('the integration freeze', () => {
  it('holds new integrations for four weeks after the launch unless an issue asks, and links the tiers', () => {
    const contributing = read('CONTRIBUTING.md');
    expect(contributing).toMatch(/^## New integrations$/m);
    // The launch was Thursday 2026-10-22: the freeze ends four weeks later, on the date it names.
    expect(contributing).toContain(
      'until Thursday 2026-11-19, four weeks after the public launch on 2026-10-22',
    );
    expect(contributing).toContain(`(${REPO}/issues/new?template=feature_request.yml)`);
    expect(existsSync(join(root, '.github/ISSUE_TEMPLATE/feature_request.yml'))).toBe(true);
    expect(contributing).toContain('](https://ondocs.vercel.app/docs/limits#support-tiers)');
  });
});
