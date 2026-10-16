// withOndocs takes a VitePress config in each shape its config file may export: an object, a
// Promise of one (as @vite-pwa/vitepress's withPwa returns), or a function of `{ mode, command }`.
// Before, it spread a Promise or a function into an object, which dropped the whole config, and
// the build failed with an error about the site's own files.
import { defineConfig } from 'vitepress';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { withOndocs } from '../src/vitepress';

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('ASK_ENDPOINT', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const config = defineConfig({
  title: 'Acme',
  vite: { plugins: [{ name: 'own-plugin' }], resolve: { alias: { '@components': '/theme' } } },
});

/** A wrapper like withPwa from @vite-pwa/vitepress: async, adding a Vite plugin of its own. */
async function withPwa<Config extends typeof config>(wrapped: Config): Promise<Config> {
  await Promise.resolve();
  return {
    ...wrapped,
    vite: { ...wrapped.vite, plugins: [...(wrapped.vite?.plugins ?? []), { name: 'pwa' }] },
  };
}

/** The config's title, alias and Vite plugins' names, with what withOndocs adds. */
const kept = (wrapped: typeof config) => ({
  title: wrapped.title,
  alias: wrapped.vite?.resolve?.alias,
  plugins: (wrapped.vite?.plugins as { name: string }[]).map((plugin) => plugin.name),
  buildEnd: typeof wrapped.buildEnd,
  transformHtml: typeof wrapped.transformHtml,
});

const WRAPPED = {
  title: 'Acme',
  alias: { '@components': '/theme' },
  plugins: ['own-plugin', 'ondocs', 'ondocs:quiet-use-client'],
  buildEnd: 'function',
  transformHtml: 'function',
};

describe('withOndocs over each shape of config', () => {
  it('awaits a Promise of the config, and returns a Promise of it wrapped', async () => {
    const wrapped = withOndocs(Promise.resolve(config));
    expect(wrapped).toBeInstanceOf(Promise);
    expectTypeOf(wrapped).toEqualTypeOf<Promise<typeof config>>();
    expect(kept(await wrapped)).toEqual(WRAPPED);
  });

  it('wraps what an async wrapper such as withPwa returns, keeping its plugins', async () => {
    expect(kept(await withOndocs(withPwa(config)))).toEqual({
      ...WRAPPED,
      plugins: ['own-plugin', 'pwa', 'ondocs', 'ondocs:quiet-use-client'],
    });
    // Inside the wrapper, as before.
    expect(kept(await withPwa(withOndocs(config)))).toEqual({
      ...WRAPPED,
      plugins: ['own-plugin', 'ondocs', 'ondocs:quiet-use-client', 'pwa'],
    });
  });

  it('returns a function of VitePress’s env for a function, sync or async', async () => {
    const env = { mode: 'production', command: 'build' };
    const sync = withOndocs(({ mode }) => ({ ...config, title: `Acme ${mode}` }));
    expect(typeof sync).toBe('function');
    expect(kept(await sync(env))).toEqual({ ...WRAPPED, title: 'Acme production' });
    const viaPwa = withOndocs(({ mode }) => withPwa({ ...config, title: `Acme ${mode}` }));
    expect(kept(await viaPwa(env))).toEqual({
      ...WRAPPED,
      title: 'Acme production',
      plugins: ['own-plugin', 'pwa', 'ondocs', 'ondocs:quiet-use-client'],
    });
  });

  it('checks its own options at once, and those that need the config as it resolves', async () => {
    const both = { embedding: 'mock', embeddingModel: null } as const;
    expect(() => withOndocs(Promise.resolve(config), both)).toThrow(
      /pass `embedding` or `embeddingModel`, not both/,
    );
    expect(() => withOndocs(() => config, both)).toThrow(
      /pass `embedding` or `embeddingModel`, not both/,
    );
    // `mcp` as a path needs the site's URL, from the config.
    await expect(withOndocs(Promise.resolve(config), { mcp: '/api/mcp' })).rejects.toThrow(
      /the site's URL is needed.*siteUrl option, or sitemap.hostname/,
    );
    const site = { ...config, sitemap: { hostname: 'https://acme.dev' } };
    await expect(withOndocs(Promise.resolve(site), { mcp: '/api/mcp' })).resolves.toMatchObject({
      title: 'Acme',
    });
  });
});
