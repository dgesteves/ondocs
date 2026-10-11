// Creates a fresh site the way a new user would, with each framework's own scaffolder, installs
// ondocs into it from a packed tarball, builds it with embeddings from OpenAI, and checks the
// index came out embedded. OPENAI_BASE_URL points at a local stub (./openai-stub.mjs), the only
// thing the index build calls; the API key is fake, so a request to the real API would fail.
//
//   npm pack && node scripts/consumer-site.mjs <site> ondocs-x.y.z.tgz [dir]
//
// The sites are next, docusaurus, starlight and vitepress, and docusaurus-plugin-ondocs and
// starlight-ondocs, which install the plugin under its own package's name (packages/).
//
// The workspace examples link the package from source, so they cannot catch what only an
// installed package meets: how Docusaurus loads plugins, the published files, peer resolution.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startOpenAIStub } from './openai-stub.mjs';

const MODEL = 'text-embedding-3-small';
const PEERS = ['ai', '@ai-sdk/openai', '@radix-ui/react-dialog', 'cmdk'];

/**
 * Per site: how to create it, what to add, what to install and run, where the index lands and
 * the vector size it must have, and the package under packages/ it installs ondocs through,
 * if any (packed here, and installed with the tarball, so it resolves to that and not to npm). Scaffolders are pinned to a major version, so a new major is a
 * deliberate upgrade here rather than a surprise in an unrelated pull request.
 *
 * Some sites have more to check, such as where their pages are served (`check`, which returns the
 * problems it finds). The plugins' sites build their pages into `llms`, and each indexed page must
 * link its `.md` copy from its `<head>` (`linked`).
 *
 * @type {Record<string, {
 *   create: (dir: string) => [string, string[], string?] | [string, string[], string?][],
 *   configure: (dir: string) => void,
 *   install: string[],
 *   build: string[][],
 *   index: string,
 *   llms: string,
 *   dimensions: number,
 *   linked?: boolean,
 *   package?: string,
 *   check?: (dir: string, index: { documents: { url: string }[] }) => string[],
 * }>}
 */
