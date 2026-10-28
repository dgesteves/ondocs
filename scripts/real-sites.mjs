// Installs the packed ondocs into real docs sites, at pinned commits, with each site's own package
// manager and workspace, builds each with the plugin, and checks what came out:
//
// - an index for each of the site's locales,
// - every anchor an index links to, on its page,
// - `npx ondocs --version` from the site's package, printing the packed version,
// - a fixed question's sources, none of them the same section twice.
//
//   npm pack && node scripts/real-sites.mjs <site> ondocs-x.y.z.tgz [dir]
//
// The sites are Starlight's docs (pnpm, 17 locales), Vitest's (pnpm, VitePress 2 with an async
// config from withPwa and a theme of its own), typescript-eslint's (pnpm with a 7-day release-age
// gate, Docusaurus built through nx) and Jest's (Yarn 4, Docusaurus with versioned docs). Each
// failed in its own way before: pnpm's strict node_modules, an async VitePress config, versioned
// copies of every section, the CLI missing from PATH. scripts/consumer-site.mjs builds fresh sites,
// as a scaffolder makes them; these are sites as their maintainers run them.
//
// Each site is cloned into its own folder, `dir` (default: one in the system's temp folder), and
// installed with dependency install scripts off. Only its build runs its code. The index build
// embeds with OpenAI's API through a local stub (./openai-stub.mjs), and the key is fake.
// .github/workflows/real-sites.yml runs each site.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startOpenAIStub } from './openai-stub.mjs';

const MODEL = 'text-embedding-3-small';
/** What the guides install with ondocs; a Docusaurus site's dialog renders with these two too. */
const MODELS = { ai: '^7.0.95', '@ai-sdk/openai': '^4.0.0' };
const REACT_PEERS = { '@radix-ui/react-dialog': '^1.1.23', cmdk: '^1.1.1' };

/**
 * Per site: the repository and the commit, the folder of its docs package (`package`), what to add
 * to that package's dependencies besides ondocs, how to add the plugin (`configure`, which edits
 * the checkout in `dir`), the install and build commands, run at the repository's root, where the
 * build writes its pages (`out`), the locales it has an index for (`''` is the root), the fewest
 * pages each index must have, and a question to ask the index.
 *
 * @type {Record<string, {
 *   repository: string,
 *   commit: string,
 *   package: string,
 *   add: Record<string, string>,
 *   configure: (dir: string) => void,
 *   install: [string, string[]],
 *   build: [string, string[]],
 *   env?: Record<string, string>,
 *   out: string,
 *   locales: string[],
 *   pages: number,
 *   question: string,
 * }>}
 */
const SITES = {
  // pnpm 11, a 3-day release-age gate, autoInstallPeers off, and 17 locales.
  starlight: {
    repository: 'withastro/starlight',
    commit: 'eac604d6b22d7c82538cc645022186bba923909d',
    package: 'docs',
    add: MODELS,
    configure: (dir) => {
      edit(dir, 'docs/astro.config.mjs', (config) =>
        config
          .replace(
            "import starlight from '@astrojs/starlight';",
            "import starlight from '@astrojs/starlight';\nimport ondocs from 'ondocs/starlight';",
          )
          .replace(
            '\t\t\tplugins: process.env.CHECK_LINKS\n',
            `\t\t\tplugins: [ondocs({ embedding: 'openai:${MODEL}', dimensions: 512 }), ...(process.env.CHECK_LINKS\n`,
          )
          .replace('\t\t\t\t: [],\n\t\t}),', '\t\t\t\t: [])],\n\t\t}),'),
      );
    },
    install: ['pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts']],
    build: ['pnpm', ['--filter', 'starlight-docs', 'build']],
    out: 'docs/dist',
    locales: [
      '',
      'de',
      'es',
      'ja',
      'fr',
      'it',
      'id',
      'zh-cn',
      'pt-br',
      'pt-pt',
      'ko',
      'tr',
      'ru',
      'hi',
      'da',
      'uk',
      'fa',
    ],
    pages: 20,
    question: 'How do I add a page to the sidebar?',
  },
  // pnpm 11 with a 7-day gate, VitePress 2, and a config that is a function returning withPwa's
  // Promise. Its zh locale is a link to another site, with no pages here. `build-no-prefetch`
  // skips fetching the team's avatars from GitHub.
  vitest: {
    repository: 'vitest-dev/vitest',
    commit: '5ea35816c6121272df3f4ca1d9555461147acce4',
    package: 'docs',
    add: MODELS,
    configure: (dir) => {
      edit(dir, 'docs/.vitepress/config.ts', (config) =>
        config
          .replace(
            "import { defineConfig } from 'vitepress'",
            "import { defineConfig } from 'vitepress'\nimport { withOndocs } from 'ondocs/vitepress'",
          )
          .replace(
            'export default ({ mode }: { mode: string }) => {',
            'export default withOndocs(({ mode }: { mode: string }) => {',
          )
          .replace(/\n\}\n$/, '\n})\n'),
      );
    },
    install: ['pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts']],
    build: ['pnpm', ['-C', 'docs', 'run', 'build-no-prefetch']],
    env: { ROLLDOWN_OPTIONS_VALIDATION: 'loose' },
    out: 'docs/.vitepress/dist',
    locales: [''],
    pages: 100,
    question: 'How do I mock a module?',
  },
  // pnpm 12 with a 7-day gate, trustPolicy and blockExoticSubdeps; the website is built by nx,
  // after the packages it documents.
  'typescript-eslint': {
    repository: 'typescript-eslint/typescript-eslint',
    commit: 'f55b8519f6fc794dcdaa53eb7ae359f1ecd977d0',
    package: 'packages/website',
    add: { ...MODELS, ...REACT_PEERS },
    configure: (dir) => {
      edit(dir, 'packages/website/docusaurus.config.mts', (config) =>
        config.replace('  plugins: [\n', "  plugins: [\n    ['ondocs/docusaurus', {}],\n"),
      );
    },
    install: ['pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts']],
    build: ['pnpm', ['exec', 'nx', 'build', 'website']],
    env: { NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_SKIP_NX_CACHE: 'true' },
    out: 'packages/website/build',
    locales: [''],
    pages: 100,
    question: 'How do I configure no-unused-vars?',
  },
  // Yarn 4 (its own copy, committed), a 3-day gate, and five docs versions; built in English only,
  // as its deploy previews are, with the sponsors it fetches from Open Collective left empty.
  jest: {
    repository: 'jestjs/jest',
    commit: '61050e9323e742539dc2360236671110e37329e6',
    package: 'website',
    add: { ...MODELS, ...REACT_PEERS },
    configure: (dir) => {
      edit(dir, 'website/docusaurus.config.mjs', (config) =>
        config.replace('  plugins: [\n', "  plugins: [\n    ['ondocs/docusaurus', {}],\n"),
      );
      writeFileSync(join(dir, 'website/backers.json'), '[]\n');
    },
    install: ['yarn', ['install']],
    build: ['yarn', ['workspace', 'jest-website', 'build', '-l', 'en']],
    env: {
      YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
      YARN_ENABLE_SCRIPTS: 'false',
      YARN_ENABLE_TELEMETRY: 'false',
    },
    out: 'website/build',
    locales: [''],
    pages: 50,
    question: 'How do I use fake timers?',
  },
};

