// What the release workflow runs after `changeset publish`, for the version in package.json:
//
//   node scripts/check-published.mjs npm        # npm has all three, and the plugins install
//   node scripts/check-published.mjs release    # ondocs@X.Y.Z has its tag and GitHub release
//   node scripts/check-published.mjs jsdelivr   # jsDelivr's ranges serve this version
//
// Each takes --dry-run, which changes nothing anywhere: `release` prints the release it would
// create, and `jsdelivr` reads what each range serves without purging it.
//
// npm: `changeset publish` publishes the three packages at the same time, in no set order, and the
// plugin packages pin ondocs at their own version. If ondocs fails while a plugin succeeds,
// `npm i docusaurus-plugin-ondocs` fails with ETARGET until the run is repeated, so this checks the
// registry for each one, then installs the plugins in an empty directory (with --dry-run, so
// nothing is written) and checks that they bring this ondocs. npm can take a minute to serve a
// version it has just accepted, so each check is tried again for a few minutes before it fails.
//
// release: one GitHub release per version, for ondocs, with its CHANGELOG.md entry as the notes,
// marked as the latest. The plugin packages get their tags but no release. It does nothing when
// the release exists, or when npm doesn't have the version, so it runs on every push to main with
// no pending changesets: a run whose tag or release failed is completed by re-running it, or by
// the next push. A missing tag is created at this run's commit (GITHUB_SHA).
//
// jsdelivr: the docs' script tags load ondocs@MAJOR.MINOR, which jsDelivr resolves and caches for
// up to 12 hours, so a patch would reach those sites half a day late. This purges that range and
// ondocs@MAJOR, for the script and the dialog it loads from the same place
// (src/embed/global.ts), then waits until each serves this version, purging again while one serves
// an older one. Browsers keep a range for up to 7 days, and no purge reaches them.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const REGISTRY = 'https://registry.npmjs.org';
const CDN = 'https://cdn.jsdelivr.net/npm';
const PURGE = 'https://purge.jsdelivr.net/npm';
// The launcher, and the dialog it loads from the URL it was loaded from.
const CDN_FILES = ['dist/embed.global.js', 'dist/embed-dialog.global.js'];

/**
 * @typedef {{ status: number | null, stdout: string, stderr: string }} RunResult
 * @typedef {object} Io
 * @property {typeof fetch} [fetch]
 * @property {(command: string, args: string[], cwd: string) => RunResult} [run]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {(line: string) => void} [log]
 * @property {number} [attempts] How many times a check is tried before it fails.
 * @property {number} [delayMs] The wait between two tries.
 */

/** @param {Io} io */
function withDefaults(io) {
  return {
    fetch: io.fetch ?? globalThis.fetch,
    run:
      io.run ??
      ((command, args, cwd) => {
        const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
        return { status: result.status, stdout: result.stdout, stderr: result.stderr };
      }),
    sleep: io.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    log: io.log ?? ((line) => console.log(line)),
    attempts: io.attempts ?? 10,
    delayMs: io.delayMs ?? 15_000,
  };
}

/**
 * The packages that release together: the fixed group in .changeset/config.json that holds the
 * root package, root package first.
 * @param {string} dir
 * @returns {string[]}
 */
export function releasedPackages(dir) {
  const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(dir, '.changeset/config.json'), 'utf8'));
  const group = /** @type {string[][]} */ (config.fixed ?? []).find((names) =>
    names.includes(name),
  );
  return [name, ...(group ?? []).filter((other) => other !== name)];
}

/**
 * The CHANGELOG.md entry for `version`: what is under its `## X.Y.Z` heading, up to the next
 * heading of that level, as changesets/action takes it for a release's notes. Headings inside code
 * blocks don't count.
 * @param {string} changelog
 * @param {string} version
 * @returns {string | undefined}
 */
export function changelogEntry(changelog, version) {
  /** @type {{ index: number, depth: number } | undefined} */
  let start;
  const heading = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
  let match;
  while ((match = heading.exec(changelog)) !== null) {
    if (match[3]) {
      const fence = new RegExp(`^${match[3]}`, 'gm');
      fence.lastIndex = heading.lastIndex;
      if (!fence.exec(changelog)) break;
      heading.lastIndex = fence.lastIndex;
      continue;
    }
    const depth = (match[1] ?? '').length;
    if (!start && (match[2] ?? '').trim() === version) {
      start = { index: heading.lastIndex, depth };
    } else if (start && depth <= start.depth) {
      return changelog.slice(start.index, match.index).trim();
    }
  }
  return start ? changelog.slice(start.index).trim() : undefined;
}

