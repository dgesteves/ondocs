// Creates a fresh site the way a new user would, with each framework's own scaffolder, installs
// ondocs into it from a packed tarball, builds it with embeddings from OpenAI, and checks the
// index came out embedded. OPENAI_BASE_URL points at a local stub (./openai-stub.mjs), the only
// thing the index build calls; the API key is fake, so a request to the real API would fail.
//
//   npm pack && node scripts/consumer-site.mjs <site> ondocs-x.y.z.tgz [dir]
//
// The sites are next, fumadocs, nextra, docusaurus, starlight and vitepress, and
// docusaurus-plugin-ondocs and starlight-ondocs, which install the plugin under its own package's
// name (packages/). Nextra has no scaffolder, so its site is the docs starter from the Nextra
// repository at a pinned tag.
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
/** What every site installs with ondocs: the AI SDK, which the index build and the endpoint use. */
const MODELS = ['ai', '@ai-sdk/openai'];
/** A React site's dialog renders with the site's React, and these two. */
const PEERS = [...MODELS, '@radix-ui/react-dialog', 'cmdk'];
/** The Nextra release whose docs starter the nextra site is, as the Nextra guide was checked on. */
const NEXTRA = '4.6.1';

/**
 * Per site: how to create it, what to add, what to install and run, where the index lands and
 * the vector size it must have, and the package under packages/ it installs ondocs through,
 * if any (packed here, and installed with the tarball, so it resolves to that and not to npm). Scaffolders are pinned to a major version, so a new major is a
 * deliberate upgrade here rather than a surprise in an unrelated pull request.
 *
 * Some sites have more to check, such as where their pages are served (`check`, which returns the
 * problems it finds). `llms` is where ondocs writes `llms.txt` and the `.md` copies; a site that
 * serves its own (Fumadocs) has none. The plugins' sites build their pages into `llms`, or into
 * `html`, and each indexed page must link its `.md` copy from its `<head>` (`linked`).
 *
 * @type {Record<string, {
 *   create: (dir: string) => [string, string[], string?] | [string, string[], string?][],
 *   configure: (dir: string) => void,
 *   install: string[],
 *   build: string[][],
 *   index: string,
 *   llms?: string,
 *   html?: string,
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
  // create-fumadocs-app's Next.js template, with ondocs added as the Fumadocs guide says, and the
  // pages of test/fixtures/fumadocs-site, one for each rule that moves a URL. The template serves
  // its own llms.txt and Markdown copies, so the index is built without --llms-txt.
  fumadocs: {
    create: (dir) => [
      'npx',
      [
        '-y',
        'create-fumadocs-app@16',
        basename(dir),
        '--template',
        '+next+fuma-docs-mdx',
        '--pm',
        'npm',
        '--yes',
        '--no-git',
      ],
      dirname(dir),
    ],
    configure: (dir) => {
      cpSync(fixture('fumadocs-site/content/docs'), join(dir, 'content/docs'), { recursive: true });
      scripts(
        dir,
        `ondocs index content/docs --base-url /docs -e openai:${MODEL} --dimensions 512`,
      );
      write(
        dir,
        'app/api/ask/route.ts',
        `import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import index from '@/ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('${MODEL}'),
  siteName: 'Acme Docs',
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
`,
      );
      write(dir, 'app/api/mcp/route.ts', mcpRoute("'@/ask-index.json'"));
      write(dir, 'components/ask.tsx', askComponent("'next-themes'"));
      edit(
        dir,
        'app/layout.tsx',
        (layout) =>
          layout
            .replace(
              "import './global.css';",
              "import './global.css';\nimport { Ask } from '@/components/ask';",
            )
            .replace(
              '<RootProvider>{children}</RootProvider>',
              '<RootProvider>\n          {children}\n          <Ask />\n        </RootProvider>',
            ),
        '<Ask />',
      );
    },
    install: [...PEERS, 'next-themes'],
    build: [['npm', 'run', 'build']],
    index: 'ask-index.json',
    dimensions: 512,
    check: (dir, index) => nextRoutes(dir, index, '/docs/[[...slug]]'),
  },
  // Nextra 4.6.1's docs starter (examples/docs in its repository, with nextra and
  // nextra-theme-docs from npm at that version in place of its workspace links), with ondocs added
  // as the Nextra guide says, and the pages of test/fixtures/nextra-site/src/content. Its build
  // runs `next build --webpack`, then Pagefind.
  nextra: {
    create: (dir) => {
      const repository = `${dir}-repository`;
      return [
        ['rm', ['-rf', repository]],
        [
          'git',
          [
            'clone',
            '--depth',
            '1',
            '--branch',
            `nextra@${NEXTRA}`,
            '--filter',
            'blob:none',
            '--sparse',
            'https://github.com/shuding/nextra.git',
            repository,
          ],
        ],
        ['git', ['sparse-checkout', 'set', 'examples/docs'], repository],
        ['cp', ['-R', join(repository, 'examples/docs'), dir]],
      ];
    },
    configure: (dir) => {
      cpSync(fixture('nextra-site/src/content'), join(dir, 'src/content'), { recursive: true });
      scripts(
        dir,
        `ondocs index src/content --base-url /docs -e openai:${MODEL} --dimensions 512 --llms-txt public`,
      );
      edit(
        dir,
        'package.json',
        (text) => {
          const manifest = JSON.parse(text);
          for (const name of ['nextra', 'nextra-theme-docs']) manifest.dependencies[name] = NEXTRA;
          // As the guide says: the starter's build fails with zod 4.6, which ondocs needs.
          manifest.overrides = {
            nextra: { zod: '4.1.13' },
            'nextra-theme-docs': { zod: '4.1.13' },
          };
          return `${JSON.stringify(manifest, null, 2)}\n`;
        },
        '"overrides"',
      );
      write(
        dir,
        'src/app/api/ask/route.js',
        `import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ondocs/server';
import index from '../../../../ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('${MODEL}'),
  siteName: 'Acme Docs',
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
`,
      );
      write(dir, 'src/app/api/mcp/route.js', mcpRoute("'../../../../ask-index.json'"));
      write(dir, 'components/ask.jsx', askComponent("'nextra-theme-docs'"));
      edit(
        dir,
        'src/app/layout.jsx',
        (layout) =>
          layout
            .replace(
              "import 'nextra-theme-docs/style.css'",
              "import 'nextra-theme-docs/style.css'\nimport { Ask } from '../../components/ask'",
            )
            .replace(
              '          {children}\n        </Layout>',
              '          {children}\n          <Ask />\n        </Layout>',
            ),
        '<Ask />',
      );
      // Each page links its .md copy from its <head>, as the guide's metadata does.
      edit(
        dir,
        'src/app/docs/[[...mdxPath]]/page.jsx',
        (page) =>
          page.replace(
            '  const { metadata } = await importPage(params.mdxPath)\n  return metadata\n',
            `  const { metadata } = await importPage(params.mdxPath);
  const markdown = ['/docs', ...(params.mdxPath ?? [])].join('/') + '.md';
  return { ...metadata, alternates: { types: { 'text/markdown': markdown } } };
`,
          ),
        "'text/markdown'",
      );
    },
    install: PEERS,
    build: [['npm', 'run', 'build']],
    index: 'ask-index.json',
    llms: 'public',
    html: '.next/server/app',
    dimensions: 512,
    linked: true,
    check: (dir, index) => nextRoutes(dir, index, '/docs/[[...mdxPath]]'),
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
    // The dialog brings its own React, Radix and cmdk, so the guide installs none of them.
    install: MODELS,
    build: [['npm', 'run', 'docs:build']],
    index: '.vitepress/dist/ask-index.json',
    llms: '.vitepress/dist',
    dimensions: 512,
    linked: true,
    check: (dir, index) => {
      const out = join(dir, '.vitepress/dist');
      const problems = withoutReact(dir);
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

/** A file or folder in test/fixtures. */
function fixture(path) {
  return fileURLToPath(new URL(`../test/fixtures/${path}`, import.meta.url));
}

