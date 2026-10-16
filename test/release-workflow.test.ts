// How .github/workflows/release.yml versions, publishes and checks a release. Only its release job
// can write or publish, it runs no tests or example builds, and it runs only on a push; a dry run,
// started by hand, runs a read-only job in its place. The `if` conditions here are evaluated as
// GitHub would, for each kind of run.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string | boolean>;
  env?: Record<string, string>;
}

interface Job {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
  'timeout-minutes'?: number;
}

const root = join(import.meta.dirname, '..');
const source = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const workflow = parse(source) as {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job | undefined>;
};
const jobs = workflow.jobs;
const scripts = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const steps = Object.values(jobs).flatMap((job) => job?.steps ?? []);
const changesets = steps.find((step) => step.uses?.startsWith('changesets/action@'));
const release = jobs.release;
const dryRun = jobs['dry-run'];
const published = jobs.published;

/**
 * Whether GitHub runs a step or job with this `if`, given the values of the contexts it reads
 * (`github.event_name`, `steps.changesets.outputs.published`...). A context with no value is ''.
 * A condition with no status function runs when everything before it succeeded, as here.
 */
function runs(condition: string | undefined, values: Record<string, string>): boolean {
  if (condition === undefined) return true;
  const expression = condition
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/\b(?:cancelled|failure)\(\)/g, 'false')
    .replace(/\b(?:always|success)\(\)/g, 'true')
    .replace(/\b(?:github|steps|env|vars|needs|secrets)(?:\.[\w-]+)+/g, (path) =>
      JSON.stringify(values[path] ?? ''),
    )
    .replace(/==/g, '===');
  return Boolean(runInNewContext(expression));
}

/** An env value such as `${{ github.event_name != 'push' }}`, as the string GitHub gives a step. */
function envValue(value: string, values: Record<string, string>): string {
  return /^\$\{\{.*\}\}$/.test(value) ? String(runs(value, values)) : value;
}

/**
 * The steps of `job` that run, in order: a step's outputs (from `outputs`, by step id) exist only
 * when it runs, as on GitHub.
 */
function simulate(
  job: Job | undefined,
  values: Record<string, string>,
  outputs: Record<string, Record<string, string>> = {},
): Step[] {
  const context = { ...values };
  for (const [name, value] of Object.entries(job?.env ?? {})) {
    context[`env.${name}`] = envValue(value, context);
  }
  const ran: Step[] = [];
  for (const step of job?.steps ?? []) {
    if (!runs(step.if, context)) continue;
    ran.push(step);
    for (const [name, value] of Object.entries((step.id && outputs[step.id]) || {})) {
      context[`steps.${step.id ?? ''}.outputs.${name}`] = value;
    }
  }
  return ran;
}

/** Whether a step can change something outside the runner: npm, the repository or jsDelivr. */
function writes(step: Step): boolean {
  if (step.uses?.startsWith('changesets/action@')) return true;
  const run = step.run ?? '';
  if (
    /gh (pr merge|workflow run|release create)|git push|changeset publish|npm publish/.test(run)
  ) {
    return true;
  }
  return /check-published\.mjs (release|jsdelivr)(?! --dry-run)/.test(run);
}

const label = (step: Step) => step.name ?? step.run ?? step.uses ?? '';