/**
 * The jsDelivr URLs a release moves: ondocs@MAJOR.MINOR and ondocs@MAJOR, for each script file.
 * A prerelease moves none.
 * @param {string} name
 * @param {string} version
 * @returns {string[]}
 */
export function cdnPaths(name, version) {
  const parts = /^(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!parts) return [];
  const ranges = [`${name}@${parts[1] ?? ''}.${parts[2] ?? ''}`, `${name}@${parts[1] ?? ''}`];
  return ranges.flatMap((range) => CDN_FILES.map((file) => `${range}/${file}`));
}

/**
 * Tries `check` until it returns no problems, or `attempts` times, and returns the last problems.
 * @param {() => Promise<string[]>} check
 * @param {ReturnType<typeof withDefaults>} io
 */
async function retry(check, io) {
  let problems = await check();
  for (let attempt = 2; attempt <= io.attempts && problems.length > 0; attempt++) {
    io.log(
      `  ${problems.join('; ')}. Trying again (${String(attempt)} of ${String(io.attempts)}).`,
    );
    await io.sleep(io.delayMs);
    problems = await check();
  }
  return problems;
}

/**
 * Whether npm has `name` at `version`.
 * @param {string} name
 * @param {string} version
 * @param {ReturnType<typeof withDefaults>} io
 */
async function onNpm(name, version, io) {
  const response = await io.fetch(`${REGISTRY}/${name}/${version}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`${REGISTRY}/${name}/${version}: HTTP ${String(response.status)}`);
  const manifest = /** @type {{ version?: string }} */ (await response.json());
  return manifest.version === version;
}

/**
 * Checks that every package in `packages` is on npm at `version`, and that installing the others
 * (the plugins) brings `packages[0]` (ondocs) at that version. Returns the problems left after the
 * tries.
 * @param {string} version
 * @param {string[]} packages
 * @param {Io} [options]
 * @returns {Promise<string[]>}
 */
export async function checkNpm(version, packages, options = {}) {
  const io = withDefaults(options);
  const [main, ...plugins] = packages;
  const missing = await retry(async () => {
    const found = await Promise.all(packages.map((name) => onNpm(name, version, io)));
    return packages.filter((_, i) => !found[i]).map((name) => `npm has no ${name}@${version}`);
  }, io);
  if (missing.length > 0 || plugins.length === 0) return missing;
  for (const name of packages) io.log(`✓ npm has ${name}@${version}.`);
  const specs = plugins.map((name) => `${name}@${version}`);
  const dir = mkdtempSync(join(tmpdir(), 'ondocs-install-'));
  try {
    const args = ['install', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund'];
    // Without the plugins' peers (Docusaurus, Astro): this checks the dependency on ondocs.
    args.push('--legacy-peer-deps', '--prefer-online', ...specs);
    const problems = await retry(async () => {
      const result = io.run('npm', args, dir);
      if (result.status !== 0) {
        const reason =
          /No matching version[^\n]*/.exec(result.stderr)?.[0] ??
          result.stderr.trim().split('\n').pop() ??
          `exit code ${String(result.status)}`;
        return [`npm install ${specs.join(' ')} failed: ${reason}`];
      }
      return result.stdout.includes(`add ${main ?? ''} ${version}`)
        ? []
        : [`npm install ${specs.join(' ')} did not bring ${main ?? ''}@${version}`];
    }, io);
    if (problems.length === 0) {
      io.log(`✓ npm install ${specs.join(' ')} brings ${main ?? ''}@${version}.`);
    }
    return problems;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Makes sure `name@version` has a GitHub release, with its CHANGELOG.md entry as the notes. Returns
 * what it found or did.
 * @param {{ name: string, version: string, changelog: string, repository: string, sha?: string, token?: string, api?: string, dryRun?: boolean }} release
 * @param {Io} [options]
 * @returns {Promise<'exists' | 'not-on-npm' | 'would-create' | 'created'>}
 */
export async function ensureRelease(release, options = {}) {
  const io = withDefaults(options);
  const { name, version, changelog, repository, sha, token, dryRun = false } = release;
  const api = release.api || 'https://api.github.com';
  const tag = `${name}@${version}`;
  /** @type {Record<string, string>} */
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'ondocs-release',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const found = await io.fetch(
    `${api}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    { headers },
  );
  if (found.ok) {
    const { html_url: url } = /** @type {{ html_url: string }} */ (await found.json());
    io.log(`✓ ${tag} has its GitHub release: ${url}`);
    return 'exists';
  }
  if (found.status !== 404) {
    throw new Error(
      `Reading the release ${tag}: HTTP ${String(found.status)} ${await found.text()}`,
    );
  }
  const notes = changelogEntry(changelog, version);
  if (!(await onNpm(name, version, io))) {
    io.log(`${tag} is not on npm, so it gets no GitHub release yet.`);
    if (!dryRun) return 'not-on-npm';
  }
  if (!notes) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  const prerelease = version.includes('-');
  if (dryRun) {
    io.log(
      `Dry run: would create the GitHub release ${tag}${prerelease ? ', a prerelease,' : ', marked as the latest,'} at ${sha ?? 'this commit'}, with these notes:\n\n${notes}\n`,
    );
    return 'would-create';
  }
  if (!token) throw new Error(`Creating the release ${tag} needs a token in GH_TOKEN`);
  const created = await io.fetch(`${api}/repos/${repository}/releases`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      // Used only when the tag doesn't exist yet: changeset publish pushes it.
      ...(sha ? { target_commitish: sha } : {}),
      name: tag,
      body: notes,
      prerelease,
      make_latest: prerelease ? 'false' : 'true',
    }),
  });
  if (!created.ok) {
    throw new Error(
      `Creating the release ${tag}: HTTP ${String(created.status)} ${await created.text()}`,
    );
  }
  const { html_url: url } = /** @type {{ html_url: string }} */ (await created.json());
  io.log(`✓ Created the GitHub release ${tag}: ${url}`);
  return 'created';
}