/** Rewrites a file of the checkout, failing if the change did not apply. */
function edit(dir, file, change) {
  const before = readFileSync(join(dir, file), 'utf8');
  const after = change(before);
  if (after === before || !after.includes('ondocs')) {
    throw new Error(`Could not add ondocs to ${file}; did the commit change?`);
  }
  writeFileSync(join(dir, file), after);
}

/**
 * Runs a command and returns its exit code and its standard output, which it also prints, with
 * how long it took. Yarn runs from the copy the repository commits, as its `yarnPath` says.
 */
async function run(command, args, { cwd, env = {}, check = true } = {}) {
  const start = Date.now();
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const [bin, ...prefix] = command === 'yarn' ? yarn(cwd) : [command];
  const child = spawn(bin, [...prefix, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += String(data);
    process.stdout.write(data);
  });
  const [code] = await once(child, 'exit');
  console.log(`(${((Date.now() - start) / 1000).toFixed(1)} s)`);
  if (check && code !== 0)
    throw new Error(`${command} ${args.join(' ')} exited with ${String(code)}`);
  return { code, output };
}

/** `node <yarnPath>`, from the .yarnrc.yml of the checkout that `cwd` is in. */
function yarn(cwd) {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const rc = join(dir, '.yarnrc.yml');
    const path = existsSync(rc) ? /^yarnPath:\s*(.+)$/m.exec(readFileSync(rc, 'utf8'))?.[1] : null;
    if (path) return [process.execPath, join(dir, path.trim())];
    if (dirname(dir) === dir) throw new Error(`No yarnPath above ${cwd}`);
  }
}

