// scripts/check-published.mjs, which the release workflow runs after `changeset publish`: npm has
// all three packages and the plugins install with the ondocs they pin, ondocs alone gets a GitHub
// release, and jsDelivr's ranges serve the new version. npm, GitHub and jsDelivr are stand-ins.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cdnPaths,
  changelogEntry,
  checkNpm,
  ensureRelease,
  main,
  NPM_TRIES,
  publishedByThisRun,
  purgeJsdelivr,
  releasedPackages,
} from '../scripts/check-published.mjs';

const root = join(import.meta.dirname, '..');
const packages = ['ondocs', 'docusaurus-plugin-ondocs', 'starlight-ondocs'];

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

/** A fetch that answers from `routes` (by "METHOD url", or by url), and records each call. */
function stand(routes: Record<string, (call: Call) => Response | undefined>) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { url, method, body };
    calls.push(call);
    const route = routes[`${method} ${url}`] ?? routes[url];
    return Promise.resolve(route?.(call) ?? new Response('not found', { status: 404 }));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (value: unknown, status = 200) => Response.json(value, { status });
const quiet = { log: () => undefined, sleep: () => Promise.resolve(), attempts: 3, delayMs: 0 };
const installed = (version: string) => ({
  status: 0,
  stdout: `add ondocs ${version}\nadd starlight-ondocs ${version}\nadd docusaurus-plugin-ondocs ${version}\n`,
  stderr: '',
});

describe('the packages that release together', () => {
  it('are the fixed group in .changeset/config.json, ondocs first', () => {
    expect(releasedPackages(root)).toEqual(packages);
  });
});