/**
 * Purges each of `paths` (such as `ondocs@0.11/dist/embed.global.js`) from jsDelivr, and waits
 * until each serves `version`. With dryRun, only reads what each serves, once. Returns the paths
 * that still serve another version, with the version they serve.
 * @param {string[]} paths
 * @param {string} version
 * @param {Io & { dryRun?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function purgeJsdelivr(paths, version, options = {}) {
  const io = withDefaults(options);
  const dryRun = options.dryRun ?? false;
  /** @type {Map<string, string>} */
  const served = new Map();
  const check = async () => {
    const stale = paths.filter((path) => served.get(path) !== version);
    for (const path of stale) {
      if (!dryRun) {
        const purge = await io.fetch(`${PURGE}/${path}`);
        if (!purge.ok) io.log(`  The purge of ${path} answered HTTP ${String(purge.status)}.`);
      }
      const head = await io.fetch(`${CDN}/${path}`, { method: 'HEAD' });
      served.set(
        path,
        head.ok ? (head.headers.get('x-jsd-version') ?? 'nothing') : `HTTP ${String(head.status)}`,
      );
    }
    return paths
      .filter((path) => served.get(path) !== version)
      .map((path) => `${path} serves ${served.get(path) ?? 'nothing'}`);
  };
  const problems = dryRun ? await check() : await retry(check, io);
  for (const path of paths.filter((p) => served.get(p) === version)) {
    io.log(`✓ ${CDN}/${path} serves ${version}.`);
  }
  return problems;
}

/**
 * Prints `problems`, as GitHub annotations in a workflow, and sets a failing exit code unless
 * `warn`.
 * @param {string[]} problems
 * @param {boolean} warn
 */
function report(problems, warn) {
  const level = warn ? 'warning' : 'error';
  for (const problem of problems) {
    console.log(
      process.env.GITHUB_ACTIONS === 'true' ? `::${level}::${problem}` : `${level}: ${problem}`,
    );
  }
  if (problems.length > 0 && !warn) process.exitCode = 1;
}

// Run as a script (the real path, so a symlinked checkout still runs it), not imported by a test.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [check, ...args] = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (check === 'npm') {
    report(await checkNpm(version, releasedPackages(root)), false);
  } else if (check === 'release') {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) throw new Error('GITHUB_REPOSITORY must name the repository, as owner/name');
    await ensureRelease({
      name,
      version,
      changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
      repository,
      sha: process.env.GITHUB_SHA,
      token: process.env.GH_TOKEN,
      api: process.env.GITHUB_API_URL,
      dryRun,
    });
  } else if (check === 'jsdelivr') {
    const problems = await purgeJsdelivr(cdnPaths(name, version), version, {
      dryRun,
      delayMs: 30_000,
    });
    report(problems, dryRun);
  } else {
    throw new Error(`Usage: node scripts/check-published.mjs npm|release|jsdelivr [--dry-run]`);
  }
}