const SITES = {
  // The CLI indexes the content; the build compiles a route handler and the dialog against the
  // installed package.
  next: {
    create: (dir) => [
      'npx',
      [
        '-y',
        'create-next-app@16',
        dir,
        '--ts',
        '--app',
        '--eslint',
        '--no-tailwind',
        '--no-src-dir',
        '--import-alias',
        '@/*',
        '--use-npm',
        '--skip-install',
        '--disable-git',
        '--yes',
      ],
    ],
    configure: (dir) => {
      cpSync(new URL('../examples/nextjs/content/docs', import.meta.url), join(dir, 'content'), {
        recursive: true,
      });
      write(
        dir,
        'app/api/ask/route.ts',
        `import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler } from 'ondocs/server';

import index from '../../../ask-index.json';

const openai = createOpenAI();

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('${MODEL}'),
  embeddingProviderOptions: { openai: { dimensions: 512 } },
});
`,
      );
      write(
        dir,
        'app/ask.tsx',
        `'use client';
import { AskDialog } from 'ondocs/react';

export function Ask() {
  return <AskDialog suggestions={['How do I install it?']} />;
}
`,
      );
      edit(dir, 'app/layout.tsx', (layout) =>
        layout
          .replace(
            'import "./globals.css";',
            'import "./globals.css";\nimport "ondocs/react/styles.css";\nimport { Ask } from "./ask";',
          )
          .replace('{children}', '{children}<Ask />'),
      );
    },
    install: PEERS,
    build: [
      [
        'npx',
        'ondocs',
        'index',
        'content',
        '--base-url',
        '/docs',
        '-e',
        `openai:${MODEL}`,
        '--dimensions',
        '512',
        '--llms-txt',
        'public',
      ],
      ['npx', 'next', 'build'],
    ],
    index: 'ask-index.json',
    llms: 'public',
    dimensions: 512,
  },
  // The plugin with no options: the default model, from OPENAI_API_KEY, loaded under jiti.
  docusaurus: docusaurus("['ondocs/docusaurus', {}]"),
  // The same plugin under its own package's name, the one Docusaurus users search for.
  'docusaurus-plugin-ondocs': {
    ...docusaurus("'docusaurus-plugin-ondocs'"),
    package: 'docusaurus-plugin-ondocs',
  },
  // The plugin with the model named as a string, as the CLI's --embedding names it.
  starlight: starlight('ondocs/starlight'),
  // The same plugin under its own package's name, the one Starlight users search for.
  'starlight-ondocs': {
    ...starlight('starlight-ondocs'),
    package: 'starlight-ondocs',
  },
  // `vitepress init` with its defaults, written by the scaffold function it runs (init itself only
  // asks questions), then the config wrapped in withOndocs with no options: the default model.
  vitepress: {
    create: (dir) => [
      ['mkdir', ['-p', dir]],
      ['npm', ['init', '-y'], dir],
      ['npm', ['install', '--no-audit', '--no-fund', '-D', 'vitepress@1'], dir],
      [
        'node',
        [
          '--input-type=module',
          '-e',
          "const { scaffold } = await import('vitepress'); scaffold({ root: './', theme: 'default theme', useTs: true, injectNpmScripts: true });",
        ],
        dir,
      ],
    ],
    configure: (dir) => {
      edit(dir, '.vitepress/config.mts', (config) =>
        config
          .replace(
            "import { defineConfig } from 'vitepress'",
            "import { defineConfig } from 'vitepress'\nimport { withOndocs } from 'ondocs/vitepress'",
          )
          .replace('export default defineConfig({', 'export default withOndocs(defineConfig({')
          .replace(/\}\)\s*$/, '}))\n'),
      );
    },
    install: [...PEERS, 'react', 'react-dom'],
    build: [['npm', 'run', 'docs:build']],
    index: '.vitepress/dist/ask-index.json',
    llms: '.vitepress/dist',
    dimensions: 512,
    linked: true,
    check: (dir, index) => {
      const out = join(dir, '.vitepress/dist');
      const problems = [];
      // Each URL in the index is a page the build wrote, as a static host serves it.
      for (const { url } of index.documents) {
        const path = decodeURI(url).replace(/^\//, '');
        const files = [path, `${path}.html`, `${path}index.html`, `${path}/index.html`];
        if (!files.some((file) => file && existsSync(join(out, file)))) {
          problems.push(`the index has ${url}, which the build did not write`);
        }
      }
      // The launcher, in a chunk of its own that every page preloads; the dialog in another.
      const chunks = readdirSync(join(out, 'assets/chunks'));
      const text = (file) => readFileSync(join(out, 'assets/chunks', file), 'utf8');
      const launcher = chunks.find((file) => text(file).includes('ondocs-launcher'));
      const dialog = chunks.find((file) => text(file).includes('ask-dialog'));
      if (!launcher) problems.push('no chunk has the launcher');
      if (!dialog || dialog === launcher) problems.push('the dialog is not in a chunk of its own');
      for (const page of readdirSync(out).filter((file) => file.endsWith('.html'))) {
        const html = readFileSync(join(out, page), 'utf8');
        if (page !== '404.html' && launcher && !html.includes(`/assets/chunks/${launcher}`)) {
          problems.push(`${page} does not load the launcher`);
        }
        if (dialog && html.includes(dialog)) problems.push(`${page} loads the dialog up front`);
      }
      return problems;
    },
  },
};

