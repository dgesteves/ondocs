// Builds what `ondocs init` writes for a host with that host's own tooling, offline and signed
// in to nothing, then asks it questions. A run makes a static docs site (a Docusaurus config and a
// built `build/` with an index of this repo's docs), installs ondocs from a packed tarball,
// runs `ondocs init --host <host>`, builds, serves or invokes the result. The astro-* recipes
// instead build an Astro site of this repo's docs with an SSR adapter and no route file, which the
// integration serves the endpoints for. Each then checks:
//
// - a docs question streams sources, then an answer from the model, then `finish`;
// - an off-topic question gets "I don't know", without a model call;
// - a CORS preflight gets a 204, and the MCP endpoint's search finds the page.
//
// The model is the OpenAI stub (./openai-stub.mjs): embeddings and a streamed answer, on
// 127.0.0.1. Nothing is deployed: Vercel's `vercel build`, Netlify's `netlify build --offline`
// and `netlify serve --offline`, and Wrangler's `--dry-run` and local `dev` run with a HOME of
// their own, so they see no credentials.
//
//   npm pack && node scripts/deploy-recipes.mjs <recipe> ondocs-x.y.z.tgz [dir]
//
// Recipes: vercel, netlify, cloudflare-pages, cloudflare-workers, github-pages (with OpenAI),
// workers-ai (the zero-key Worker template, in workerd), astro-node, astro-vercel,
// astro-cloudflare.
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
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { STUB_ANSWER, startOpenAIStub } from './openai-stub.mjs';

const VERSIONS = {
  vercel: 'vercel@61',
  wrangler: 'wrangler@4',
  netlify: 'netlify-cli@27',
  astro: 'astro@7',
};
const DOCS = new URL('../examples/nextjs/content/docs', import.meta.url);

/** Each recipe: the host init is run for, its config before init, and how to build and reach it. */
const RECIPES = {
  vercel: { host: 'vercel', files: { 'vercel.json': '{}\n' } },
  netlify: {
    host: 'netlify',
    files: { 'netlify.toml': '[build]\n  command = "echo built"\n  publish = "build"\n' },
  },
  'cloudflare-pages': {
    host: 'cloudflare',
    files: {
      'wrangler.toml':
        'name = "recipe-docs"\npages_build_output_dir = "./build"\ncompatibility_date = "2026-09-01"\n',
    },
  },
  'cloudflare-workers': {
    host: 'cloudflare',
    files: {
      'wrangler.jsonc':
        '{\n  // A static site on Workers.\n  "name": "recipe-docs",\n  "compatibility_date": "2026-09-01",\n  "assets": { "directory": "./build" }\n}\n',
    },
  },
  // The Worker init writes with OpenAI, as `wrangler dev` cannot run Workers AI offline; the
  // workers-ai recipe tests the zero-key Worker in workerd instead.
  'github-pages': {
    host: 'github-pages',
    provider: 'openai',
    files: {},
    scripts: { deploy: 'docusaurus deploy' },
  },
  'workers-ai': { template: true },
  'astro-node': { adapter: '@astrojs/node', call: "node({ mode: 'standalone' })", import: 'node' },
  'astro-vercel': { adapter: '@astrojs/vercel', call: 'vercel()', import: 'vercel' },
  'astro-cloudflare': {
    adapter: '@astrojs/cloudflare',
    call: 'cloudflare()',
    import: 'cloudflare',
  },
};

const [name = '', tarball = '', target] = process.argv.slice(2);
const recipe = RECIPES[name];
if (!recipe || !tarball) {
  console.error(
    `Usage: node scripts/deploy-recipes.mjs <${Object.keys(RECIPES).join('|')}> <tarball> [dir]`,
  );
  process.exit(2);
}
const dir = resolve(target ?? join(tmpdir(), `ondocs-recipe-${name}`));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// The host CLIs get a home of their own, with no credentials or tokens in it, and the same npm
// cache as everything else.
const home = join(dir, '.home');
// Vercel's update check expects its cache folder to exist (macOS and Linux places).
for (const cache of [
  'Library/Caches/com.vercel.cli/package-updates',
  '.cache/com.vercel.cli/package-updates',
]) {
  mkdirSync(join(home, cache), { recursive: true });
}
const isolated = {
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  npm_config_cache: process.env.npm_config_cache ?? join(homedir(), '.npm'),
  VERCEL_TELEMETRY_DISABLED: '1',
  NO_UPDATE_NOTIFIER: '1',
  NETLIFY_TELEMETRY_DISABLED: '1',
  WRANGLER_SEND_METRICS: 'false',
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  VERCEL_TOKEN: '',
  NETLIFY_AUTH_TOKEN: '',
  CI: '1',
};

