// How CI gates main. The ruleset requires one check, ci-ok, which needs every other job in ci.yml,
// so a red fresh-site or deploy-recipe job blocks a merge as a red verify job does. Each push to
// main gets a full run of its own, and no job can hold a runner for the 360-minute default.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  'timeout-minutes'?: number;
  strategy?: { matrix?: Record<string, unknown> };
  steps: {
    shell?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
  }[];
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
      // jq on Windows ends its lines with CRLF.
      const stdout = run.stdout.replaceAll('\r\n', '\n');
      for (const [id, result] of Object.entries(results)) {
        expect(stdout).toContain(`${id}: ${result}\n`);
      }
      if (failed) expect(stdout).toContain(`::error::Did not succeed: ${failed}.`);
      else expect(stdout).not.toContain('::error::');
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

/** Every command a job runs, one step's `run` per entry. */
const runs = (id: string) =>
  (workflow.jobs[id]?.steps ?? []).flatMap((step) => (step.run ? [step.run] : []));
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const manifest = JSON.parse(read('package.json')) as {
  engines: { node: string };
  scripts: Record<string, string>;
  peerDependencies: Record<string, string>;
};

// What the docs and package.json promise, each with the job that runs it: the oldest Node.js the
// engines field allows, Windows, Bun and Deno, a browser that asks a question, coverage, pnpm's
// strict node_modules and the oldest peers.
describe('what CI runs for what ondocs claims', () => {
  it('tests on the oldest Node.js the engines field allows, and on Node 26', () => {
    const floor = /^>=(\d+\.\d+\.\d+)$/.exec(manifest.engines.node)?.[1];
    expect(floor).toBe('22.12.0');
    const compat = workflow.jobs['node-compat'];
    expect(compat?.strategy?.matrix?.node).toEqual([floor, 26]);
    // The exact version, not the newest 22, which setup-node would install for `22`.
    const setups = compat?.steps.filter((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(setups?.at(-1)?.with?.['node-version']).toBe('${{ matrix.node }}');
    expect(runs('node-compat').join('\n')).toContain('node node_modules/vitest/vitest.mjs run');
    expect(runs('node-compat').join('\n')).toContain('node dist/cli.js index');
  });

  it('runs the tests on Windows, and builds a fresh Docusaurus site there', () => {
    const windows = workflow.jobs.windows;
    expect(windows?.['runs-on']).toBe('windows-latest');
    // The tests, but a list of files that assume POSIX paths and tools, each one that exists.
    const tests = runs('windows').find((run) => run.startsWith('pnpm test'));
    const excluded = [...(tests ?? '').matchAll(/--exclude (\S+)/g)].map(([, file]) => file ?? '');
    expect(tests).toBe(['pnpm test', ...excluded.map((file) => `--exclude ${file}`)].join(' '));
    expect(excluded.length).toBeLessThanOrEqual(12);
    for (const file of excluded) expect(existsSync(join(root, file)), file).toBe(true);
    expect(runs('windows').join('\n')).toContain('node scripts/consumer-site.mjs docusaurus');
    // Checked out with LF line ends, as everywhere else.
    expect(runs('windows')[0]).toBe('git config --global core.autocrlf false');
  });

  // Getting started says the endpoint runs on Bun and Deno: a job asks it a question on each.
  it('asks the endpoint a question on Bun and on Deno, which Getting started names', () => {
    expect(read('examples/nextjs/content/docs/getting-started.md')).toMatch(
      /also runs on Bun, Deno and Cloudflare Workers, and CI asks it a question on each/,
    );
    const commands = runs('runtimes').join('\n');
    expect(commands).toContain('bun scripts/runtime-smoke.mjs');
    expect(commands).toMatch(
      /deno run [^\n]*--allow-sys=hostname[^\n]* scripts\/runtime-smoke\.mjs/,
    );
    const actions = workflow.jobs.runtimes?.steps.map((step) => step.uses?.split('@')[0]);
    expect(actions).toEqual(expect.arrayContaining(['oven-sh/setup-bun', 'denoland/setup-deno']));
  });

  it('asks a question on each demo in a browser, and opens a citation with Enter', () => {
    expect(runs('verify')).toContain(
      'node scripts/browser-ask.mjs docusaurus starlight vitepress embed',
    );
  });

  it('measures coverage of src/ against thresholds', () => {
    expect(runs('coverage')).toContain('pnpm test:coverage');
    expect(manifest.scripts['test:coverage']).toBe('vitest run --coverage');
    const config = read('vitest.config.ts');
    expect(config).toMatch(/include: \['src\/\*\*'\]/);
    const threshold = (name: string) =>
      Number(new RegExp(`${name}: (\\d+)`).exec(config)?.[1] ?? 0);
    expect(threshold('lines')).toBeGreaterThanOrEqual(90);
    expect(threshold('branches')).toBeGreaterThanOrEqual(85);
  });

  // pnpm gives a site only its direct dependencies; npm hoists the rest within reach.
  const include = (workflow.jobs.consumers?.strategy?.matrix?.include ?? []) as {
    site: string;
    flags: string;
  }[];
  it('builds the Starlight and plugin-package sites with pnpm too', () => {
    expect(include.filter((leg) => leg.flags === '--pm=pnpm').map((leg) => leg.site)).toEqual([
      'starlight',
      'starlight-ondocs',
      'docusaurus-plugin-ondocs',
    ]);
    expect(runs('consumers').join('\n')).toMatch(
      /consumer-site\.mjs .* \$\{\{ matrix\.flags \}\}$/m,
    );
  });

  // The floors in scripts/consumer-site.mjs are those of the peer ranges: Docusaurus 3.0.0, React
  // 18.3.0 and Starlight 0.32.0. Astro's is 5.1.5, the oldest that Starlight 0.32.0 takes.
  it('builds Docusaurus and Starlight sites on the oldest peers the ranges allow', () => {
    expect(include.filter((leg) => leg.flags === '--oldest-peers').map((leg) => leg.site)).toEqual([
      'docusaurus',
      'starlight',
    ]);
    const script = read('scripts/consumer-site.mjs');
    // A key as the script writes it: quoted, or bare when it is a plain name.
    const pinned = (name: string) =>
      new RegExp(`(?:'${name}'|\\b${name}): '([\\d.]+)'`).exec(script)?.[1];
    const floor = (name: string) =>
      /(\d+\.\d+\.\d+)/.exec(manifest.peerDependencies[name] ?? '')?.[1];
    for (const name of ['@docusaurus/core', 'react', 'react-dom', '@astrojs/starlight']) {
      expect(pinned(name), name).toBe(floor(name));
    }
    expect(floor('astro')).toBe('5.0.0');
    expect(pinned('astro')).toBe('5.1.5');
  });
});

describe('the real-site workflow', () => {
  /** .github/workflows/real-sites.yml, and its one job. */
  const load = () => {
    const realSites = parse(read('.github/workflows/real-sites.yml')) as {
      on: Record<string, unknown>;
      jobs: Record<string, Job | undefined>;
    };
    return { on: realSites.on, job: realSites.jobs.site };
  };

  // It clones other projects and runs their builds: by hand, weekly, and on a pull request that
  // changes it, never as a check ci-ok waits for.
  it('runs by hand, weekly, and on pull requests that change it', () => {
    const { on, job } = load();
    expect(Object.keys(on).sort()).toEqual(['pull_request', 'schedule', 'workflow_dispatch']);
    expect(on.pull_request).toEqual({
      paths: ['.github/workflows/real-sites.yml', 'scripts/real-sites.mjs'],
    });
    expect(job?.['timeout-minutes']).toBeLessThanOrEqual(30);
    const checkout = job?.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('builds each site scripts/real-sites.mjs knows, each at a pinned commit', () => {
    const { job } = load();
    const usage = spawnSync(process.execPath, [join(root, 'scripts/real-sites.mjs')], {
      encoding: 'utf8',
    });
    expect(usage.status).toBe(2);
    const sites = (/<([^>]+)>/.exec(usage.stderr)?.[1] ?? '').split('|');
    expect(sites).toEqual(['starlight', 'vitest', 'typescript-eslint', 'jest']);
    expect(job?.strategy?.matrix?.site).toEqual(sites);
    const commits = [...read('scripts/real-sites.mjs').matchAll(/commit: '([^']*)'/g)];
    expect(commits.map(([, commit]) => commit)).toHaveLength(sites.length);
    for (const [, commit] of commits) expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('the scripts that start servers', () => {
  // A port picked as free can be taken before wrangler's workerd binds it ("Address already in
  // use", once on CI): each wrangler dev server gets its inspector a port too, and one more try.
  it('start every wrangler dev server through serveWrangler, with an inspector port', () => {
    const script = read('scripts/deploy-recipes.mjs');
    expect(script).not.toMatch(/serve\(\s*'npx',\s*\[\s*(?:'-y',\s*VERSIONS\.wrangler|'wrangler')/);
    expect(script.match(/await serveWrangler\(/g)).toHaveLength(4);
    expect(script).toContain("'--inspector-port'");
  });

  // js-weight.mjs started Next.js on a random port from 3100 to 3599, which another server on a
  // shared machine can hold.
  it('give js-weight.mjs the Next.js port with --port or JS_WEIGHT_PORT, or a free one', () => {
    expect(read('scripts/js-weight.mjs')).not.toMatch(/3100/);
    const result = spawnSync(process.execPath, [join(root, 'scripts/js-weight.mjs'), 'next'], {
      encoding: 'utf8',
      env: { ...process.env, JS_WEIGHT_PORT: 'next' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--port and JS_WEIGHT_PORT take a port number, not "next"');
  });
});
