// Astro and Starlight setups that built cleanly and could only fail: a static build whose dialog
// posts to an endpoint nothing serves, the Starlight plugin in Astro's integrations (where
// `npx astro add starlight-ondocs` puts it), and, with an adapter and `base`, the site's own route
// files at the default paths.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AstroIntegration } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ondocs from '../src/astro';
import { main } from '../src/cli/main';
import starlightOndocs from '../src/starlight';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-astro-silent-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('ASK_ENDPOINT', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function write(files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** The Astro integration the Starlight plugin adds, for a Starlight config. */
function starlightIntegration(options: Parameters<typeof starlightOndocs>[0] = {}) {
  let added: AstroIntegration | undefined;
  const setup = starlightOndocs({ embedding: 'mock', ...options }).hooks[
    'config:setup'
  ] as unknown as (options: unknown) => void;
  setup({
    config: { title: 'Acme Docs' },
    astroConfig: { root: pathToFileURL(`${root}/`) },
    addIntegration: (integration: AstroIntegration) => {
      added = integration;
    },
  });
  if (!added) throw new Error('the plugin added no integration');
  return added;
}

/**
 * Runs `astro build`'s hooks over one built page, with an adapter when one is named, and returns
 * what the integration logged and the endpoint the dialog posts to.
 */
async function build(
  integration: AstroIntegration,
  { adapter, base = '/' }: { adapter?: string; base?: string } = {},
) {
  const html =
    '<!DOCTYPE html><html lang="en"><head><title>Setup | Acme Docs</title></head><body><main data-pagefind-body><h1>Setup</h1><p>Install it first.</p></main></body></html>';
  const outDir = join(root, adapter ? 'dist/client' : 'dist');
  await mkdir(join(outDir, 'setup'), { recursive: true });
  await writeFile(join(outDir, 'setup/index.html'), html);
  const info: string[] = [];
  const warn: string[] = [];
  const logger = {
    info: (message: string) => info.push(message),
    warn: (message: string) => warn.push(message),
  };
  let script = '';
  const hooks = integration.hooks as Record<string, (options: unknown) => unknown>;
  const config = {
    root: pathToFileURL(`${root}/`),
    srcDir: pathToFileURL(`${root}/src/`),
    base,
    trailingSlash: 'ignore',
    build: { format: 'directory' },
    integrations: [{ name: 'ondocs' }],
    ...(adapter ? { adapter: { name: adapter, hooks: {} } } : {}),
  };
  await hooks['astro:config:setup']?.({
    config,
    command: 'build',
    injectScript: (stage: string, content: string) => {
      if (stage === 'page') script = content;
    },
    injectRoute: vi.fn(),
    updateConfig: vi.fn(),
    logger,
  });
  await hooks['astro:config:done']?.({ config, logger });
  await hooks['astro:build:done']?.({
    dir: pathToFileURL(`${outDir}/`),
    pages: [{ pathname: 'setup/' }],
    assets: new Map(),
    logger,
  });
  const endpoint = /"endpoint":("[^"]*")/.exec(script)?.[1];
  return { info, warn, endpoint: endpoint ? (JSON.parse(endpoint) as string) : undefined };
}

const UNSERVED =
  'The dialog posts to /api/ask, which this static build does not serve, so every question gets a 404 once the site is deployed. Run `npx ondocs init` to write the endpoint for your host, add an SSR adapter for the integration to serve it, or set `endpoint` to where yours answers.';

describe('a static build whose dialog posts to /api/ask', () => {
  it('warns that the build does not serve it, in Starlight and in Astro', async () => {
    expect((await build(starlightIntegration())).warn).toContain(UNSERVED);
    expect((await build(ondocs({ embedding: 'mock' }))).warn).toContain(UNSERVED);
  });

  it('says nothing with an adapter, with endpoint set, or with ASK_ENDPOINT', async () => {
    const quiet = async (result: Promise<{ warn: string[] }>) => {
      expect((await result).warn).not.toContain(UNSERVED);
    };
    await quiet(
      build(starlightIntegration({ route: { model: 'mock' } }), { adapter: '@astrojs/node' }),
    );
    await quiet(build(starlightIntegration({ endpoint: '/api/ask' })));
    await quiet(build(starlightIntegration({ endpoint: 'https://ask.acme.dev/api/ask' })));
    vi.stubEnv('ASK_ENDPOINT', 'http://localhost:8787/api/ask');
    await quiet(build(starlightIntegration()));
  });

  // The endpoint files `ondocs init` writes on these hosts answer /api/ask on the site's origin.
  // On GitHub Pages, init says to set `endpoint` to the Worker's URL instead.
  it.each([
    ['Vercel', 'vercel', {}],
    ['Netlify', 'netlify', {}],
    ['Cloudflare Pages', 'cloudflare', {}],
    [
      'a Cloudflare Worker',
      'cloudflare',
      { 'wrangler.jsonc': '{\n  "name": "acme",\n  "assets": { "directory": "./dist" }\n}\n' },
    ],
  ])('says nothing once ondocs init has written the endpoint for %s', async (_, host, files) => {
    await write({
      'package.json': JSON.stringify({
        name: 'acme-docs',
        dependencies: { astro: '7', '@astrojs/starlight': '0.42' },
      }),
      'astro.config.mjs':
        "import starlight from '@astrojs/starlight';\nexport default { site: 'https://docs.acme.dev', integrations: [starlight({ title: 'Acme' })] };\n",
      ...files,
    });
    const code = await main(['init', '--host', host], {
      cwd: root,
      env: {},
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(code).toBe(0);
    expect((await build(starlightIntegration())).warn).not.toContain(UNSERVED);
  });
});

describe('the Starlight plugin in Astro’s integrations', () => {
  /** Runs `astro:config:setup` of each integration, as Astro does with what it is given. */
  const setUp = (integrations: { hooks: Record<string, unknown> }[]) => {
    for (const { hooks } of integrations) {
      (hooks['astro:config:setup'] as ((options: unknown) => void) | undefined)?.({});
    }
  };

  it('stops the build and says to move it into Starlight’s plugins', () => {
    expect(() => {
      setUp([starlightOndocs()]);
    }).toThrow(
      "ondocs/starlight is a Starlight plugin, so in Astro's integrations it does nothing: move ondocs() into Starlight's plugins, as in integrations: [starlight({ title: 'Docs', plugins: [ondocs()] })]. npx astro add puts it in integrations. On an Astro site without Starlight, use ondocs/astro instead. See https://ondocs.vercel.app/docs/astro#add-it-to-starlight",
    );
  });

  it('still sets up in Starlight’s plugins, adding the integration', () => {
    const plugin = starlightOndocs();
    expect(Object.keys(plugin.hooks)).toContain('config:setup');
    expect(starlightIntegration().name).toBe('ondocs');
  });
});

describe('an adapter, base and the site’s own routes at the default paths', () => {
  const integration = (options: Parameters<typeof ondocs>[0] = {}) =>
    ondocs({ embedding: 'mock', route: { model: 'mock' }, ...options });
  const route = 'export const POST = () => new Response();';

  it('posts under base when the site’s files answer both paths', async () => {
    await write({ 'src/pages/api/ask.ts': route, 'src/pages/api/mcp.ts': route });
    const both = await build(integration(), { adapter: '@astrojs/node', base: '/docs/' });
    expect(both.endpoint).toBe('/docs/api/ask');
    expect(both.info).toContain(
      `${join('src', 'pages', 'api', 'ask.ts')} answers /docs/api/ask, so the integration does not serve it.`,
    );
  });

  it('posts under base with route.mcp: false or route: false and the site’s ask route', async () => {
    await write({ 'src/pages/api/ask.ts': route });
    const noMcp = integration({ route: { model: 'mock', mcp: false } });
    expect((await build(noMcp, { adapter: '@astrojs/node', base: '/docs/' })).endpoint).toBe(
      '/docs/api/ask',
    );
    const off = integration({ route: false });
    expect((await build(off, { adapter: '@astrojs/node', base: '/docs/' })).endpoint).toBe(
      '/docs/api/ask',
    );
  });

  it('posts where it did otherwise', async () => {
    // The integration's own route, under base, as before.
    expect(
      (await build(integration(), { adapter: '@astrojs/node', base: '/docs/' })).endpoint,
    ).toBe('/docs/api/ask');
    // route: false and no route file: whatever answers is not the site's, so not under base.
    expect(
      (await build(integration({ route: false }), { adapter: '@astrojs/node', base: '/docs/' }))
        .endpoint,
    ).toBe('/api/ask');
    // A static site's endpoint is the host's function, at the root.
    expect((await build(integration(), { base: '/docs/' })).endpoint).toBe('/api/ask');
    // endpoint, when set, is where it posts.
    expect(
      (
        await build(integration({ endpoint: 'https://ask.acme.dev/api/ask' }), {
          adapter: '@astrojs/node',
          base: '/docs/',
        })
      ).endpoint,
    ).toBe('https://ask.acme.dev/api/ask');
  });
});
