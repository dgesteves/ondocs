// skills/ondocs-setup/SKILL.md is what `npx skills add dgesteves/ondocs` installs: the steps a
// coding agent follows to add ondocs to a docs site. An agent does what it says to the letter, so
// what it names is checked against the package: its installs and config are the docs' own, its
// modules are exports, the CLI takes every flag it passes, its links land on a docs page and
// heading, and the local try-out it walks through answers without a key.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseFrontmatter, slugify } from '../src';
import { DEV_USAGE, INDEX_FILES } from '../src/cli/dev';
import { INIT_USAGE } from '../src/cli/init';
import { main } from '../src/cli/main';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const NAME = 'ondocs-setup';
const FILE = `skills/${NAME}/SKILL.md`;
const DOCS = 'examples/nextjs/content/docs';
const SITE = 'https://ondocs.vercel.app';

const text = existsSync(join(root, FILE)) ? read(FILE).replace(/\r\n/g, '\n') : '';
const { data, body } = parseFrontmatter(text);
const pkg = JSON.parse(read('package.json')) as {
  exports: Record<string, unknown>;
  peerDependencies: Record<string, string>;
};
/** Every docs page, by its slug. */
const pages = new Map(
  readdirSync(join(root, DOCS))
    .filter((file) => file.endsWith('.md'))
    .map((file) => [file.slice(0, -'.md'.length), read(`${DOCS}/${file}`)]),
);

