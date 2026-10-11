// `ondocs init`: what it writes per site and host (snapshotted), and how it behaves when run
// again, asked to overwrite, or given config it cannot edit safely. scripts/deploy-recipes.mjs
// builds these same files with each host's own tooling.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { version } from '../package.json' with { type: 'json' };
import { wranglerWorkerConfig } from '../src/cli/init';
import { comment, workerName } from '../src/cli/init-templates';
import { main } from '../src/cli/main';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ondocs-init-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function files(root: string, dir = root): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await files(root, path));
    else out[relative(root, path)] = await readFile(path, 'utf8');
  }
  return out;
}

async function site(contents: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(contents)) {
    await mkdir(join(cwd, path, '..'), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
}

async function run(args: string[], answers?: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const asked: string[] = [];
  const env: Record<string, string | undefined> = {};
  const queue = [...(answers ?? [])];
  const code = await main(['init', ...args], {
    cwd,
    env,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    ...(answers
      ? {
          prompt: (question: string) => {
            asked.push(question);
            return Promise.resolve(queue.shift() ?? '');
          },
        }
      : {}),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), asked, env };
}

const DOCUSAURUS = {
  'package.json': JSON.stringify({ name: 'acme-docs', dependencies: { '@docusaurus/core': '3' } }),
  'docusaurus.config.ts':
    "export default { title: 'Acme Docs', url: 'https://acme.github.io', baseUrl: '/docs/' };\n",
};

describe('ondocs init: what it writes per host', () => {
  const cases: [string, Record<string, string>, string[]][] = [
    ['Docusaurus on Vercel', { ...DOCUSAURUS, 'vercel.json': '{ "cleanUrls": true }\n' }, []],
    [
      'Docusaurus on Netlify',
      { ...DOCUSAURUS, 'netlify.toml': '[build]\n  publish = "build"\n' },
      [],
    ],
    [
      'Docusaurus on Cloudflare Pages, without a wrangler config',
      DOCUSAURUS,
      ['--host', 'cloudflare'],
    ],
    [
      'Docusaurus on a Cloudflare Worker with static assets (wrangler.toml)',
      {
        ...DOCUSAURUS,
        'wrangler.toml':
          'name = "acme-docs"\ncompatibility_date = "2026-09-01"\n\n[assets]\ndirectory = "./build"\n',
      },
      [],
    ],
    [
      'Docusaurus on GitHub Pages',
      {
        ...DOCUSAURUS,
        'package.json': JSON.stringify({
          name: 'acme-docs',
          scripts: { deploy: 'docusaurus deploy' },
          dependencies: { '@docusaurus/core': '3' },
        }),
      },
      [],
    ],
    [
      'Starlight on Vercel',
      {
        'package.json': JSON.stringify({
          dependencies: { astro: '7', '@astrojs/starlight': '0.42' },
        }),
        'astro.config.mjs':
          "import starlight from '@astrojs/starlight';\nexport default { site: 'https://docs.acme.dev', integrations: [starlight({ title: 'Acme' })] };\n",
        '.vercel/project.json': '{}',
      },
      [],
    ],
    [
      'Next.js on Netlify',
      {
        'package.json': JSON.stringify({ name: 'acme', dependencies: { next: '16' } }),
        'next.config.ts': 'export default {};\n',
        'src/app/page.tsx': '',
        'netlify.toml': '',
      },
      [],
    ],
    [
      'Docusaurus in three locales on Netlify',
      {
        'package.json': JSON.stringify({
          name: 'acme-docs',
          dependencies: { '@docusaurus/core': '3' },
        }),
        'docusaurus.config.ts':
          "export default {\n  title: 'Acme Docs',\n  url: 'https://acme.github.io',\n  baseUrl: '/',\n  i18n: { defaultLocale: 'en', locales: ['en', 'fr', 'pt-BR'] },\n};\n",
        'netlify.toml': '',
      },
      [],
    ],
    [
      'Starlight in two locales on a Cloudflare Worker',
      {
        'package.json': JSON.stringify({
          dependencies: { astro: '7', '@astrojs/starlight': '0.42' },
        }),
        'astro.config.mjs':
          "import starlight from '@astrojs/starlight';\nexport default { site: 'https://docs.acme.dev', integrations: [starlight({ title: 'Acme', locales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' } } })] };\n",
        'wrangler.jsonc': '{\n  "name": "acme",\n  "assets": { "directory": "./dist" }\n}\n',
      },
      [],
    ],
    [
      'VitePress in docs/, in two locales, on Vercel',
      {
        'package.json': JSON.stringify({
          name: 'acme',
          devDependencies: { vitepress: '1.6.4' },
          scripts: { 'docs:build': 'vitepress build docs' },
        }),
        'docs/.vitepress/config.mts':
          "import { defineConfig } from 'vitepress';\n\nexport default defineConfig({\n  title: 'Acme Docs',\n  base: '/docs/',\n  sitemap: { hostname: 'https://acme.dev' },\n  locales: {\n    root: { label: 'English', lang: 'en' },\n    fr: { label: 'Français', lang: 'fr' },\n  },\n});\n",
        'vercel.json': '{}\n',
      },
      [],
    ],
    [
      'VitePress on GitHub Pages',
      {
        'package.json': JSON.stringify({ devDependencies: { vitepress: '1.6.4' } }),
        '.vitepress/config.mts':
          "import { defineConfig } from 'vitepress';\n\nexport default defineConfig({ title: 'Acme', base: '/acme/' });\n",
        '.github/workflows/deploy.yml': 'steps:\n  - uses: actions/deploy-pages@v4\n',
      },
      ['--site-url', 'https://acme.github.io/acme'],
    ],
    [
      'Hugo on a GitHub Pages workflow',
      {
        'hugo.toml': 'baseURL = "https://acme.github.io/site/"\ntitle = "Acme"\n',
        '.github/workflows/pages.yml': 'steps:\n  - uses: actions/deploy-pages@v4\n',
      },
      [],
    ],
  ];

  for (const [name, contents, args] of cases) {
    it(name, async () => {
      await site(contents);
      const before = await files(cwd);
      const result = await run(['--yes', ...args]);
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      const after = await files(cwd);
      // The package's own version, which a release changes, as a placeholder.
      const minor = version.split('.').slice(0, 2).join('.');
      const unversioned = (text: string) =>
        text.replaceAll(`^${version}`, '^<version>').replaceAll(`@${minor}/`, '@<minor>/');
      const written = Object.fromEntries(
        Object.entries(after)
          .filter(([path, text]) => before[path] !== text)
          .map(([path, text]) => [path, unversioned(text)]),
      );
      expect(written).toMatchSnapshot();
      expect(unversioned(result.stdout)).toMatchSnapshot();
    });
  }
});

describe('ondocs init', () => {
  it('is idempotent: run again, it finds every file as it would write it', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}' });
    expect((await run([])).code).toBe(0);
    const first = await files(cwd);
    const again = await run([]);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/unchanged {2}api\/ask\.ts/);
    expect(again.stdout).toMatch(/unchanged {2}vercel\.json/);
    expect(await files(cwd)).toEqual(first);
  });

  it('writes nothing with --dry-run, and prints what it would write', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}' });
    const result = await run(['--dry-run']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Dry run: a Docusaurus site on Vercel\./);
    expect(result.stdout).toMatch(/would create {2}api\/ask\.ts/);
    expect(result.stdout).toContain('--- api/ask.ts');
    expect(result.stdout).toContain(
      "import { createAskHandler, memoryRateLimit, turnstile } from 'ondocs/server';",
    );
    expect(existsSync(join(cwd, 'api'))).toBe(false);
    expect(await readFile(join(cwd, 'vercel.json'), 'utf8')).toBe('{}');
  });

  it('asks before it overwrites a file that differs, and leaves it when told no', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}', 'api/ask.ts': '// mine\n' });
    const no = await run([], ['n']);
    expect(no.asked).toEqual([
      'api/ask.ts exists and differs from what init writes. Overwrite it? [y/N] ',
    ]);
    expect(no.code).toBe(1);
    expect(no.stdout).toMatch(/skipped {4}api\/ask\.ts/);
    expect(await readFile(join(cwd, 'api/ask.ts'), 'utf8')).toBe('// mine\n');
    // The edit to vercel.json only adds, so it is made without asking.
    expect(JSON.parse(await readFile(join(cwd, 'vercel.json'), 'utf8'))).toEqual({
      functions: {
        'api/ask.ts': { includeFiles: 'build/ask-index.json' },
        'api/mcp.ts': { includeFiles: 'build/ask-index.json' },
      },
    });

    const yes = await run([], ['y']);
    expect(yes.code).toBe(0);
    expect(await readFile(join(cwd, 'api/ask.ts'), 'utf8')).toContain('createAskHandler');
  });

  it('never overwrites without a terminal to ask, unless given --yes', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}', 'api/ask.ts': '// mine\n' });
    const result = await run([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Left api/ask.ts as it is.');
    expect(await readFile(join(cwd, 'api/ask.ts'), 'utf8')).toBe('// mine\n');
    expect((await run(['--yes'])).code).toBe(0);
    expect(await readFile(join(cwd, 'api/ask.ts'), 'utf8')).toContain('createAskHandler');
  });

  it('asks for the host when nothing names one, and fails without a terminal', async () => {
    await site(DOCUSAURUS);
    const unattended = await run([]);
    expect(unattended.code).toBe(2);
    expect(unattended.stderr).toContain('pass --host vercel|netlify|cloudflare|github-pages');

    const asked = await run([], ['2']);
    expect(asked.code).toBe(0);
    expect(asked.stdout).toContain('Where is the site hosted?');
    expect(asked.stdout).toContain('a Docusaurus site on Netlify.');
    expect(existsSync(join(cwd, 'netlify/functions/ask.mts'))).toBe(true);
  });

  it('asks which host when the site has config for two', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}', 'netlify.toml': '' });
    const unattended = await run([]);
    expect(unattended.code).toBe(2);
    expect(unattended.stderr).toContain(
      'config for Vercel and Netlify: pick one with --host vercel|netlify',
    );
    const asked = await run([], ['1']);
    expect(asked.stdout).toContain('a Docusaurus site on Vercel.');
  });

  it('writes nothing for Astro with an SSR adapter: the integration serves the endpoints', async () => {
    await site({
      'package.json': JSON.stringify({ dependencies: { astro: '7', '@astrojs/node': '10' } }),
      'astro.config.mjs':
        "import node from '@astrojs/node';\nexport default { adapter: node() };\n",
      'vercel.json': '{}',
    });
    const before = await files(cwd);
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Astro with @astrojs/node: nothing to write.');
    expect(await files(cwd)).toEqual(before);
  });

  it('needs the site URL for GitHub Pages, as the Worker reads the live index', async () => {
    await site({ 'docusaurus.config.ts': "export default { title: 'Acme' };\n" });
    const result = await run(['--host', 'github-pages']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('pass --site-url');
    const given = await run([
      '--host',
      'github-pages',
      '--site-url',
      'https://acme.github.io/docs/',
    ]);
    expect(given.code).toBe(0);
    expect(await readFile(join(cwd, 'ondocs-worker/wrangler.jsonc'), 'utf8')).toContain(
      '"SITE_URL": "https://acme.github.io/docs"',
    );
  });

  it('answers GitHub Pages with Workers AI and no key, or with OpenAI when asked', async () => {
    await site({
      'docusaurus.config.ts': "export default { title: 'Acme', url: 'https://a.dev' };\n",
    });
    const zeroKey = await run(['--host', 'github-pages']);
    expect(zeroKey.code).toBe(0);
    const worker = await readFile(join(cwd, 'ondocs-worker/src/index.ts'), 'utf8');
    expect(worker).toContain("import { createWorkersAI } from 'workers-ai-provider';");
    expect(worker).not.toContain('OPENAI_API_KEY');
    expect(await readFile(join(cwd, 'ondocs-worker/wrangler.jsonc'), 'utf8')).toContain(
      '"ai": { "binding": "AI" },',
    );
    expect(zeroKey.stdout).not.toContain('wrangler secret put');

    const openai = await run(['--host', 'github-pages', '--provider', 'openai', '--yes']);
    expect(openai.code).toBe(0);
    expect(await readFile(join(cwd, 'ondocs-worker/src/index.ts'), 'utf8')).toContain(
      "import { createOpenAI } from '@ai-sdk/openai';",
    );
    expect(openai.stdout).toContain('npx wrangler secret put OPENAI_API_KEY');
  });

  it('runs Workers AI only in the Worker it writes for GitHub Pages', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}' });
    const result = await run(['--provider', 'workers-ai']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--provider workers-ai is for --host github-pages');
    expect((await run(['--provider', 'anthropic'])).stderr).toContain(
      '--provider must be workers-ai or openai.',
    );
  });

  it('says what to add by hand when a config file already configures the function', async () => {
    await site({
      ...DOCUSAURUS,
      'netlify.toml': '[functions.ask]\n  node_bundler = "esbuild"\n',
    });
    const result = await run([]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'by hand    netlify.toml already configures [functions.ask]; add included_files = ["build/ask-index.json"] to it',
    );
    expect(await readFile(join(cwd, 'netlify.toml'), 'utf8')).toBe(
      '[functions.ask]\n  node_bundler = "esbuild"\n',
    );
  });

  it('leaves a vercel.json it cannot parse alone', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{ "functions": ' });
    const result = await run([]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/by hand {4}vercel\.json is not valid JSON/);
  });

  it('reads no .env file', async () => {
    await site({ ...DOCUSAURUS, 'vercel.json': '{}', '.env': 'OPENAI_API_KEY=sk-not-for-init\n' });
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.env).toEqual({});
    expect(result.stdout).not.toContain('sk-not-for-init');
  });

  it('rejects an unknown host and a relative site URL', async () => {
    await site(DOCUSAURUS);
    expect((await run(['--host', 'heroku'])).stderr).toContain('--host must be one of');
    expect((await run(['--host', 'github-pages', '--site-url', 'acme.dev'])).stderr).toContain(
      '--site-url must be an absolute http(s) URL',
    );
  });

  it('prints its help', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('It never deploys anything and never');
  });
});

