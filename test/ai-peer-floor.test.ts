// The oldest `ai` the peer range allows must work, and CI checks that it does: a site that already
// has an older ai 7 keeps it when it installs ondocs, as it satisfies the range, while the other
// jobs run the lockfile's ai and the fresh sites the latest. ai 7.0.0 to 7.0.50 crash the
// Docusaurus plugin's load under jiti (`Cannot read properties of undefined (reading
// 'discriminatedUnion')`, from @ai-sdk/gateway), and up to 7.0.91 the endpoint's `onAbort` gets no
// `reason`, which fails the typecheck.
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
  it('starts at ai 7.0.95, after the releases that crash the Docusaurus plugin or fail to typecheck', () => {
    expect(peers.ai).toBe('^7.0.95');
  });

  it('has its floor installed in CI, which then typechecks and runs the tests on it', () => {
    const runs = (workflow.jobs['ai-floor']?.steps ?? []).map((step) => step.run ?? '');
    const install = runs.findIndex((run) => run.startsWith('pnpm add '));
    expect(install).toBeGreaterThan(runs.indexOf('pnpm install --frozen-lockfile'));
    expect(runs[install]?.split(/\s+/)).toContain(`ai@${String(peers.ai).replace(/^\^/, '')}`);
    expect(runs.slice(install + 1)).toEqual(
      expect.arrayContaining(['pnpm typecheck', 'pnpm test']),
    );
  });
});