/** Runs a command to completion, inheriting stdio. */
async function run(command, args, { cwd = dir, env = {} } = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(code)}`);
}

/** Starts a long-running command and waits until `url` answers; returns a stopper. */
async function serve(command, args, url, { cwd = dir, env = {} } = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')} &`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  };
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${command} exited with ${child.exitCode}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return stop;
    } catch {
      if (Date.now() > deadline) {
        stop();
        throw new Error(`${url} did not answer within 3 minutes`);
      }
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

/** A free port on 127.0.0.1. */
async function freePort() {
  const [port] = await freePorts(1);
  return port;
}

/** `count` different free ports on 127.0.0.1, all held open until each has been picked. */
async function freePorts(count) {
  const servers = Array.from({ length: count }, () => createServer());
  await Promise.all(
    servers.map((server) => new Promise((done) => server.listen(0, '127.0.0.1', done))),
  );
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  return ports;
}

/**
 * Starts `wrangler <args>` on 127.0.0.1, on a free port and with its inspector on another, and
 * waits until `path` answers; returns the port and a stopper. A port that was free when it was
 * picked can be taken before workerd binds it, as on CI once ("Address already in use"), so a
 * start that fails is tried once more, on new ports.
 */
async function serveWrangler(args, path, options) {
  for (let attempt = 1; ; attempt += 1) {
    const [port, inspector] = await freePorts(2);
    const flags = [
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
    ];
    try {
      const stop = await serve(
        'npx',
        [...args, ...flags],
        `http://127.0.0.1:${String(port)}${path}`,
        options,
      );
      return { port, stop };
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(`\n${error.message}; once more, on other ports.`);
    }
  }
}

/** Serves `root` as a static site on 127.0.0.1, as GitHub Pages would. */
async function staticSite(root) {
  const types = { '.html': 'text/html', '.json': 'application/json', '.txt': 'text/plain' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${String(server.address().port)}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

const problems = [];
const expect = (condition, problem) => {
  if (!condition) problems.push(problem);
};

/**
 * Asks the deployed-alike endpoints: `call(path, init)` returns their Response. `origin` is the
 * site's, for a Worker answering it across origins.
 */
async function exercise(call, { origin } = {}) {
  const headers = {
    'content-type': 'application/json',
    'x-forwarded-for': '203.0.113.7',
    ...(origin ? { origin } : {}),
  };
  const ask = async (question) => {
    const response = await call('/api/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({ question }),
    });
    return { response, text: await response.text() };
  };

  const answered = await ask('How do I deploy the ask endpoint to Netlify?');
  expect(answered.response.status === 200, `a docs question got HTTP ${answered.response.status}`);
  expect(answered.text.includes('"type":"source-url"'), 'a docs question streamed no sources');
  const streamed = [...answered.text.matchAll(/"delta":"([^"]*)"/g)].map((m) => m[1]).join('');
  expect(streamed === STUB_ANSWER, `a docs question streamed ${JSON.stringify(streamed)}`);
  expect(answered.text.includes('"type":"finish"'), 'a docs question did not finish');
  if (origin) {
    const allowed = answered.response.headers.get('access-control-allow-origin');
    expect(allowed === origin, `CORS allowed ${String(allowed)}, not the site's origin ${origin}`);
  }

  const refused = await ask('What is the capital of France?');
  expect(
    refused.response.status === 200,
    `an off-topic question got HTTP ${refused.response.status}`,
  );
  expect(refused.text.includes("I don't know"), 'an off-topic question was not refused');

  const preflight = await call('/api/ask', {
    method: 'OPTIONS',
    headers: { origin: origin ?? 'https://docs.example.com' },
  });
  expect(preflight.status === 204, `a preflight got HTTP ${preflight.status}`);

  const mcp = await call('/api/mcp', {
    method: 'POST',
    headers: { ...headers, accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'deploy Netlify function' } },
    }),
  });
  const searched = await mcp.text();
  expect(mcp.status === 200, `an MCP search got HTTP ${mcp.status}`);
  expect(searched.includes('/docs/deployment'), 'an MCP search did not find the deployment page');
}