describe('wranglerWorkerConfig', () => {
  it('adds main and the ASSETS binding to a TOML config', () => {
    expect(
      wranglerWorkerConfig(
        'wrangler.toml',
        'name = "docs"\ncompatibility_date = "2026-09-01"\n\n[assets]\ndirectory = "./build"\n',
      ),
    ).toEqual({
      content:
        'name = "docs"\nmain = "worker/ondocs.ts"\ncompatibility_date = "2026-09-01"\n\n[assets]\nbinding = "ASSETS"\ndirectory = "./build"\n',
    });
  });

  it('edits a JSONC config as text, keeping its comments', () => {
    const source =
      '{\n  // The docs.\n  "name": "docs",\n  "assets": {\n    "directory": "./build"\n  }\n}\n';
    expect(wranglerWorkerConfig('wrangler.jsonc', source)).toEqual({
      content:
        '{\n  // The docs.\n  "name": "docs",\n  "main": "worker/ondocs.ts",\n  "assets": {\n    "binding": "ASSETS",\n    "directory": "./build"\n  }\n}\n',
    });
  });

  it('leaves a Worker with its own entry point to its owner', () => {
    expect(
      wranglerWorkerConfig(
        'wrangler.toml',
        'main = "src/index.ts"\n[assets]\ndirectory = "dist"\n',
      ),
    ).toEqual({
      error:
        'wrangler.toml has its own entry point (main = "src/index.ts"): call ondocs(request, env) from worker/ondocs.ts in it',
    });
    expect(
      wranglerWorkerConfig(
        'wrangler.json',
        '{ "main": "src/index.ts", "assets": { "directory": "d" } }',
      ),
    ).toHaveProperty('error');
  });

  it('needs static assets, or a binding named ASSETS', () => {
    expect(wranglerWorkerConfig('wrangler.toml', 'name = "x"\n')).toHaveProperty('error');
    expect(
      wranglerWorkerConfig('wrangler.toml', '[assets]\nbinding = "STATIC"\ndirectory = "d"\n'),
    ).toEqual({
      error: 'wrangler.toml: the static assets\' binding must be "ASSETS" (binding = "STATIC")',
    });
  });
});

describe('the templates’ helpers', () => {
  it('wraps comments at 100 columns', () => {
    const text = comment('word '.repeat(60));
    expect(text.split('\n').every((line) => line.length <= 100 && line.startsWith('// '))).toBe(
      true,
    );
  });

  it('names a Worker from the site', () => {
    expect(workerName('Acme Docs')).toBe('acme-docs-ask');
    expect(workerName('Ünïcode & Co.')).toBe('unicode-co-ask');
    expect(workerName('***')).toBe('docs-ask');
    expect(workerName('a'.repeat(80)).length).toBeLessThanOrEqual(63);
  });
});