describe('release workflow', () => {
  // changesets/action splits these on spaces and runs them without a shell, so `&&` or a pipe
  // reaches the command as an argument and the release pull request never updates.
  it.each(['version-script', 'publish-script'])('runs %s as one package.json script', (input) => {
    const command = changesets?.with?.[input];
    expect(command).toMatch(/^pnpm [\w:-]+$/);
    expect(scripts[String(command).slice('pnpm '.length)]).toBeDefined();
  });

  // The validate job builds the four examples; a hung build would otherwise hold its runner for 6
  // hours, as ci.yml's jobs are kept from doing. The release and check jobs wait for npm and
  // jsDelivr, so theirs are longer.
  it.each(Object.keys(jobs))('gives the %s job a timeout', (id) => {
    const minutes = jobs[id]?.['timeout-minutes'];
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  // The release step waits up to about 10 minutes for npm after a publish (NPM_TRIES), after an
  // install and a build; the check job waits about 10 for npm, then about 5 for jsDelivr.
  it('leaves the release and check jobs time to wait for npm and jsDelivr', () => {
    expect(release?.['timeout-minutes']).toBeGreaterThanOrEqual(20);
    expect(published?.['timeout-minutes']).toBeGreaterThanOrEqual(25);
  });

  // Without the pins, the release pull request fails test/package.test.ts: its version is the next
  // minor, and the docs' script tags are still at the last one.
  it('moves the Worker template and the docs’ jsDelivr pins when it versions the packages', () => {
    expect(scripts['version-packages']).toBe(
      'changeset version && node scripts/sync-template.mjs && node scripts/sync-cdn-range.mjs',
    );
  });
});

describe('who holds which token', () => {
  // Every step of a job with id-token: write can mint the OIDC token npm trusted publishing
  // accepts, so a dependency's build or test code that ran there could publish with provenance.
  it('grants nothing at the workflow level, so each job asks for its own permissions', () => {
    expect(workflow.permissions).toEqual({});
    for (const [id, job] of Object.entries(jobs)) expect(job?.permissions, id).toBeDefined();
  });

  it('runs pnpm validate in a job that can only read, before the release job', () => {
    const validate = Object.entries(jobs).find(([, job]) =>
      job?.steps.some((step) => step.run === 'pnpm validate'),
    );
    expect(validate?.[1]?.permissions).toEqual({ contents: 'read' });
    expect([release?.needs].flat()).toEqual([validate?.[0]]);
  });

  it('lets only the release job publish, and it runs no tests or example builds', () => {
    const publishers = Object.entries(jobs).filter(([, job]) => job?.permissions?.['id-token']);
    expect(publishers.map(([id]) => id)).toEqual(['release']);
    expect(release?.permissions?.['id-token']).toBe('write');
    const runsInRelease = release?.steps.map((step) => step.run ?? '') ?? [];
    for (const command of runsInRelease) {
      expect(command).not.toMatch(/pnpm (validate|test|lint|example)|vitest|corpus/);
    }
    expect(runsInRelease).toContain('pnpm build');
  });

  // The validate job runs the dependencies' test and build code, and setup-node saves the pnpm
  // store after it: a package that ran there could leave files for the release job to install.
  it('restores no cache in the release job', () => {
    const cached = release?.steps.filter(
      (step) => step.uses?.startsWith('actions/cache') === true || step.with?.cache !== undefined,
    );
    expect(cached?.map(label)).toEqual([]);
  });

  it('runs the release job only on a push, and the dry run only in its place', () => {
    const on = (event: string) => ({
      'github.repository': 'dgesteves/ondocs',
      'github.event_name': event,
    });
    expect(runs(release?.if, on('push'))).toBe(true);
    expect(runs(release?.if, on('workflow_dispatch'))).toBe(false);
    expect(runs(dryRun?.if, on('push'))).toBe(false);
    expect(runs(dryRun?.if, on('workflow_dispatch'))).toBe(true);
  });

  // The dry run versions and packs (scripts that run the built CLI and npm's lifecycle scripts)
  // with nothing that could write, publish or push.
  it('gives the dry-run job read permissions, and the App a read-only token there', () => {
    expect(dryRun?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    const app = dryRun?.steps.find((step) =>
      step.uses?.startsWith('actions/create-github-app-token@'),
    );
    expect(app?.with).toMatchObject({
      'permission-contents': 'read',
      'permission-pull-requests': 'read',
    });
    expect(Object.values(app?.with ?? {})).not.toContain('write');
  });

  it('checks what npm and jsDelivr serve in a job that cannot write', () => {
    expect([published?.needs].flat()).toEqual(['release', 'dry-run']);
    expect(published?.permissions).toEqual({ contents: 'read' });
    const commands = published?.steps.map((step) => step.run ?? '').join('\n');
    expect(commands).toContain('node scripts/check-published.mjs npm');
    expect(commands).toContain('node scripts/check-published.mjs jsdelivr');
    expect(commands).toContain('node scripts/check-doc-imports.mjs --npm');
  });

  // actions/checkout otherwise leaves the job's token in .git/config, for every later step.
  it('keeps no credentials in any checkout', () => {
    const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts).toHaveLength(Object.keys(jobs).length);
    for (const step of checkouts) expect(step.with?.['persist-credentials']).toBe(false);
  });

  // A tag can be moved to other code; a commit can't. Dependabot's github-actions updates move the
  // SHA and the comment together.
  it('pins every action to a full commit SHA, with its version in a comment', () => {
    const uses = [...source.matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map((match) => match[1] ?? '');
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses)
      expect(line).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});

describe('the release GitHub App', () => {
  const app = release?.steps.find((step) =>
    step.uses?.startsWith('actions/create-github-app-token@'),
  );

  // A push made with the workflow's own token starts no workflows, so the release pull request
  // got no CI and needed an empty commit by hand before it could merge.
  it('mints a token from the App when both its secrets are set', () => {
    expect(release?.env?.HAS_APP).toBe(
      "${{ secrets.RELEASE_APP_ID != '' && secrets.RELEASE_APP_PRIVATE_KEY != '' }}",
    );
    expect(app?.if).toBe("env.HAS_APP == 'true'");
    expect(app?.with).toMatchObject({
      'client-id': '${{ secrets.RELEASE_APP_ID }}',
      'private-key': '${{ secrets.RELEASE_APP_PRIVATE_KEY }}',
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
    });
  });

  it('gives changesets/action the App’s token, or the workflow’s own without the App', () => {
    expect(app?.id).toBe('app-token');
    expect(changesets?.with?.['github-token']).toBe(
      '${{ steps.app-token.outputs.token || github.token }}',
    );
  });

  const versionRun = (hasApp: boolean, autoMerge = false) =>
    simulate(
      release,
      {
        'github.event_name': 'push',
        'secrets.RELEASE_APP_ID': hasApp ? 'id' : '',
        'secrets.RELEASE_APP_PRIVATE_KEY': hasApp ? 'key' : '',
        'vars.RELEASE_AUTO_MERGE': autoMerge ? 'true' : '',
      },
      {
        'app-token': { token: 'app token' },
        changesets: { 'has-changesets': 'true', 'pr-number': '120', published: 'false' },
      },
    ).map(label);

  it('starts CI on the release pull request itself only without the App', () => {
    expect(versionRun(false)).toContain('Run CI on the release pull request');
    expect(versionRun(false)).not.toContain('Get a token from the release GitHub App');
    expect(versionRun(true)).toContain('Get a token from the release GitHub App');
    expect(versionRun(true)).not.toContain('Run CI on the release pull request');
  });

  it('merges the release pull request by itself only when RELEASE_AUTO_MERGE says so', () => {
    const merge = 'Merge the release pull request once its CI passes';
    expect(versionRun(true)).not.toContain(merge);
    expect(versionRun(false, true)).not.toContain(merge);
    expect(versionRun(true, true)).toContain(merge);
  });
});

describe('a publish', () => {
  const publishRun = (results: Record<string, string>) =>
    simulate(
      release,
      { 'github.event_name': 'push' },
      { changesets: { 'has-changesets': 'false', ...results } },
    ).map(label);
  // On a push, the dry-run job is skipped.
  const checks = (values: Record<string, string>) => {
    const context = {
      'github.repository': 'dgesteves/ondocs',
      'github.event_name': 'push',
      'needs.dry-run.result': 'skipped',
      ...values,
    };
    return runs(published?.if, context) ? simulate(published, context) : [];
  };

  // changesets/action made a GitHub release for each package, three per version, and the
  // releases page opened on a plugin's "Updated dependencies".
  it('creates one GitHub release per version, for ondocs, from its own step', () => {
    expect(changesets?.with?.['create-github-releases']).toBe(false);
    expect(changesets?.with?.['push-git-tags']).toBeUndefined();
    const step = release?.steps.find((s) => s.run === 'node scripts/check-published.mjs release');
    expect(step?.env?.GH_TOKEN).toBe('${{ steps.app-token.outputs.token || github.token }}');
    expect(publishRun({ published: 'true' })).toContain('Create the GitHub release, for ondocs');
  });

  // npm served ondocs@0.10.0 about 3 minutes after the publish: a single read right after it
  // would have found nothing, and made no release on a green run. The step waits when the
  // packages this run published, as changesets/action lists them, include ondocs.
  it('tells the release step what this run published, so it waits for npm', () => {
    const step = release?.steps.find((s) => s.run === 'node scripts/check-published.mjs release');
    expect(step?.env?.PUBLISHED_PACKAGES).toBe(
      '${{ steps.changesets.outputs.published-packages }}',
    );
  });

  // If the tag or the release failed, a re-run publishes nothing (published is false), so the
  // step can't wait for published == 'true'.
  it('creates a missing release on a re-run that publishes nothing new', () => {
    expect(publishRun({ published: 'false' })).toContain('Create the GitHub release, for ondocs');
  });

  it('checks the registry, the docs’ imports and jsDelivr after a publish', () => {
    const ran = checks({
      'needs.release.outputs.published': 'true',
      'needs.release.result': 'success',
    });
    expect(ran.map((step) => step.run).filter(Boolean)).toEqual([
      'node scripts/check-published.mjs npm',
      `node scripts/check-doc-imports.mjs --npm "ondocs@$(node -p "require('./package.json').version")"`,
      expect.stringContaining('node scripts/check-published.mjs jsdelivr'),
    ]);
  });

  // changesets/action fails when one package fails to publish, after the others are on npm: the
  // checks then name what is missing.
  it('still checks after a publish that half failed', () => {
    const ran = checks({
      'needs.release.outputs.published': 'true',
      'needs.release.result': 'failure',
    });
    expect(ran.map((step) => step.run)).toContain('node scripts/check-published.mjs npm');
  });

  it('only warns about docs ahead of npm on a push that publishes nothing', () => {
    const ran = checks({
      'needs.release.outputs.published': 'false',
      'needs.release.result': 'success',
    });
    expect(ran.map((step) => step.run).filter(Boolean)).toEqual([
      'node scripts/check-doc-imports.mjs --npm ondocs@latest --warn',
    ]);
    expect(checks({ 'needs.release.result': 'skipped' })).toEqual([]);
  });
});

describe('a dry run', () => {
  const dispatch = { 'github.event_name': 'workflow_dispatch' };

  it('starts by hand, on any branch', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(workflow.on.workflow_dispatch).toBeNull();
  });

  it('runs no step that publishes, pushes or creates anything, with or without the App', () => {
    for (const hasApp of [false, true]) {
      const values = {
        ...dispatch,
        'github.repository': 'dgesteves/ondocs',
        'secrets.RELEASE_APP_ID': hasApp ? 'id' : '',
        'secrets.RELEASE_APP_PRIVATE_KEY': hasApp ? 'key' : '',
        'vars.RELEASE_AUTO_MERGE': 'true',
      };
      expect(runs(release?.if, values)).toBe(false);
      expect(runs(dryRun?.if, values)).toBe(true);
      const ran = simulate(dryRun, values, {
        'app-token': { token: 'app token' },
        pending: { count: '3' },
      });
      expect(ran.filter(writes).map(label)).toEqual([]);
      expect(ran.some((step) => step.uses?.startsWith('changesets/action@'))).toBe(false);
      expect(ran.map(label)).toEqual(
        expect.arrayContaining([
          'pnpm build',
          'Dry run: version the packages as the release pull request would, without pushing',
          'Dry run: pack the three packages as changeset publish would, without publishing',
          'Dry run: the GitHub release this version would get',
        ]),
      );
      expect(ran.map(label).includes('Get a read-only token from the release GitHub App')).toBe(
        hasApp,
      );
    }
  });

  it('runs every check after it, reading only', () => {
    const values = {
      ...dispatch,
      'github.repository': 'dgesteves/ondocs',
      'needs.release.result': 'skipped',
      'needs.dry-run.result': 'success',
    };
    expect(runs(published?.if, values)).toBe(true);
    const ran = simulate(published, values);
    expect(ran.map((step) => step.run).filter(Boolean)).toEqual([
      'node scripts/check-published.mjs npm',
      'node scripts/check-doc-imports.mjs --npm ondocs@latest --warn',
      expect.stringContaining('node scripts/check-published.mjs jsdelivr'),
    ]);
  });

  // The jsDelivr step's script, run in bash with a stand-in for node that prints its arguments.
  it.each([
    ['true', 'scripts/check-published.mjs jsdelivr --dry-run'],
    ['false', 'scripts/check-published.mjs jsdelivr'],
  ])('purges jsDelivr only outside a dry run (DRY_RUN=%s)', (dryRun, expected) => {
    const step = published?.steps.find((s) => s.run?.includes('check-published.mjs jsdelivr'));
    const dir = mkdtempSync(join(tmpdir(), 'release-step-'));
    try {
      writeFileSync(join(dir, 'node'), '#!/bin/sh\necho "$*"\n');
      chmodSync(join(dir, 'node'), 0o755);
      writeFileSync(join(dir, 'step.sh'), step!.run!);
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', join(dir, 'step.sh')], {
        env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, DRY_RUN: dryRun },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs no check when the dry run did not run', () => {
    const values = {
      ...dispatch,
      'github.repository': 'dgesteves/ondocs',
      'needs.release.result': 'skipped',
      'needs.dry-run.result': 'skipped',
    };
    expect(runs(published?.if, values)).toBe(false);
  });

  it('keeps the version commit in the runner', () => {
    const version = dryRun?.steps.find((s) => s.name?.startsWith('Dry run: version'));
    expect(version?.run).toContain('pnpm version-packages');
    expect(version?.run).not.toMatch(/git (commit|push)/);
  });

  // The step that counts the pending changesets, run in bash in a checkout whose .changeset holds
  // `files`, with the real node; returns what it printed and the outputs it wrote.
  function findPending(files: string[]) {
    const step = dryRun?.steps.find((s) => s.id === 'pending');
    const dir = mkdtempSync(join(tmpdir(), 'release-pending-'));
    try {
      mkdirSync(join(dir, '.changeset'));
      for (const file of files) writeFileSync(join(dir, '.changeset', file), '---\n---\n');
      writeFileSync(join(dir, 'package.json'), '{ "name": "ondocs", "version": "0.11.0" }\n');
      writeFileSync(join(dir, 'step.sh'), step!.run!);
      const output = join(dir, 'github-output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', join(dir, 'step.sh')], {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
      });
      const outputs = Object.fromEntries(
        readFileSync(output, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
      ) as Record<string, string>;
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, outputs };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const dryRunSteps = (outputs: Record<string, string>) =>
    simulate(dryRun, { ...dispatch, 'github.repository': 'dgesteves/ondocs' }, { pending: outputs })
      .map(label)
      .filter((name) => name.startsWith('Dry run: '));

  // Right after a release .changeset holds only its README and config, and `changeset version`
  // exits 1 ('No unreleased changesets found.'): the dry run failed there, before it packed.
  it('skips only the version step when no changeset is pending, as right after a release', () => {
    const found = findPending([
      'README.md',
      'config.json',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
      '.draft.md',
    ]);
    expect(found.stderr).toBe('');
    expect(found.status).toBe(0);
    expect(found.outputs).toEqual({ count: '0' });
    expect(found.stdout).toContain('No pending changesets: nothing to version');
    expect(found.stdout).toContain('0.11.0');
    expect(dryRunSteps(found.outputs)).toEqual([
      'Dry run: find the pending changesets',
      'Dry run: pack the three packages as changeset publish would, without publishing',
      'Dry run: the GitHub release this version would get',
    ]);
  });

  it('versions the packages before it packs them when changesets are pending', () => {
    const found = findPending([
      'README.md',
      'config.json',
      'brave-cats-sing.md',
      'quiet-owls-run.md',
    ]);
    expect(found.status).toBe(0);
    expect(found.outputs).toEqual({ count: '2' });
    expect(found.stdout).not.toContain('No pending changesets');
    expect(dryRunSteps(found.outputs)).toEqual([
      'Dry run: find the pending changesets',
      'Dry run: version the packages as the release pull request would, without pushing',
      'Dry run: pack the three packages as changeset publish would, without publishing',
      'Dry run: the GitHub release this version would get',
    ]);
  });
});