const stub = await startOpenAIStub();
const model = {
  OPENAI_API_KEY: 'sk-recipe-check',
  OPENAI_BASE_URL: stub.url,
  AI_GATEWAY_API_KEY: '',
};
const stops = [];
try {
  if (recipe.template) await templateRecipe();
  else if (recipe.adapter) await astroRecipe();
  else await docusaurusRecipe();
} finally {
  for (const stop of stops) await stop();
  await stub.close();
}

/** A static Docusaurus-like site, the endpoint init writes for its host, built and asked. */
async function docusaurusRecipe() {
  // The site: a Docusaurus config for init to detect, and what `docusaurus build` would have written.
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'recipe-docs', private: true, scripts: recipe.scripts ?? {} }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'docusaurus.config.ts'),
    "export default { title: 'Recipe Docs', url: 'https://recipe.example.com', baseUrl: '/' };\n",
  );
  for (const [file, content] of Object.entries(recipe.files))
    writeFileSync(join(dir, file), content);
  mkdirSync(join(dir, 'build'), { recursive: true });
  writeFileSync(
    join(dir, 'build/index.html'),
    '<!doctype html><title>Recipe Docs</title><main><h1>Recipe Docs</h1></main>',
  );
  // What init's next steps say to install, @types/node included for the functions' types.
  await run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    resolve(tarball),
    'ai',
    '@ai-sdk/openai',
    '@types/node',
  ]);
  await run(
    'npx',
    [
      'ondocs',
      'index',
      DOCS.pathname,
      '--base-url',
      '/docs',
      '-e',
      'openai:text-embedding-3-small',
      '--dimensions',
      '512',
      '-o',
      'build/ask-index.json',
    ],
    { env: model },
  );
  await run('npx', [
    'ondocs',
    'init',
    '--host',
    recipe.host,
    ...(recipe.provider ? ['--provider', recipe.provider] : []),
    '--yes',
  ]);

  if (name === 'vercel') {
    mkdirSync(join(dir, '.vercel'), { recursive: true });
    writeFileSync(
      join(dir, '.vercel/project.json'),
      JSON.stringify({
        projectId: 'prj_recipe',
        orgId: 'team_recipe',
        settings: { framework: null, buildCommand: '', outputDirectory: 'build' },
      }),
    );
    await run(
      'npx',
      ['-y', VERSIONS.vercel, 'build', '--yes', '--global-config', join(home, 'vercel')],
      { env: isolated },
    );
    const func = join(dir, '.vercel/output/functions/api');
    for (const fn of ['ask', 'mcp']) {
      const config = JSON.parse(readFileSync(join(func, `${fn}.func/.vc-config.json`), 'utf8'));
      expect(
        config.filePathMap?.['build/ask-index.json'] === 'build/ask-index.json',
        `api/${fn}.func does not bundle build/ask-index.json`,
      );
    }
    // A Vercel Function runs with the project's root as its working directory.
    Object.assign(process.env, model);
    process.chdir(dir);
    const load = async (fn) => {
      const module = await import(pathToFileURL(join(func, `${fn}.func/api/${fn}.js`)).href);
      return module.default && typeof module.default === 'object' ? module.default : module;
    };
    const handlers = { '/api/ask': await load('ask'), '/api/mcp': await load('mcp') };
    await exercise((path, init) => {
      const handler = handlers[path]?.[init.method];
      if (!handler) return new Response(null, { status: 405 });
      return handler(new Request(`https://recipe.example.com${path}`, init));
    });
  } else if (name === 'netlify') {
    await run('npx', ['-y', VERSIONS.netlify, 'build', '--offline'], {
      env: { ...isolated, ...model },
    });
    // The zip each function deploys as, with the index in it (a file name in its directory).
    for (const fn of ['ask', 'mcp']) {
      const zip = readFileSync(join(dir, `.netlify/functions/${fn}.zip`));
      expect(
        zip.includes('build/ask-index.json'),
        `${fn}.zip does not bundle build/ask-index.json`,
      );
    }
    const port = await freePort();
    stops.push(
      await serve(
        'npx',
        ['-y', VERSIONS.netlify, 'serve', '--offline', '--port', String(port)],
        `http://127.0.0.1:${String(port)}/`,
        { env: { ...isolated, ...model } },
      ),
    );
    await exercise((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init));
  } else if (name === 'cloudflare-pages') {
    await run('npx', ['-y', VERSIONS.wrangler, 'pages', 'functions', 'build', '--outdir', 'out'], {
      env: isolated,
    });
    const { port, stop } = await serveWrangler(
      [
        '-y',
        VERSIONS.wrangler,
        'pages',
        'dev',
        '--binding',
        `OPENAI_API_KEY=${model.OPENAI_API_KEY}`,
        '--binding',
        `OPENAI_BASE_URL=${model.OPENAI_BASE_URL}`,
      ],
      '/',
      { env: isolated },
    );
    stops.push(stop);
    await exercise((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init));
  } else if (name === 'cloudflare-workers') {
    await run('npx', ['-y', VERSIONS.wrangler, 'deploy', '--dry-run', '--outdir', 'out'], {
      env: isolated,
    });
    const { port, stop } = await serveWrangler(
      [
        '-y',
        VERSIONS.wrangler,
        'dev',
        '--var',
        `OPENAI_API_KEY:${model.OPENAI_API_KEY}`,
        '--var',
        `OPENAI_BASE_URL:${model.OPENAI_BASE_URL}`,
      ],
      '/',
      { env: isolated },
    );
    stops.push(stop);
    await exercise((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init));
  } else {
    // The site on its static host, and the Worker init wrote, which reads the index from it.
    const site = await staticSite(join(dir, 'build'));
    stops.push(site.close);
    const worker = join(dir, 'ondocs-worker');
    await run('npm', ['install', '--no-audit', '--no-fund', resolve(tarball)], { cwd: worker });
    await run('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', 'out'], {
      cwd: worker,
      env: isolated,
    });
    const { port, stop } = await serveWrangler(
      [
        'wrangler',
        'dev',
        '--var',
        `SITE_URL:${site.url}`,
        '--var',
        `OPENAI_API_KEY:${model.OPENAI_API_KEY}`,
        '--var',
        `OPENAI_BASE_URL:${model.OPENAI_BASE_URL}`,
      ],
      '/',
      { cwd: worker, env: isolated },
    );
    stops.push(stop);
    await exercise((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init), {
      origin: site.url,
    });
  }
}