/** The `id`s of a page's elements, quoted or not, as a minifier may leave them. */
function ids(html) {
  const found = new Set();
  for (const [, double, single, bare] of html.matchAll(
    /\sid=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
  )) {
    // In one pass, so that `&amp;quot;` stays `&quot;`.
    const id = (double ?? single ?? bare ?? '').replace(/&(amp|quot|#39);/g, (_, entity) =>
      entity === 'amp' ? '&' : entity === 'quot' ? '"' : "'",
    );
    found.add(id);
  }
  return found;
}

/** The built HTML file for `url` in `out`, as a static host serves it, or null. */
function pageFile(out, url) {
  const path = decodeURI(new URL(url, 'http://site').pathname).replace(/^\/+|\/+$/g, '');
  const candidates = /\.html$/.test(path)
    ? [path]
    : path === ''
      ? ['index.html']
      : [`${path}/index.html`, `${path}.html`];
  return candidates.map((file) => join(out, file)).find((file) => existsSync(file)) ?? null;
}

const [name = '', tarball = '', target] = process.argv.slice(2);
const site = SITES[name];
if (!site || !tarball) {
  console.error(
    `Usage: node scripts/real-sites.mjs <${Object.keys(SITES).join('|')}> <tarball> [dir]`,
  );
  process.exit(2);
}
const dir = resolve(target ?? join(tmpdir(), `ondocs-real-${name}`));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// The commit alone, with no history: GitHub serves a commit by its id.
await run('git', ['init', '-q'], { cwd: dir });
await run(
  'git',
  ['fetch', '-q', '--depth', '1', `https://github.com/${site.repository}.git`, site.commit],
  {
    cwd: dir,
  },
);
await run('git', ['-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'], { cwd: dir });

site.configure(dir);
const docs = join(dir, site.package);
const manifestFile = join(docs, 'package.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.dependencies = {
  ...manifest.dependencies,
  ondocs: `file:${resolve(tarball)}`,
  ...site.add,
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

const env = {
  ...site.env,
  OPENAI_API_KEY: 'sk-real-site-check',
  AI_GATEWAY_API_KEY: '',
  ASTRO_TELEMETRY_DISABLED: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};
await run(...site.install, { cwd: dir, env });
const stub = await startOpenAIStub();
try {
  await run(...site.build, { cwd: dir, env: { ...env, OPENAI_BASE_URL: stub.url } });
} finally {
  await stub.close();
}

const problems = [];
const out = join(dir, site.out);
const packed = JSON.parse(
  readFileSync(createRequire(manifestFile).resolve('ondocs/package.json'), 'utf8'),
);
const { loadIndex, retrieve } = await import(
  pathToFileURL(createRequire(manifestFile).resolve('ondocs')).href
);

// An index per locale, each with its pages, and each anchor it links to on its page.
const indexes = [];
for (const locale of site.locales) {
  const file = join(out, locale, 'ask-index.json');
  if (!existsSync(file)) {
    problems.push(`no ${join(site.out, locale, 'ask-index.json')}`);
    continue;
  }
  const index = JSON.parse(readFileSync(file, 'utf8'));
  indexes.push({ locale, index });
  if (index.documents.length < site.pages) {
    problems.push(`${locale || 'the root'}'s index has ${String(index.documents.length)} pages`);
  }
  if (index.embedding?.model !== MODEL || index.embedding?.dimensions !== 512) {
    problems.push(
      `${locale || 'the root'}'s index is embedded with ${JSON.stringify(index.embedding)}`,
    );
  }
  const missing = [];
  const pages = new Map();
  for (const chunk of index.chunks) {
    if (!chunk.anchor) continue;
    const { url } = index.documents[chunk.doc];
    if (!pages.has(url)) {
      const page = pageFile(out, url);
      pages.set(url, page ? ids(readFileSync(page, 'utf8')) : new Set());
    }
    const found = pages.get(url);
    if (![chunk.anchor, decodeURIComponent(chunk.anchor)].some((id) => found.has(id))) {
      missing.push(`${url}#${chunk.anchor}`);
    }
  }
  if (missing.length > 0) {
    problems.push(
      `${String(missing.length)} anchors in ${locale || 'the root'}'s index are not on their pages, such as ${missing.slice(0, 3).join(', ')}`,
    );
  }
}
const extra = readdirSync(out).filter(
  (entry) => !site.locales.includes(entry) && existsSync(join(out, entry, 'ask-index.json')),
);
if (extra.length > 0)
  problems.push(`indexes for locales the site does not have: ${extra.join(', ')}`);

// The command every guide gives, from the docs package's folder.
const cli = await run('npx', ['--no', '--', 'ondocs', '--version'], { cwd: docs, check: false });
if (cli.code !== 0 || cli.output.trim().split('\n').at(-1) !== packed.version) {
  problems.push(
    `npx ondocs --version printed ${JSON.stringify(cli.output.trim())}, not ${packed.version}`,
  );
}

// A question, keyword-only as the index is searched before an embedding comes back: its sources
// must be different sections, not copies of one, such as the same section in each docs version.
const root = indexes.find(({ locale }) => locale === '');
if (root) {
  const { hits } = retrieve(loadIndex(root.index), { text: site.question });
  const sections = hits.map(({ chunk }) => `${chunk.title} › ${chunk.heading}\n${chunk.text}`);
  console.log(`\n${site.question}`);
  for (const { chunk } of hits) console.log(`  ${chunk.url}`);
  if (hits.length === 0) problems.push(`no sources for "${site.question}"`);
  if (new Set(sections).size < sections.length) {
    problems.push(`"${site.question}" has the same section among its sources twice`);
  }
}

if (problems.length > 0) {
  console.error(`\n✗ ${name}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const pages = indexes.reduce((sum, { index }) => sum + index.documents.length, 0);
console.log(
  `\n✓ ${name} at ${site.commit.slice(0, 7)}: ${String(indexes.length)} ${indexes.length === 1 ? 'index' : 'indexes'} with ${String(pages)} pages, every anchor on its page, npx ondocs ${packed.version}, and distinct sources for "${site.question}".`,
);