/** Adds the guides' `index` script, run before every build, to the site's package.json. */
function scripts(dir, index) {
  edit(dir, 'package.json', (text) => {
    const manifest = JSON.parse(text);
    manifest.scripts = { ...manifest.scripts, index, prebuild: 'npm run index' };
    return `${JSON.stringify(manifest, null, 2)}\n`;
  });
}

/** The guides' MCP route handler, importing the index from `index`. */
function mcpRoute(index) {
  return `import { createMcpHandler } from 'ondocs/server';
import index from ${index};

const handler = createMcpHandler({ index, siteName: 'the Acme docs' });

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
`;
}

/** The guides' Ask component, with the theme from `useTheme` in `themes`. */
function askComponent(themes) {
  return `'use client';
import { useEffect, useState } from 'react';
import { AskDialog } from 'ondocs/react';
import 'ondocs/react/styles.css';
import 'ondocs/embed/launcher.css';
import { useTheme } from ${themes};
import { useRouter } from 'next/navigation';

export function Ask() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  // next-themes knows the theme only once the page runs; until then, follow the system's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <AskDialog
      launcher
      shortcut="i"
      theme={mounted ? (resolvedTheme === 'dark' ? 'dark' : 'light') : undefined}
      suggestions={['How do I install it?']}
      onNavigate={(url, event) => {
        event.preventDefault();
        router.push(url);
      }}
    />
  );
}
`;
}

/**
 * What is wrong with the index's URLs next to the pages of the docs route `route` that `next
 * build` generated (in `.next/prerender-manifest.json`): each URL in the index must be one of
 * them, and each of them must be in the index.
 */