/**
 * The zero-key Worker, templates/cloudflare-worker (what init writes for GitHub Pages), as a user
 * gets it from `npm create cloudflare`: typechecked, bundled by `wrangler deploy --dry-run`, and
 * its own tests run in workerd, with stand-ins for the site and the AI binding. `wrangler dev`
 * cannot run Workers AI without an account, so this is as far as offline goes.
 */
async function templateRecipe() {
  cpSync(new URL('../templates/cloudflare-worker', import.meta.url), dir, {
    recursive: true,
    filter: (source) => !/[\\/](?:node_modules|\.wrangler)(?:[\\/]|$)/.test(source),
  });
  // The package as it is about to be released, in place of the published version.
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  manifest.dependencies.ondocs = `file:${resolve(tarball)}`;
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await run('npm', ['install', '--no-audit', '--no-fund']);
  await run('npx', ['tsc']);
  await run('npx', ['tsc', '-p', 'test']);
  await run('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', 'out'], { env: isolated });
  await run('npx', ['vitest', 'run'], { env: isolated });
}

/**
 * An Astro site of this repo's docs, with an SSR adapter and no route file: init says there is
 * nothing to write, and the integration serves the endpoints through the adapter.
 */
async function astroRecipe() {
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'recipe-docs', private: true, type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'astro.config.mjs'),
    [
      `import ${recipe.import} from '${recipe.adapter}';`,
      "import ondocs from 'ondocs/astro';",
      "import { defineConfig } from 'astro/config';",
      '',
      'export default defineConfig({',
      "  site: 'https://recipe.example.com',",
      `  adapter: ${recipe.call},`,
      "  integrations: [ondocs({ embedding: 'openai:text-embedding-3-small', dimensions: 512 })],",
      '});',
      '',
    ].join('\n'),
  );
  mkdirSync(join(dir, 'src/layouts'), { recursive: true });
  writeFileSync(
    join(dir, 'src/layouts/Doc.astro'),
    '---\nconst { frontmatter } = Astro.props;\n---\n<html lang="en"><head><meta charset="utf-8" /><title>{frontmatter.title}</title></head><body><main><h1>{frontmatter.title}</h1><slot /></main></body></html>\n',
  );
  mkdirSync(join(dir, 'src/pages/docs'), { recursive: true });
  for (const file of readdirSync(DOCS).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(new URL(file, `${DOCS.href}/`), 'utf8');
    writeFileSync(
      join(dir, 'src/pages/docs', file),
      text.replace(/^---\n/, '---\nlayout: ../../layouts/Doc.astro\n'),
    );
  }
  // No React, Radix or cmdk: the integration's dialog brings its own, as the Astro guide says.
  await run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    resolve(tarball),
    'ai',
    '@ai-sdk/openai',
    VERSIONS.astro,
    recipe.adapter,
  ]);
  for (const name of ['react', 'react-dom', '@radix-ui/react-dialog', 'cmdk']) {
    expect(
      !existsSync(join(dir, 'node_modules', name)),
      `${name} is installed, so the build does not show the dialog brings its own`,
    );
  }
  const before = readdirSync(dir).sort().join();
  await run('npx', ['ondocs', 'init']);
  expect(
    readdirSync(dir).sort().join() === before,
    'init wrote files for an Astro site with an adapter',
  );
  await run('npx', ['astro', 'build'], {
    env: { ...isolated, ...model, ASTRO_TELEMETRY_DISABLED: '1' },
  });

  if (recipe.adapter === '@astrojs/node') {
    const port = await freePort();
    stops.push(
      await serve('node', ['dist/server/entry.mjs'], `http://127.0.0.1:${String(port)}/docs/cli/`, {
        env: { ...model, HOST: '127.0.0.1', PORT: String(port) },
      }),
    );
    await exercise((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init));
  } else if (recipe.adapter === '@astrojs/vercel') {
    // The function, invoked as Vercel invokes it; its fetches of the site's own files are
    // answered from .vercel/output/static, as Vercel's CDN would.
    const output = join(dir, '.vercel/output');
    expect(
      existsSync(join(output, 'static/ask-index.json')),
      'the index is not in .vercel/output/static',
    );
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.host !== 'recipe.example.com') return realFetch(input, init);
      const file = join(output, 'static', decodeURIComponent(url.pathname));
      return Promise.resolve(
        existsSync(file) ? new Response(readFileSync(file)) : new Response(null, { status: 404 }),
      );
    };
    Object.assign(process.env, model);
    const entry = (
      await import(
        pathToFileURL(join(output, 'functions/_render.func/.vercel/output/server/entry.mjs')).href
      )
    ).default;
    await exercise((path, init) =>
      entry.fetch(new Request(`https://recipe.example.com${path}`, init)),
    );
    globalThis.fetch = realFetch;
  } else {
    const { port, stop } = await serveWrangler(
      [
        'wrangler',
        'dev',
        '-c',
        'dist/server/wrangler.json',
        '--var',
        `OPENAI_API_KEY:${model.OPENAI_API_KEY}`,
        '--var',
        `OPENAI_BASE_URL:${model.OPENAI_BASE_URL}`,
      ],
      '/docs/cli/',
      { env: isolated },
    );
    stops.push(stop);
    await exercise((path, init) => fetch(`http://127.0.0.1:${String(port)}${path}`, init));
  }
}

const strays = stub.requests.filter(
  (request) => request !== 'POST /v1/embeddings' && request !== 'POST /v1/responses',
);
if (!recipe.template) {
  expect(stub.requests.includes('POST /v1/responses'), 'the endpoint never called the model');
}
expect(strays.length === 0, `the stub received ${strays.join(', ')}`);
if (problems.length > 0) {
  console.error(`\n✗ ${name}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  recipe.template
    ? `\n✓ ${name}: the template typechecked, bundled with wrangler deploy --dry-run, and passed its tests in workerd.`
    : `\n✓ ${name}: ${recipe.adapter ? `the integration's endpoints (${recipe.adapter}, no route file)` : "init's endpoints"} built with the host's tooling and answered (sources, a streamed answer, a refusal, a preflight, an MCP search), with ${String(stub.requests.length)} requests to the stub.`,
);
process.exit(0);