/** A Docusaurus site with `plugin` in its plugins. */
function docusaurus(plugin) {
  return {
    create: (dir) => [
      'npx',
      ['-y', 'create-docusaurus@3', basename(dir), 'classic', '--typescript', '--skip-install'],
      dirname(dir),
    ],
    configure: (dir) => {
      edit(dir, 'docusaurus.config.ts', (config) =>
        config.replace('  presets: [', `  plugins: [${plugin}],\n\n  presets: [`),
      );
    },
    install: PEERS,
    build: [['npx', 'docusaurus', 'build']],
    index: 'build/ask-index.json',
    llms: 'build',
    // The plugin's default model, at its default size.
    dimensions: 512,
    linked: true,
  };
}

/** A Starlight site with the plugin imported from `entry`. */
function starlight(entry) {
  return {
    create: (dir) => [
      'npx',
      ['-y', 'create-astro@4', dir, '--template', 'starlight', '--no-install', '--no-git', '--yes'],
    ],
    configure: (dir) => {
      edit(dir, 'astro.config.mjs', (config) =>
        config
          .replace(
            "import starlight from '@astrojs/starlight';",
            `import starlight from '@astrojs/starlight';\nimport ondocs from '${entry}';`,
          )
          .replace(
            'starlight({',
            `starlight({\n\t\t\tplugins: [ondocs({ embedding: 'openai:${MODEL}', dimensions: 512 })],`,
          ),
      );
    },
    install: [...PEERS, 'react', 'react-dom'],
    build: [['npx', 'astro', 'build']],
    index: 'dist/ask-index.json',
    llms: 'dist',
    dimensions: 512,
    linked: true,
  };
}

/**
 * What is wrong with the links from the built pages to their `.md` copies: each indexed page,
 * where the build wrote it, must have `<link rel="alternate" type="text/markdown">` in its
 * `<head>`, to a copy that is in the build.
 */
function markdownLinks(out, index) {
  const problems = [];
  for (const { url } of index.documents) {
    const path = decodeURI(new URL(url, 'http://site').pathname).replace(/^\//, '');
    const clean = path.replace(/\/$/, '');
    const files = /\.html$/.test(path)
      ? [path]
      : clean === ''
        ? ['index.html']
        : [`${clean}/index.html`, `${clean}.html`];
    const file = files.find((candidate) => existsSync(join(out, candidate)));
    if (!file) {
      problems.push(`the index has ${url}, which the build did not write`);
      continue;
    }
    const html = readFileSync(join(out, file), 'utf8');
    const end = html.search(/<\/head>/i);
    const head = end === -1 ? '' : html.slice(0, end);
    const href = /<link rel="alternate" type="text\/markdown" href="([^"]+)">/.exec(head)?.[1];
    if (!href) {
      problems.push(`${file} does not link its .md copy`);
      continue;
    }
    const copy = decodeURI(new URL(href, 'http://site').pathname).replace(/^\//, '');
    if (!existsSync(join(out, copy)))
      problems.push(`${file} links ${href}, which is not in the build`);
  }
  return problems;
}

function write(dir, file, content) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** Rewrites a scaffolded file, failing if the change did not apply (the template moved on). */
function edit(dir, file, change) {
  const before = readFileSync(join(dir, file), 'utf8');
  const after = change(before);
  if (after === before || !after.includes('ondocs')) {
    throw new Error(`Could not add ondocs to ${file}; did the template change?`);
  }
  writeFileSync(join(dir, file), after);
}