function nextRoutes(dir, index, route) {
  const manifest = JSON.parse(readFileSync(join(dir, '.next/prerender-manifest.json'), 'utf8'));
  const built = new Set(
    Object.entries(manifest.routes)
      .filter(([, prerendered]) => prerendered.srcRoute === route)
      .map(([path]) => decodeURI(path)),
  );
  const indexed = new Set(index.documents.map(({ url }) => decodeURI(url)));
  const problems = [];
  if (built.size === 0) problems.push(`next build generated no pages for ${route}`);
  for (const url of indexed) {
    if (!built.has(url)) problems.push(`the index has ${url}, which next build did not generate`);
  }
  for (const path of built) {
    if (!indexed.has(path)) problems.push(`next build generated ${path}, which the index lacks`);
  }
  return problems;
}

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
    // The dialog brings its own React, Radix and cmdk, so the guide installs none of them.
    // starlight-ondocs still names them as peers, which npm installs, so only ondocs/starlight's
    // site is checked for them.
    install: MODELS,
    build: [['npx', 'astro', 'build']],
    index: 'dist/ask-index.json',
    llms: 'dist',
    dimensions: 512,
    linked: true,
    ...(entry === 'ondocs/starlight' ? { check: (dir) => withoutReact(dir) } : {}),
  };
}

/**
 * What is wrong with a site that must build without React: any of the packages a React site's
 * dialog renders with that it has installed, so its build would not show the dialog needs none.
 */
function withoutReact(dir) {
  return ['react', 'react-dom', '@radix-ui/react-dialog', 'cmdk']
    .filter((name) => existsSync(join(dir, 'node_modules', name)))
    .map((name) => `${name} is installed, so the build does not show the dialog brings its own`);
}

/**
 * What is wrong with the links from the built pages to their `.md` copies: each indexed page,
 * where the build wrote it in `out`, must have `<link rel="alternate" type="text/markdown">` in
 * its `<head>`, to a copy that is in `copies`.
 */
function markdownLinks(out, copies, index) {
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
    const href = /<link rel="alternate" type="text\/markdown" href="([^"]+)"\s*\/?>/.exec(
      head,
    )?.[1];
    if (!href) {
      problems.push(`${file} does not link its .md copy`);
      continue;
    }
    const copy = decodeURI(new URL(href, 'http://site').pathname).replace(/^\//, '');
    if (!existsSync(join(copies, copy)))
      problems.push(`${file} links ${href}, which is not in the build`);
  }
  return problems;
}

function write(dir, file, content) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/**
 * Rewrites a scaffolded file, failing if the change did not apply (the template moved on): the
 * file must change and then include `marker`.
 */
function edit(dir, file, change, marker = 'ondocs') {
  const before = readFileSync(join(dir, file), 'utf8');
  const after = change(before);
  if (after === before || !after.includes(marker)) {
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
if (site.llms) {
  const llmsDir = join(dir, site.llms);
  for (const file of ['llms.txt', 'llms-full.txt']) {
    if (!existsSync(join(llmsDir, file))) problems.push(`the build wrote no ${site.llms}/${file}`);
  }
  const llmsTxt = existsSync(join(llmsDir, 'llms.txt'))
    ? readFileSync(join(llmsDir, 'llms.txt'), 'utf8')
    : '';
  // A destination may hold balanced parentheses, as a Nextra `(group)` folder's pages do.
  const links = [...llmsTxt.matchAll(/^- \[[^\]]*\]\(((?:[^()\s]|\([^()\s]*\))+\.md)\)/gm)].map(
    (match) => match[1],
  );
  if (links.length !== index.documents.length) {
    problems.push(
      `llms.txt links ${String(links.length)} .md pages, the index has ${String(index.documents.length)}`,
    );
  }
  for (const link of links) {
    const file = join(llmsDir, decodeURI(new URL(link, 'http://site').pathname).replace(/^\//, ''));
    if (!existsSync(file)) problems.push(`llms.txt links ${link}, which is not in ${site.llms}`);
  }
  if (site.linked)
    problems.push(...markdownLinks(join(dir, site.html ?? site.llms), llmsDir, index));
}
problems.push(...(site.check?.(dir, index) ?? []));
const strays = stub.requests.filter((request) => request !== 'POST /v1/embeddings');
if (stub.requests.length === 0) problems.push('the stub received no embedding request');
if (strays.length > 0) problems.push(`the stub received ${strays.join(', ')}`);
if (problems.length > 0) {
  console.error(`\n✗ ${name}: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(
  `\n✓ ${name}: ${site.index} has ${String(index.documents.length)} pages and ${String(index.chunks.length)} chunks embedded with ${MODEL} at ${String(site.dimensions)} dimensions, from ${String(stub.requests.length)} requests to the stub${site.llms ? `; ${site.llms}/llms.txt links a .md copy of each${site.linked ? ', and so does each page' : ''}` : ''}.`,
);
