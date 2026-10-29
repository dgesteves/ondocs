// The oldest `ai` of each major the peer range allows must work, and CI checks that it does: a
// site that already has an older ai keeps it when it installs ondocs, as it satisfies the range,
// while the other jobs run the lockfile's ai and the fresh sites the latest. ai 7.0.0 to 7.0.50
// crash the Docusaurus plugin's load under jiti (`Cannot read properties of undefined (reading
// 'discriminatedUnion')`, from @ai-sdk/gateway), and up to 7.0.91 the endpoint's `onAbort` gets no
// `reason`, which fails the typecheck. AI SDK 6 takes a timeout as `{ totalMs }`, which the
// endpoint's default sets, from 6.0.16; older releases take a number of milliseconds, or none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const peers = (JSON.parse(read('package.json')) as { peerDependencies: Record<string, string> })
  .peerDependencies;
const workflow = parse(read('.github/workflows/ci.yml')) as {
  jobs: Record<string, { steps: { run?: string }[] } | undefined>;
};

describe('the ai peer range', () => {
  it('starts AI SDK 7 at 7.0.95, after the releases that crash the Docusaurus plugin or fail to typecheck, and AI SDK 6 at 6.0.16', () => {
    expect(peers.ai).toBe('^6.0.16 || ^7.0.95');
  });

  const [floor6, floor7] = String(peers.ai)
    .split(' || ')
    .map((range) => range.replace(/^\^/, ''));
  const runs = (job: string) => (workflow.jobs[job]?.steps ?? []).map((step) => step.run ?? '');

  it('has its floor for 7 installed in CI, which then typechecks and runs the tests on it', () => {
    const install = runs('ai-floor').findIndex((run) => run.startsWith('pnpm add '));
    expect(install).toBeGreaterThan(runs('ai-floor').indexOf('pnpm install --frozen-lockfile'));
    expect(runs('ai-floor')[install]?.split(/\s+/)).toContain(`ai@${String(floor7)}`);
    expect(runs('ai-floor').slice(install + 1)).toEqual(
      expect.arrayContaining(['pnpm typecheck', 'pnpm test']),
    );
  });

  it('has the newest AI SDK 6 and then its floor installed in CI, with the tests, the CLI and the endpoint run on each', () => {
    const script = runs('ai-sdk-6').join('\n');
    // Newest first: `pnpm add ai@^6` keeps an older 6 that is already installed.
    const versions = /for versions in (.+); do/.exec(script)?.[1] ?? '';
    expect(versions.indexOf("'ai@^6 ")).toBeGreaterThanOrEqual(0);
    expect(versions.indexOf("'ai@^6 ")).toBeLessThan(versions.indexOf(`'ai@${String(floor6)} `));
    // Built before the loop, with the lockfile's AI SDK 7, as the package is published.
    expect(runs('ai-sdk-6').indexOf('pnpm build')).toBeGreaterThan(-1);
    expect(script.indexOf('pnpm build')).toBeLessThan(script.indexOf('for versions in'));
    for (const command of ['pnpm add -D -w $versions', 'pnpm test', 'node dist/cli.js index']) {
      expect(script).toContain(command);
    }
    expect(script).toContain('bun scripts/runtime-smoke.mjs');
  });

  it('is what Getting started’s Compatibility table gives, with the Node.js floor', () => {
    const page = read('examples/nextjs/content/docs/getting-started.md');
    const table = page.slice(page.indexOf('## Compatibility'));
    const row = (name: string) =>
      table.split('\n').find((line) => line.startsWith(`| ${name} `)) ?? '';
    expect(row('AI SDK')).toContain(
      `7 (\`ai@^${String(floor7)}\`) and 6 (\`ai@^${String(floor6)}\`)`,
    );
    const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines;
    expect(row('Node.js')).toContain(`${engines.node.replace(/^>=|\.0$/g, '')} or later`);
  });
});