/** Runs a command, inheriting stdio; asynchronously, so the stub in this process can answer it. */
async function run(command, args, { cwd, env } = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(code)}`);
}

const [name = '', tarball = '', target] = process.argv.slice(2);
const site = SITES[name];
if (!site || !tarball) {
  console.error(
    `Usage: node scripts/consumer-site.mjs <${Object.keys(SITES).join('|')}> <tarball> [dir]`,
  );
  process.exit(2);
}
const dir = resolve(target ?? join(tmpdir(), `ondocs-consumer-${name}`));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dirname(dir), { recursive: true });

const created = site.create(dir);
for (const [command, args, cwd] of Array.isArray(created[0]) ? created : [created]) {
  await run(command, args, { cwd: cwd ?? dirname(dir) });
}
site.configure(dir);
const tarballs = [resolve(tarball)];
if (site.package) {
  const packed = join(dirname(dir), `${name}-pack`);
  rmSync(packed, { recursive: true, force: true });
  // pnpm pack writes ondocs's version where the manifest says workspace:*.
  await run('pnpm', ['pack', '--pack-destination', packed], {
    cwd: fileURLToPath(new URL(`../packages/${site.package}`, import.meta.url)),
  });
  tarballs.push(join(packed, readdirSync(packed)[0] ?? ''));
}
await run('npm', ['install', '--no-audit', '--no-fund', ...tarballs, ...site.install], {
  cwd: dir,
});
if (site.package && existsSync(join(dir, 'node_modules', site.package, 'node_modules/ondocs'))) {
  throw new Error(`${site.package} installed its own ondocs rather than the packed one.`);
}

const stub = await startOpenAIStub();
try {
  const env = {
    OPENAI_API_KEY: 'sk-consumer-check',
    OPENAI_BASE_URL: stub.url,
    AI_GATEWAY_API_KEY: '',
    NEXT_TELEMETRY_DISABLED: '1',
    ASTRO_TELEMETRY_DISABLED: '1',
  };
  for (const [step, ...rest] of site.build) await run(step, rest, { cwd: dir, env });
} finally {
  await stub.close();
}

const file = join(dir, site.index);
if (!existsSync(file)) throw new Error(`The build wrote no ${site.index}.`);
const index = JSON.parse(readFileSync(file, 'utf8'));
const problems = [];
const { model, dimensions } = index.embedding ?? {};
if (model !== MODEL || dimensions !== site.dimensions) {
  problems.push(
    `embedding is ${JSON.stringify(index.embedding)}, expected ${MODEL} at ${String(site.dimensions)} dimensions`,
  );
}
if (!index.chunks?.length || !index.chunks.every((chunk) => typeof chunk.vector === 'string')) {
  problems.push('some chunks have no vector');
}
// llms.txt, llms-full.txt and a .md copy of each indexed page, linked from llms.txt.
const llmsDir = join(dir, site.llms);
for (const file of ['llms.txt', 'llms-full.txt']) {
  if (!existsSync(join(llmsDir, file))) problems.push(`the build wrote no ${site.llms}/${file}`);
}
const llmsTxt = existsSync(join(llmsDir, 'llms.txt'))
  ? readFileSync(join(llmsDir, 'llms.txt'), 'utf8')
  : '';
const links = [...llmsTxt.matchAll(/^- \[[^\]]*\]\(([^)]+\.md)\)/gm)].map((match) => match[1]);
if (links.length !== index.documents.length) {
  problems.push(
    `llms.txt links ${String(links.length)} .md pages, the index has ${String(index.documents.length)}`,
  );
}
for (const link of links) {
  const file = join(llmsDir, decodeURI(new URL(link, 'http://site').pathname).replace(/^\//, ''));
  if (!existsSync(file)) problems.push(`llms.txt links ${link}, which is not in ${site.llms}`);
}
if (site.linked) problems.push(...markdownLinks(llmsDir, index));
problems.push(...(site.check?.(dir, index) ?? []));
const strays = stub.requests.filter((request) => request !== 'POST /v1/embeddings');
if (stub.requests.length === 0) problems.push('the stub received no embedding request');
if (strays.length > 0) problems.push(`the stub received ${strays.join(', ')}`);
if (problems.length > 0) {
  console.error(`\n✗ ${name}: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(
  `\n✓ ${name}: ${site.index} has ${String(index.documents.length)} pages and ${String(index.chunks.length)} chunks embedded with ${MODEL} at ${String(site.dimensions)} dimensions, from ${String(stub.requests.length)} requests to the stub; ${site.llms}/llms.txt links a .md copy of each${site.linked ? ', and so does each page' : ''}.`,
);
