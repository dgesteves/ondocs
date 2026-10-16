// GitHub's dependency graph reads only the first YAML document in pnpm-lock.yaml, and pnpm keeps the
// pnpm it pins there, so the graph and Dependabot alerts missed every locked package.
// .github/workflows/dependency-graph.yml submits them instead: these tests run its steps on the real
// lockfile and check the snapshot it would send.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Package {
  package_url: string;
  relationship: 'direct' | 'indirect';
  scope: 'runtime' | 'development';
  dependencies: string[];
}

interface Snapshot {
  version: number;
  sha: string;
  ref: string;
  job: { correlator: string; id: string; html_url: string };
  detector: { name: string; version: string; url: string };
  scanned: string;
  manifests: Record<
    string,
    { name: string; file: { source_location: string }; resolved: Record<string, Package> }
  >;
}

const root = join(import.meta.dirname, '..');
const workflow = parse(
  readFileSync(join(root, '.github/workflows/dependency-graph.yml'), 'utf8'),
) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<
    string,
    { if?: string; permissions?: Record<string, string>; steps: Step[] } | undefined
  >;
};
const job = workflow.jobs.submit;
const steps = job?.steps ?? [];
const sbomStep = steps.find((step) => step.run?.startsWith('pnpm sbom'));
const snapshotStep = steps.find((step) => step.env?.SBOM && step.run?.includes('node'));

/** The lockfile's own packages, as `name@version`: its last YAML document, the one pnpm installs. */
function lockedPackages(): string[] {
  const documents = parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
  const lockfile = documents.at(-1)?.toJS() as { packages: Record<string, unknown> };
  return Object.keys(lockfile.packages);
}

/** A package URL, as pnpm sbom writes it: `pkg:npm/%40scope/name@1.0.0`. */
const purl = (id: string) => `pkg:npm/${id.replace(/^@/, '%40')}`;