describe('npm', () => {
  const registry = (present: Record<string, boolean>) =>
    stand(
      Object.fromEntries(
        packages.map((name) => [
          `https://registry.npmjs.org/${name}/0.11.0`,
          () => (present[name] ? json({ name, version: '0.11.0' }) : undefined),
        ]),
      ),
    );

  it('passes when all three are on npm and the plugins install with this ondocs', async () => {
    const { fetch } = registry({
      ondocs: true,
      'docusaurus-plugin-ondocs': true,
      'starlight-ondocs': true,
    });
    const commands: string[][] = [];
    const run = (command: string, args: string[]) => {
      commands.push([command, ...args]);
      return installed('0.11.0');
    };
    expect(await checkNpm('0.11.0', packages, { ...quiet, fetch, run })).toEqual([]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual(
      expect.arrayContaining([
        'npm',
        'install',
        '--dry-run',
        '--ignore-scripts',
        'docusaurus-plugin-ondocs@0.11.0',
        'starlight-ondocs@0.11.0',
      ]),
    );
  });

  // 0.9.0 and 0.10.0 both put the plugins on npm before ondocs: had ondocs failed, they would have
  // pinned a version npm didn't have.
  it('fails, naming it, when ondocs is missing while the plugins are there', async () => {
    const { fetch, calls } = registry({
      'docusaurus-plugin-ondocs': true,
      'starlight-ondocs': true,
    });
    const run = () => installed('0.11.0');
    expect(await checkNpm('0.11.0', packages, { ...quiet, fetch, run })).toEqual([
      'npm has no ondocs@0.11.0',
    ]);
    // Tried again, since npm can take a minute to serve a version it has just accepted.
    expect(calls.filter((call) => call.url.endsWith('/ondocs/0.11.0'))).toHaveLength(3);
  });

  it('passes once npm serves a version it was slow to show', async () => {
    let tries = 0;
    const { fetch } = stand({
      'https://registry.npmjs.org/ondocs/0.11.0': () =>
        ++tries < 3 ? undefined : json({ version: '0.11.0' }),
    });
    expect(await checkNpm('0.11.0', ['ondocs'], { ...quiet, fetch })).toEqual([]);
    expect(tries).toBe(3);
  });

  it('tries again when npm answers with an error', async () => {
    let tries = 0;
    const { fetch } = stand({
      'https://registry.npmjs.org/ondocs/0.11.0': () =>
        ++tries < 2 ? new Response('busy', { status: 503 }) : json({ version: '0.11.0' }),
    });
    expect(await checkNpm('0.11.0', ['ondocs'], { ...quiet, fetch })).toEqual([]);
    expect(tries).toBe(2);
  });

  // npm's time for ondocs@0.10.0 is almost 3 minutes after its publish job ended, and the check
  // job starts within a minute of that: the old budget, 2 minutes and 15 seconds, would have failed
  // that good release.
  it('waits about 10 minutes for npm by default', () => {
    expect((NPM_TRIES.attempts - 1) * NPM_TRIES.delayMs).toBeGreaterThanOrEqual(9 * 60_000);
  });

  it('fails when the plugins don’t install', async () => {
    const { fetch } = registry({
      ondocs: true,
      'docusaurus-plugin-ondocs': true,
      'starlight-ondocs': true,
    });
    const run = () => ({
      status: 1,
      stdout: '',
      stderr:
        'npm error code ETARGET\nnpm error notarget No matching version found for ondocs@0.11.0.\n',
    });
    expect(await checkNpm('0.11.0', packages, { ...quiet, fetch, run })).toEqual([
      'npm install docusaurus-plugin-ondocs@0.11.0 starlight-ondocs@0.11.0 failed: No matching version found for ondocs@0.11.0.',
    ]);
  });
});

describe('the GitHub release', () => {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const api = 'https://api.github.com/repos/dgesteves/ondocs';
  const release = {
    name: 'ondocs',
    version: '0.10.0',
    changelog,
    repository: 'dgesteves/ondocs',
    sha: 'abc123',
    token: 'token',
  };
  const onNpm = {
    'https://registry.npmjs.org/ondocs/0.10.0': () => json({ version: '0.10.0' }),
  };

  it('takes the version’s CHANGELOG.md entry as the notes, as changesets/action did', () => {
    const entry = changelogEntry(changelog, '0.10.0');
    expect(entry).toMatch(/^### Minor Changes\n\n- \[#107\]/);
    expect(entry).not.toContain('## 0.9.0');
    expect(changelogEntry(changelog, '9.9.9')).toBeUndefined();
    // A heading inside a code block doesn't end the entry.
    const fenced = '# x\n\n## 1.1.0\n\nA\n\n```md\n## 1.0.0\n```\n\nB\n\n## 1.0.0\n\nC\n';
    expect(changelogEntry(fenced, '1.1.0')).toBe('A\n\n```md\n## 1.0.0\n```\n\nB');
    expect(changelogEntry(fenced, '1.0.0')).toBe('C');
  });

  it('creates ondocs@X.Y.Z, marked as the latest, at this run’s commit when the tag is missing', async () => {
    const { fetch, calls } = stand({
      ...onNpm,
      [`POST ${api}/releases`]: () => json({ html_url: 'https://github.com/r' }, 201),
    });
    expect(await ensureRelease(release, { ...quiet, fetch })).toBe('created');
    const created = calls.find((call) => call.method === 'POST');
    expect(created?.url).toBe(`${api}/releases`);
    expect(created?.body).toEqual({
      tag_name: 'ondocs@0.10.0',
      target_commitish: 'abc123',
      name: 'ondocs@0.10.0',
      body: changelogEntry(changelog, '0.10.0'),
      prerelease: false,
      make_latest: 'true',
    });
  });

  it('does nothing when the release exists, as on a push after the release', async () => {
    const { fetch, calls } = stand({
      [`${api}/releases/tags/ondocs%400.10.0`]: () => json({ html_url: 'https://github.com/r' }),
    });
    expect(await ensureRelease(release, { ...quiet, fetch })).toBe('exists');
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  // A publish where ondocs failed, or a push after one: the plugins' tags can be there, but ondocs
  // gets no release, and the step reads npm once.
  it('creates none while ondocs isn’t on npm and this run didn’t publish it', async () => {
    const { fetch, calls } = stand({});
    expect(await ensureRelease(release, { ...quiet, fetch })).toBe('not-on-npm');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(calls.filter((call) => call.url.startsWith('https://registry.'))).toHaveLength(1);
  });

  // The step runs seconds after changeset publish, and npm served ondocs@0.10.0 about 3 minutes
  // later: read once, this would have made no release on a green run.
  it('waits for npm when this run published ondocs, then creates the release', async () => {
    let tries = 0;
    const { fetch, calls } = stand({
      'https://registry.npmjs.org/ondocs/0.10.0': () =>
        ++tries < 3 ? undefined : json({ version: '0.10.0' }),
      [`POST ${api}/releases`]: () => json({ html_url: 'https://github.com/r' }, 201),
    });
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    expect(
      await ensureRelease(
        { ...release, published: true },
        { ...quiet, delayMs: 30_000, sleep, fetch },
      ),
    ).toBe('created');
    expect(tries).toBe(3);
    expect(sleeps).toEqual([30_000, 30_000]);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('gives up after its tries when this run published ondocs and npm never serves it', async () => {
    const { fetch, calls } = stand({});
    expect(await ensureRelease({ ...release, published: true }, { ...quiet, fetch })).toBe(
      'not-on-npm',
    );
    expect(calls.filter((call) => call.url.startsWith('https://registry.'))).toHaveLength(3);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('knows whether this run published a version, from changesets/action’s list', () => {
    const list = JSON.stringify([
      { name: 'docusaurus-plugin-ondocs', version: '0.11.0' },
      { name: 'ondocs', version: '0.11.0' },
    ]);
    expect(publishedByThisRun(list, 'ondocs', '0.11.0')).toBe(true);
    expect(publishedByThisRun(list, 'ondocs', '0.10.0')).toBe(false);
    // A publish where ondocs failed and a plugin didn't: changesets/action lists the plugin only.
    expect(
      publishedByThisRun(
        JSON.stringify([{ name: 'starlight-ondocs', version: '0.11.0' }]),
        'ondocs',
        '0.11.0',
      ),
    ).toBe(false);
    for (const nothing of [undefined, '', '[]', 'not json', '{}']) {
      expect(publishedByThisRun(nothing, 'ondocs', '0.11.0')).toBe(false);
    }
  });

  it('creates nothing in a dry run, and says what it would create', async () => {
    const { fetch, calls } = stand(onNpm);
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    expect(await ensureRelease({ ...release, dryRun: true }, { ...quiet, fetch, log })).toBe(
      'would-create',
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(lines.join('\n')).toContain('would create the GitHub release ondocs@0.10.0');
  });

  it('fails loudly when GitHub answers with anything but the release or a 404', async () => {
    const { fetch } = stand({
      [`${api}/releases/tags/ondocs%400.10.0`]: () =>
        new Response('Bad credentials', { status: 401 }),
    });
    await expect(ensureRelease(release, { ...quiet, fetch })).rejects.toThrow(/HTTP 401/);
  });

  it('marks a prerelease as one, and not as the latest', async () => {
    const pre = '1.0.0-next.0';
    const { fetch, calls } = stand({
      [`https://registry.npmjs.org/ondocs/${pre}`]: () => json({ version: pre }),
      [`POST ${api}/releases`]: () => json({ html_url: 'https://github.com/r' }, 201),
    });
    await ensureRelease(
      { ...release, version: pre, changelog: `# ondocs\n\n## ${pre}\n\nSoon.\n` },
      { ...quiet, fetch },
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      prerelease: true,
      make_latest: 'false',
    });
  });
});

// The step as the workflow runs it, for this checkout's version: an error that fails the job when
// this run published ondocs and npm never served it, and only a warning otherwise.
describe('the release step', () => {
  const env = {
    GITHUB_REPOSITORY: 'dgesteves/ondocs',
    GH_TOKEN: 'token',
    GITHUB_SHA: 'abc123',
  };
  const version = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  ).version;
  const step = async (extra: Record<string, string>) => {
    const { fetch, calls } = stand({});
    const lines: string[] = [];
    const code = await main(['release'], {
      ...quiet,
      fetch,
      log: (line) => lines.push(line),
      env: { ...env, ...extra },
    });
    return { code, lines, calls };
  };

  it('fails, saying to re-run the job, when this run published ondocs and npm never serves it', async () => {
    const { code, lines, calls } = await step({
      PUBLISHED_PACKAGES: JSON.stringify([{ name: 'ondocs', version }]),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(
      new RegExp(`error.*This run published ondocs@${version.replaceAll('.', '\\.')}.*re-run`),
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('only warns when ondocs isn’t on npm and this run didn’t publish it', async () => {
    const { code, lines } = await step({ PUBLISHED_PACKAGES: '[]' });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/warning.*is not on npm, so it gets no GitHub release yet/);
  });
});

describe('jsDelivr', () => {
  it('moves the minor and the major range, for the script and its dialog', () => {
    expect(cdnPaths('ondocs', '0.11.2')).toEqual([
      'ondocs@0.11/dist/embed.global.js',
      'ondocs@0.11/dist/embed-dialog.global.js',
      'ondocs@0/dist/embed.global.js',
      'ondocs@0/dist/embed-dialog.global.js',
    ]);
    expect(cdnPaths('ondocs', '1.0.0-next.0')).toEqual([]);
  });

  /** A CDN that serves `old` until `purges` purges of a path, then `version`. */
  const cdn = (paths: string[], version: string, old: string, purges: number) => {
    const count = new Map<string, number>();
    return stand(
      Object.fromEntries(
        paths.flatMap((path) => [
          [
            `https://purge.jsdelivr.net/npm/${path}`,
            () => {
              count.set(path, (count.get(path) ?? 0) + 1);
              return json({ status: 'finished' });
            },
          ],
          [
            `HEAD https://cdn.jsdelivr.net/npm/${path}`,
            () =>
              new Response(null, {
                headers: { 'x-jsd-version': (count.get(path) ?? 0) >= purges ? version : old },
              }),
          ],
        ]),
      ),
    );
  };

  it('purges each path, and passes once each serves the new version', async () => {
    const paths = cdnPaths('ondocs', '0.11.1');
    const { fetch, calls } = cdn(paths, '0.11.1', '0.11.0', 1);
    expect(await purgeJsdelivr(paths, '0.11.1', { ...quiet, fetch })).toEqual([]);
    expect(calls.filter((call) => call.url.startsWith('https://purge.')).map((c) => c.url)).toEqual(
      paths.map((path) => `https://purge.jsdelivr.net/npm/${path}`),
    );
  });

  // jsDelivr can resolve a range from npm data it fetched before the publish, and cache that again.
  it('purges again while a range still serves the old version', async () => {
    const paths = ['ondocs@0.11/dist/embed.global.js'];
    const { fetch, calls } = cdn(paths, '0.11.1', '0.11.0', 2);
    expect(await purgeJsdelivr(paths, '0.11.1', { ...quiet, fetch })).toEqual([]);
    expect(calls.filter((call) => call.url.startsWith('https://purge.'))).toHaveLength(2);
  });

  it('fails, naming what each stale path serves, after its tries', async () => {
    const paths = ['ondocs@0/dist/embed.global.js'];
    const { fetch } = cdn(paths, '0.11.1', '0.10.0', 99);
    expect(await purgeJsdelivr(paths, '0.11.1', { ...quiet, fetch })).toEqual([
      'ondocs@0/dist/embed.global.js serves 0.10.0',
    ]);
  });

  it('purges nothing in a dry run, and reads each path once', async () => {
    const paths = cdnPaths('ondocs', '0.10.0');
    const { fetch, calls } = cdn(paths, '0.10.0', '0.10.0', 0);
    expect(await purgeJsdelivr(paths, '0.10.0', { ...quiet, fetch, dryRun: true })).toEqual([]);
    expect(calls.every((call) => call.method === 'HEAD')).toBe(true);
    expect(calls).toHaveLength(paths.length);
  });
});
