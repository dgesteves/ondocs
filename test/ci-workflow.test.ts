// How CI gates main. The ruleset requires one check, ci-ok, which needs every other job in ci.yml,
// so a red fresh-site or deploy-recipe job blocks a merge as a red verify job does. Each push to
// main gets a full run of its own, and no job can hold a runner for the 360-minute default.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  steps: { shell?: string; run?: string; env?: Record<string, string> }[];
}

const root = join(import.meta.dirname, '..');
const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')) as {
  concurrency: { group: string; 'cancel-in-progress': boolean | string };
  jobs: Record<string, Job | undefined>;
};
const ok = workflow.jobs['ci-ok'];
// The ci-ok step reads its jobs' results with jq, which GitHub's Ubuntu runners have. CI always
// runs these cases; a machine without jq skips them.
const jq = spawnSync('jq', ['--version']).status === 0;

describe('CI', () => {
  // The ruleset names the check, so a renamed job would drop the requirement without a word.
  it('ends with a ci-ok job that waits for every other job, whatever their results', () => {
    expect(ok?.name).toBe('ci-ok');
    expect(ok?.if).toBe('always()');
    expect([ok?.needs ?? []].flat().sort()).toEqual(
      Object.keys(workflow.jobs)
        .filter((id) => id !== 'ci-ok')
        .sort(),
    );
  });

  // A required check that is skipped counts as passed, and a job is skipped when one it needs
  // fails, unless it runs always(). So ci-ok runs whatever the others did and fails itself, and its
  // log names each job that did not succeed.
  const step = ok?.steps.find((s) => s.env?.NEEDS);
  it('reads every result it needs, in bash with pipefail', () => {
    expect(step?.env?.NEEDS).toBe('${{ toJSON(needs) }}');
    // With shell: bash, GitHub runs the step as `bash --noprofile --norc -e -o pipefail {0}`.
    // Without it, it would be `bash -e {0}`, with no pipefail.
    expect(step?.shell).toBe('bash');
  });

  it.skipIf(!jq && !process.env.CI).each([
    ['all succeeded', { verify: 'success', consumers: 'success', recipes: 'success' }, ''],
    [
      'one failed',
      { verify: 'success', consumers: 'failure', recipes: 'success' },
      'consumers (failure)',
    ],
    ['one was cancelled', { verify: 'cancelled', consumers: 'success' }, 'verify (cancelled)'],
    [
      'one was skipped, one failed',
      { verify: 'skipped', consumers: 'failure' },
      'verify (skipped), consumers (failure)',
    ],
    ['no results at all', {}, ''],
  ])('passes only when every job it needs succeeded: %s', (_, results, failed) => {
    const needs = Object.fromEntries(
      Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }]),
    );
    const dir = mkdtempSync(join(tmpdir(), 'ci-ok-'));
    try {
      const script = join(dir, 'step.sh');
      writeFileSync(script, step!.run!);
      const run = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
        env: { ...process.env, NEEDS: JSON.stringify(needs, null, 2) },
        encoding: 'utf8',
      });
      const succeeded = Object.keys(results).length > 0 && !failed;
      expect(run.status).toBe(succeeded ? 0 : 1);
      for (const [id, result] of Object.entries(results)) {
        expect(run.stdout).toContain(`${id}: ${result}\n`);
      }
      if (failed) expect(run.stdout).toContain(`::error::Did not succeed: ${failed}.`);
      else expect(run.stdout).not.toContain('::error::');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A newer run replaces an older one on a pull request's branch, and on the release pull
  // request's, whose runs release.yml starts with workflow_dispatch. A push to main is never
  // replaced: in a shared group, even a run waiting its turn gives way to the next push, so each
  // push gets a group of its own.
  it('cancels superseded runs, except on pushes to main', () => {
    expect(workflow.concurrency).toEqual({
      group: "ci-${{ github.event_name == 'push' && github.sha || github.ref }}",
      'cancel-in-progress': "${{ github.event_name != 'push' }}",
    });
  });

  // The deploy recipes start wrangler, netlify and next servers; a hung one would otherwise
  // hold its runner for 6 hours.
  it.each(Object.keys(workflow.jobs))('gives the %s job a timeout', (id) => {
    const minutes = workflow.jobs[id]?.['timeout-minutes'];
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(20);
  });
});

describe('the supply chain', () => {
  // Dependabot's alerts missed every locked package (test/dependency-graph.test.ts), so CI audits the
  // lockfile itself. pnpm counts the examples' dependencies and the peers it installs as production;
  // pnpm-workspace.yaml holds the overrides and the advisories it skips.
  it('fails CI on a high or critical advisory in a production dependency, and reports the rest', () => {
    const audit = workflow.jobs.audit;
    expect([ok?.needs].flat()).toContain('audit');
    const gate = audit?.steps.find(
      (step) => step.run?.trim() === 'pnpm audit --prod --audit-level=high',
    );
    expect(gate).toBeDefined();
    expect(gate).not.toHaveProperty('continue-on-error');
    // The full report, dev dependencies included, goes to the run's summary and fails nothing.
    const report = audit?.steps.find((step) => step.run?.includes('GITHUB_STEP_SUMMARY'));
    expect(report?.run).toContain('pnpm audit || true');
  });

  // A tag can be moved to other code; a commit can't. Dependabot's github-actions updates move the
  // SHA and the comment together.
  const workflows = readdirSync(join(root, '.github/workflows')).filter((file) =>
    file.endsWith('.yml'),
  );
  it.each(workflows)('pins every action in %s to a full commit SHA, with its version', (file) => {
    const source = readFileSync(join(root, '.github/workflows', file), 'utf8');
    const uses = [...source.matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map((match) => match[1] ?? '');
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses)
      expect(line).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});