describe('the dependency graph workflow', () => {
  let dir: string;
  let snapshot: Snapshot;
  let resolved: Record<string, Package>;
  let log: string;

  // Runs the two steps as the job would, with the job's environment, from the repository root.
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dependency-graph-'));
    const env = {
      ...process.env,
      RUNNER_TEMP: dir,
      SBOM: join(dir, 'sbom.json'),
      SNAPSHOT: join(dir, 'snapshot.json'),
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ID: '123',
      GITHUB_JOB: 'submit',
      GITHUB_WORKFLOW: 'Dependency graph',
      GITHUB_REPOSITORY: 'dgesteves/ondocs',
      GITHUB_SERVER_URL: 'https://github.com',
    };
    for (const step of [sbomStep, snapshotStep]) {
      const script = join(dir, 'step.sh');
      writeFileSync(script, step!.run!);
      const run = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      expect(run.status, run.stderr).toBe(0);
      log = run.stdout;
    }
    snapshot = JSON.parse(readFileSync(join(dir, 'snapshot.json'), 'utf8')) as Snapshot;
    resolved = snapshot.manifests['pnpm-lock.yaml']?.resolved ?? {};
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('submits on each push to main, with the only write permission it needs', () => {
    expect(workflow.on).toEqual({ push: { branches: ['main'] }, workflow_dispatch: null });
    expect(workflow.permissions).toEqual({});
    expect(job?.if).toBe("github.repository == 'dgesteves/ondocs'");
    expect(job?.permissions).toEqual({ contents: 'write' });
    // No install: nothing from the dependencies runs next to the token.
    expect(steps.some((step) => step.run?.includes('install'))).toBe(false);
    const submit = steps.at(-1);
    expect(submit?.run).toContain(
      'gh api --method POST "repos/$GITHUB_REPOSITORY/dependency-graph/snapshots" --input "$SNAPSHOT"',
    );
    expect(submit?.env?.SNAPSHOT).toBe(snapshotStep?.env?.SNAPSHOT);
  });

  it('writes a snapshot with the fields the dependency submission API requires', () => {
    expect(snapshot).toMatchObject({
      version: 0,
      sha: 'a'.repeat(40),
      ref: 'refs/heads/main',
      job: {
        correlator: 'Dependency graph submit',
        id: '123',
        html_url: 'https://github.com/dgesteves/ondocs/actions/runs/123',
      },
      detector: { name: 'pnpm sbom', url: 'https://pnpm.io/cli/sbom' },
    });
    expect(snapshot.detector.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(snapshot.scanned))).toBe(false);
    expect(Object.keys(snapshot.manifests)).toEqual(['pnpm-lock.yaml']);
    expect(snapshot.manifests['pnpm-lock.yaml']).toMatchObject({
      name: 'pnpm-lock.yaml',
      file: { source_location: 'pnpm-lock.yaml' },
    });
  });

  // Why the workflow is there. Should pnpm write the lockfile as one document again, GitHub reads
  // all of it, and the workflow can go.
  it('is needed: the first YAML document, which GitHub reads, locks pnpm and nothing else', () => {
    const documents = parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
    expect(documents.length).toBeGreaterThan(1);
    const first = documents[0]?.toJS() as { packages: Record<string, unknown> };
    const pinned = Object.keys(first.packages);
    expect(pinned).toContain(packageManager());
    expect(pinned.filter((id) => !/^(pnpm|@pnpm\/exe(\.[\w-]+)?)@/.test(id))).toEqual([]);
  });

  it('lists every package the lockfile locks', () => {
    const locked = lockedPackages();
    expect(locked.length).toBeGreaterThan(1000);
    expect(locked.filter((id) => !resolved[purl(id)])).toEqual([]);
    expect(log).toContain(`${Object.keys(resolved).length} packages:`);
  });

  it('marks what a workspace package.json names as direct, and dev-only packages as development', () => {
    // A dependency of the published package, and one of the examples' (the live demos).
    expect(resolved[purl(`zod@${resolvedVersion('zod')}`)]).toMatchObject({
      relationship: 'direct',
      scope: 'runtime',
    });
    expect(resolved[purl(`next@${resolvedVersion('next', 'examples/nextjs')}`)]).toMatchObject({
      relationship: 'direct',
      scope: 'runtime',
    });
    expect(resolved[purl(`eslint@${resolvedVersion('eslint')}`)]).toMatchObject({
      relationship: 'direct',
      scope: 'development',
    });
    // The finding's critical advisory came through @docusaurus/core, a dependency of an example.
    const tinypool = Object.values(resolved).find((p) =>
      p.package_url.startsWith('pkg:npm/tinypool@'),
    );
    expect(tinypool).toMatchObject({ relationship: 'indirect', scope: 'runtime' });
    // pnpm, which the first document pins and GitHub listed, stays in the graph.
    expect(resolved[`pkg:npm/${packageManager()}`]).toMatchObject({
      relationship: 'direct',
      scope: 'development',
    });
    // This repository's own packages are not its dependencies.
    expect(Object.keys(resolved).filter((url) => /^pkg:npm\/[^@]*ondocs@/.test(url))).toEqual([]);
  });

  it('gives each package the packages it depends on, each of them in the snapshot', () => {
    const docusaurus = Object.values(resolved).find((p) =>
      p.package_url.startsWith('pkg:npm/%40docusaurus/core@'),
    );
    expect(docusaurus?.dependencies).toContain(
      Object.values(resolved).find((p) => p.package_url.startsWith('pkg:npm/tinypool@'))
        ?.package_url,
    );
    const packages = Object.entries(resolved);
    expect(packages.filter(([url, pkg]) => pkg.package_url !== url)).toEqual([]);
    const dependencies = packages.flatMap(([, pkg]) => pkg.dependencies);
    expect(dependencies.length).toBeGreaterThan(packages.length);
    expect(dependencies.filter((url) => !resolved[url])).toEqual([]);
  });
});

/** package.json's packageManager: `pnpm@<version>`. */
function packageManager(): string {
  const { packageManager } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    packageManager: string;
  };
  // Without the hash corepack can add: `pnpm@12.9.1+sha512...`.
  return packageManager.replace(/\+.*/, '');
}

/** The version pnpm-lock.yaml locks for an importer's dependency. */
function resolvedVersion(name: string, importer = '.'): string {
  const documents = parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
  const lockfile = documents.at(-1)?.toJS() as {
    importers: Record<string, Record<string, Record<string, { version: string }> | undefined>>;
  };
  const entry = ['dependencies', 'devDependencies']
    .map((kind) => lockfile.importers[importer]?.[kind]?.[name])
    .find(Boolean);
  // A version with peers reads `1.0.0(react@19.0.0)`.
  return entry!.version.replace(/\(.*$/, '');
}