/** The skill's fenced code blocks: their language, their code, and the line above them. */
const blocks = [...body.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map((match) => {
  const before = body.slice(0, match.index).trimEnd();
  return {
    lang: match[1] ?? '',
    code: match[2] ?? '',
    intro: before.slice(before.lastIndexOf('\n') + 1),
  };
});

/** Every `ondocs <command> …` the skill runs, in prose or in a block, as CLI arguments. */
const commands = [...body.matchAll(/\bondocs (index|init|dev|eval)((?: [^\s`#'"]+)*)/g)].map(
  (match) => [match[1] ?? '', ...(match[2] ?? '').split(' ').filter(Boolean)],
);

async function run(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    cwd,
    env: {},
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

describe('the ondocs-setup skill', () => {
  it('is where the skills CLI looks, named after its folder, with a description to pick it by', () => {
    expect(existsSync(join(root, FILE)), `${FILE} is missing`).toBe(true);
    // Agent Skills: a name of lowercase words joined by hyphens, at most 64 characters, the same
    // as the folder's; a description of at most 1,024 characters.
    for (const dir of readdirSync(join(root, 'skills'))) {
      const skill = parseFrontmatter(read(`skills/${dir}/SKILL.md`)).data;
      expect(skill.name).toBe(dir);
    }
    const name = typeof data.name === 'string' ? data.name : '';
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    const description = typeof data.description === 'string' ? data.description : '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
    expect(description).toMatch(/\bUse when\b/);
    for (const framework of ['Starlight', 'Astro', 'Docusaurus', 'VitePress', 'Next.js']) {
      expect(description).toContain(framework);
    }
  });

  it('states the Node.js and AI SDK versions package.json requires', () => {
    const { engines, peerDependencies } = JSON.parse(read('package.json')) as {
      engines: { node: string };
      peerDependencies: { ai: string };
    };
    const node = /^>=(\d+\.\d+)\.0$/.exec(engines.node)?.[1];
    const [six, seven] = peerDependencies.ai.split(' || ').map((range) => range.replace(/^\^/, ''));
    expect(node).toBeDefined();
    expect([six?.split('.')[0], seven?.split('.')[0]]).toEqual(['6', '7']);
    expect(body).toContain(`ondocs needs Node.js ${String(node)} or later`);
    expect(body).toContain(
      `ondocs needs AI SDK 6 (${String(six)} or later) or 7 (${String(seven)} or later).`,
    );
    expect(body).toContain('version 5 or lower');
  });

  it('installs what each framework’s guide installs: ondocs and its peers', () => {
    const installs = blocks.filter((block) => block.code.startsWith('npm i '));
    expect(installs).toHaveLength(2);
    const known = ['ondocs', ...Object.keys(pkg.peerDependencies)];
    const guides: Record<string, string> = {
      Starlight: 'astro',
      Astro: 'astro',
      VitePress: 'vitepress',
      Docusaurus: 'docusaurus',
      'Next.js': 'nextjs',
      Fumadocs: 'fumadocs',
      Nextra: 'nextra',
    };
    const covered = new Set<string>();
    for (const { code, intro } of installs) {
      const line = code.trim();
      for (const name of line.split(' ').slice(2)) expect(known).toContain(name);
      // The line above the block names the frameworks it is for, each with a guide installing it.
      const named = Object.keys(guides).filter((name) => intro.includes(name));
      expect(named.length, intro).toBeGreaterThan(0);
      for (const name of named) {
        covered.add(name);
        expect([name, pages.get(guides[name]!)?.includes(`\n${line}\n`)]).toEqual([name, true]);
      }
    }
    expect([...covered].sort()).toEqual(Object.keys(guides).sort());
  });

  it('gives the docs’ own config and code, word for word', () => {
    const code = blocks.filter((block) => ['js', 'ts', 'tsx', 'json'].includes(block.lang));
    expect(code.length).toBeGreaterThanOrEqual(6);
    for (const { lang, code: source } of code) {
      const fenced = `\`\`\`${lang}\n${source}\`\`\``;
      expect([source, [...pages.values()].some((page) => page.includes(fenced))]).toEqual([
        source,
        true,
      ]);
    }
  });

  it('names only modules the package exports', () => {
    const modules = new Set(
      [...text.matchAll(/(?<![\w./@-])ondocs\/[\w./-]*\w/g)].map((match) => match[0]),
    );
    expect(modules.size).toBeGreaterThanOrEqual(6);
    for (const module of modules) {
      expect(Object.keys(pkg.exports)).toContain(`./${module.slice('ondocs/'.length)}`);
    }
  });

  it('passes the CLI only flags it takes, and init only hosts it knows', async () => {
    expect(commands.map(([command]) => command)).toEqual(
      expect.arrayContaining(['index', 'init', 'dev']),
    );
    // An empty folder: `dev` and `eval` read a .env file there before they parse their flags.
    const empty = await mkdtemp(join(tmpdir(), 'ondocs-skill-'));
    const help = new Map<string, string>();
    for (const [command = '', ...args] of commands) {
      if (!help.has(command)) {
        const result = await run([command, '--help'], empty);
        expect(result.code).toBe(0);
        help.set(command, result.stdout);
      }
      for (const flag of args.filter((arg) => arg.startsWith('-'))) {
        const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect([
          command,
          flag,
          new RegExp(`(?:^|[\\s,])${escaped}(?=[\\s,]|$)`, 'm').test(help.get(command) ?? ''),
        ]).toEqual([command, flag, true]);
      }
    }
    await rm(empty, { recursive: true });
    const hosts = /--host <name> +([\w|\s-]+?) \(/.exec(INIT_USAGE)?.[1]?.split(/\s*\|\s*/);
    expect(hosts).toEqual(['vercel', 'netlify', 'cloudflare', 'github-pages']);
    const named = [...text.matchAll(/--host ([\w-]+)/g)].map((match) => match[1]);
    expect(named.sort()).toEqual([...(hosts ?? [])].sort());
  });

  it('says the index is where ondocs dev looks for it', () => {
    const paths = [...text.matchAll(/`([\w./-]*ask-index\.json)`/g)].map((match) => match[1]);
    expect(paths).toEqual(
      expect.arrayContaining([
        'build/ask-index.json',
        'dist/ask-index.json',
        'dist/client/ask-index.json',
        '.vitepress/dist/ask-index.json',
      ]),
    );
    for (const path of paths) expect(INDEX_FILES).toContain(path);
  });

  it('links to docs pages and headings that exist', () => {
    const links = [...text.matchAll(/https:\/\/ondocs\.vercel\.app\/[^\s)`]*[^\s)`.,;:]/g)].map(
      (match) => match[0],
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      if (link === `${SITE}/llms.txt`) {
        expect(existsSync(join(root, 'examples/nextjs/app/llms.txt/route.ts'))).toBe(true);
        continue;
      }
      const [, slug = '', anchor] =
        /^https:\/\/ondocs\.vercel\.app\/docs\/([\w-]+)(?:\.md)?(?:#([\w-]+))?$/.exec(link) ?? [];
      const page = pages.get(slug);
      expect([link, page !== undefined]).toEqual([link, true]);
      if (anchor) {
        const headings = (page ?? '')
          .split('\n')
          .filter((line) => /^#{2,6} /.test(line))
          .map((line) => slugify(line.replace(/^#+ /, '')));
        expect([link, headings.includes(anchor)]).toEqual([link, true]);
      }
    }
    // The site writes a Markdown copy of each page, which the skill points agents at.
    const index = (
      JSON.parse(read('examples/nextjs/package.json')) as {
        scripts: Record<string, string>;
      }
    ).scripts.index;
    expect(index).toMatch(/--llms-txt public\b/);
    expect(index).not.toMatch(/--no-llms-markdown/);
  });

  it('pins no version, which scripts/sync-cdn-range.mjs would not move', () => {
    expect(text).not.toMatch(/ondocs@\d/);
  });
});

describe('the try-out the skill walks through', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ondocs-skill-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('indexes with each keyless command it gives', async () => {
    const keyless = commands.filter(
      ([command, ...args]) =>
        command === 'index' && /^(?:mock|none)$/.test(args[args.indexOf('-e') + 1] ?? ''),
    );
    expect(keyless.length).toBeGreaterThanOrEqual(2);
    for (const [command = '', dir = '', ...args] of keyless) {
      await mkdir(join(cwd, dir), { recursive: true });
      await writeFile(join(cwd, dir, 'index.md'), '# Install\n\nInstall it with npm.\n');
      const out = args.includes('-o') ? args[args.indexOf('-o') + 1]! : 'ask-index.json';
      const result = await run([command, dir, ...args], cwd);
      expect([dir, result.code, result.stderr]).toEqual([dir, 0, '']);
      // Removed after each, so that the next command has to write its own.
      expect(existsSync(join(cwd, out))).toBe(true);
      await rm(join(cwd, out));
    }
  });

  it('answers the curl it gives, from the index it builds, with no key', async () => {
    const index = commands.find(
      ([command, , ...args]) => command === 'index' && args.includes('mock'),
    );
    const devArgs = commands.find(([command]) => command === 'dev');
    expect(index).toBeDefined();
    expect(devArgs).toBeDefined();
    const dir = index![1]!;
    await mkdir(join(cwd, dir), { recursive: true });
    await writeFile(
      join(cwd, dir, 'install.md'),
      '# Install\n\nTo install it, run npm i acme in your project, then add the plugin.\n',
    );
    expect((await run(index!, cwd)).code).toBe(0);

    const curl = /curl -sN (\S+) -H '([^:']+): ([^']+)' -d '([^']+)'/.exec(body);
    expect(curl).not.toBeNull();
    const [, url = '', header = '', value = '', request = ''] = curl ?? [];
    // The curl asks the port ondocs dev listens on by default.
    const { port, pathname } = new URL(url);
    expect(DEV_USAGE).toContain(`(default: ${port})`);

    const controller = new AbortController();
    let found!: (endpoint: string) => void;
    const started = new Promise<string>((resolve) => (found = resolve));
    const errors: string[] = [];
    const server = main([...devArgs!, '--port', '0'], {
      cwd,
      env: {},
      signal: controller.signal,
      stdout: (line) => {
        const endpoint = /Endpoint +(\S+)/.exec(line)?.[1];
        if (endpoint) found(endpoint);
      },
      stderr: (line) => errors.push(line),
    });
    try {
      const endpoint = await Promise.race([
        started,
        server.then((code) => {
          errors.push(`ondocs dev exited with ${String(code)}`);
          return null;
        }),
      ]);
      expect(endpoint, errors.join('\n')).not.toBeNull();
      expect(new URL(endpoint!).pathname).toBe(pathname);
      const response = await fetch(endpoint!, {
        method: 'POST',
        headers: { [header]: value },
        body: request,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const stream = await response.text();
      // What the skill says comes back: source-url parts, then text-delta parts.
      expect(stream).toMatch(/^data: \{"type":"source-url".*"url":"\/install"/m);
      expect(stream).toMatch(/^data: \{"type":"text-delta"/m);
      expect(stream.indexOf('"source-url"')).toBeLessThan(stream.indexOf('"text-delta"'));
      expect(body).toContain('`source-url` parts');
      expect(body).toContain('`text-delta` parts');
    } finally {
      controller.abort();
      expect(await server).toBe(0);
    }
  });
});
