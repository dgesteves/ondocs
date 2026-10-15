// How CI gates main. The ruleset requires one check, ci-ok, which needs every other job in ci.yml,
// so a red fresh-site or deploy-recipe job blocks a merge as a red verify job does. Each push to
// main gets a full run of its own, and no job can hold a runner for the 360-minute default.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  steps: { run?: string; env?: Record<string, string> }[];
}

const root = join(import.meta.dirname, '..');
const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')) as {
  concurrency: { group: string; 'cancel-in-progress': boolean | string };
  jobs: Record<string, Job | undefined>;
};
const ok = workflow.jobs['ci-ok'];

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
  // fails, unless it runs always(). So ci-ok runs whatever the others did and fails itself.
  it.each([
    ['success success success', 0],
    ['success failure success', 1],
    ['success cancelled', 1],
    ['skipped success', 1],
  ])('passes only when every job it needs succeeded: %s', (results, status) => {
    const step = ok?.steps.find((s) => s.env?.RESULTS);
    expect(step?.env?.RESULTS).toBe("${{ join(needs.*.result, ' ') }}");
    // The shell GitHub runs `run:` with.
    const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step!.run!], {
      env: { ...process.env, RESULTS: results },
      encoding: 'utf8',
    });
    expect(run.status).toBe(status);
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
