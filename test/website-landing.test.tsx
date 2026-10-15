// @vitest-environment jsdom
// The website's home page (examples/nextjs/app/(home)/page.tsx), as it renders: it leads with what
// ondocs is, says only what was measured, with the scope it was measured in, and links the live
// demos, as the docs home does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import GithubSlugger from 'github-slugger';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMOS, HOME_DESCRIPTION, HOME_TITLE, MCP_URL } from '../examples/nextjs/lib/site';
import { VERSION } from '../examples/nextjs/lib/version';

const site = join(import.meta.dirname, '../examples/nextjs');
const { navigation } = vi.hoisted(() => {
  // The site's own next, as its components import it, which this folder can't resolve by name.
  const { createRequire } = process.getBuiltinModule('node:module');
  const require = createRequire(`${import.meta.dirname}/../examples/nextjs/package.json`);
  return { navigation: require.resolve('next/navigation') };
});

vi.mock(navigation, () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }));

// What the page asks the site's own endpoint, MCP server and package for while it builds: the
// tests run before the package is built, and without the site's index.
vi.mock('../examples/nextjs/lib/sample-answer', () => ({
  sampleAnswer: () => Promise.resolve(null),
}));
vi.mock('../examples/nextjs/lib/mcp-sample', () => ({ mcpSample: () => Promise.resolve(null) }));
// The script tag's size is measured from the package's build; the bundle size table is read as
// the site reads it.
vi.mock('../examples/nextjs/lib/sizes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../examples/nextjs/lib/sizes')>()),
  gzippedSize: () => '1.0 KB',
}));
vi.mock('../examples/nextjs/lib/ai', () => ({ mode: 'mock' }));
vi.mock('../examples/nextjs/components/landing/hero-demo', () => ({ HeroDemo: () => null }));
// An async server component, which renderToStaticMarkup can't wait for, and not what this file
// checks.
vi.mock('../examples/nextjs/components/mcp-install', () => ({ McpInstall: () => null }));

afterEach(() => {
  document.body.innerHTML = '';
});

// Imported by path, so the typecheck does not follow it to the site's index, which only its build
// writes.
const homePath = 'app/(home)/page.tsx';

/** The home page as the site serves it. */
async function home() {
  const { default: Home } = (await import(/* @vite-ignore */ `../examples/nextjs/${homePath}`)) as {
    default: () => Promise<ReactElement>;
  };
  // The site reads its own files, such as the benchmarks page, from where it builds.
  vi.spyOn(process, 'cwd').mockReturnValue(site);
  document.body.innerHTML = renderToStaticMarkup(await Home());
  return document.body;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const words = (value: string) => value.split(/\s+/).filter(Boolean).length;

describe('the home page’s first screen', () => {
  it('leads with what it is: open-source Ask AI, with an MCP server for agents', async () => {
    const hero = (await home()).querySelector('.hero')!;
    expect(text(hero.querySelector('h1'))).toBe('Open-source Ask AI for your docs.');
    const lead = text(hero.querySelector('.hero-lead'));
    expect(lead).toContain('an MCP server for coding agents');
    // Starlight first: it has no Ask AI of its own.
    expect(lead).toContain('Starlight, Docusaurus or VitePress');
    expect(HOME_TITLE).toBe('ondocs: open-source Ask AI and an MCP server for your docs');
    expect(HOME_DESCRIPTION).toMatch(/^Open-source Ask AI for your docs: /);
  });

  it('says it in 45 words or fewer, with no version and no install command competing', async () => {
    const hero = (await home()).querySelector('.hero')!;
    expect(
      words(text(hero.querySelector('h1'))) + words(text(hero.querySelector('.hero-lead'))),
    ).toBeLessThanOrEqual(45);
    expect(text(hero.querySelector('.hero-badge'))).toBe('Open source · MIT');
    // The version is in the footer only.
    expect(text(hero)).not.toContain(VERSION);
    expect(text(hero)).not.toContain('npm i');
    // What its copy buttons copy is a config line, an agent's command or the MCP URL: never an
    // install command standing in for the whole setup.
    for (const button of hero.querySelectorAll('[data-copy]')) {
      expect(button.getAttribute('data-copy') ?? '').not.toMatch(/^(npm|pnpm|yarn|bun) /);
    }
  });

  it('leads with Get started, then the live Starlight demo, with the site’s own Ask beside them', async () => {
    const actions = (await home()).querySelector('.hero-actions')!;
    expect(
      [...actions.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href'), a.className]),
    ).toEqual([
      ['Get started', '/docs/getting-started', 'button button-primary'],
      ['Try the live demo', 'https://ondocs-starlight.vercel.app', 'button button-secondary'],
    ]);
    const ask = actions.querySelector('button')!;
    expect(text(ask.querySelector('.ask-button-text'))).toBe('Ask these docs');
    expect(ask.className).toContain('button-ghost');
  });

  it('puts a framework picker under Get started: Starlight first, each with its line and its live demo', async () => {
    const hero = (await home()).querySelector('.hero')!;
    const picker = hero.querySelector('.picker')!;
    const getStarted = hero.querySelector('.hero-actions .button-primary')!;
    expect(
      getStarted.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(text(picker.querySelector('.picker-label'))).toBe('Add it to');
    const tabs = [...picker.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => text(tab))).toEqual([
      'Starlight',
      'Docusaurus',
      'VitePress',
      'Next.js',
      'Any site',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    const panels = [...picker.querySelectorAll('[role="tabpanel"]')].map((panel) => ({
      file: text(panel.querySelector('.code-label')),
      code: panel.querySelector('pre')?.textContent ?? '',
      demos: [...panel.querySelectorAll('.picker-links a')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((href) => href.startsWith('https://')),
      hidden: panel.hasAttribute('hidden'),
    }));
    expect(panels.map(({ file }) => file)).toEqual([
      'astro.config.mjs',
      'docusaurus.config.ts',
      '.vitepress/config.mts',
      'app/api/ask/route.ts',
      'Any page',
    ]);
    const lines = [
      'plugins: [ondocs()]',
      "plugins: ['ondocs/docusaurus']",
      'export default withOndocs(',
      'export const POST = createAskHandler(',
      '/dist/embed.global.js',
    ];
    panels.forEach(({ code }, i) => {
      expect(code).toContain(lines[i]);
      // The line and its import: three lines at most.
      expect(code.trimEnd().split('\n').length).toBeLessThanOrEqual(3);
    });
    // VitePress's line calls defineConfig, so it imports it too, as the VitePress guide does.
    expect(panels[2]?.code).toContain("import { defineConfig } from 'vitepress';");
    expect(panels.map(({ demos }) => demos)).toEqual([...DEMOS.map(({ href }) => [href]), [], []]);
    expect(panels.map(({ hidden }) => hidden)).toEqual([false, true, true, true, true]);
  });

  it('has a line for coding agents: Cursor, VS Code, Claude Code and Codex, and the MCP URL', async () => {
    const strip = (await home()).querySelector('.hero .agent-strip')!;
    expect(text(strip.querySelector('.agent-strip-label'))).toBe('For coding agents:');
    const chips = [...strip.querySelectorAll('.agent-chip')];
    expect(chips.map((chip) => text(chip))).toEqual(['Cursor', 'VS Code', 'Claude Code', 'Codex']);
    const [cursor, vscode, claudeCode, codex] = chips;
    expect(cursor?.getAttribute('href')).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=ondocs&config=/,
    );
    expect(vscode?.getAttribute('href')).toMatch(/^vscode:mcp\/install\?/);
    expect(claudeCode?.getAttribute('data-copy')).toBe(
      'claude mcp add --transport http ondocs https://ondocs.vercel.app/api/mcp',
    );
    // As Codex CLI 0.163.0 takes a streamable HTTP server.
    expect(codex?.getAttribute('data-copy')).toBe(
      'codex mcp add ondocs --url https://ondocs.vercel.app/api/mcp',
    );
    expect(text(strip.querySelector('.agent-strip-url code'))).toBe(MCP_URL);
    expect(strip.querySelector('.agent-strip-url [data-copy]')?.getAttribute('data-copy')).toBe(
      MCP_URL,
    );
  });
});

describe('the home page’s proof row', () => {
  const items = async () =>
    [...(await home()).querySelectorAll('.hero .proof li')].map((li) => ({
      text: text(li),
      links: [...li.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''),
    }));
  const docs = (slug: string) => readFileSync(join(site, 'content/docs', `${slug}.md`), 'utf8');

  it('quotes the most JavaScript ondocs adds to a page, from the benchmarks page’s table', async () => {
    // Each row's "With ondocs" less "The site on its own", in KB gzipped.
    const added = [
      ...docs('benchmarks').matchAll(/^\| [^|]+\|\s*([\d.]+)(?: KB)? \|\s*([\d.]+) KB \|/gm),
    ].map(([, own, withOndocs]) => Number(withOndocs) - Number(own));
    expect(added.length).toBeGreaterThanOrEqual(3);
    const [first] = await items();
    expect(first).toEqual({
      text: `Up to ${Math.max(...added).toFixed(1)} KB of JavaScript per page. The dialog loads on first use.`,
      links: ['/docs/benchmarks#bundle-size'],
    });
  });

  it('says what every ask endpoint ondocs init writes has: a rate limit, a daily budget and the answer cache', async () => {
    const templates = await import('../src/cli/init-templates');
    const acme = {
      name: 'Acme Docs',
      indexFile: 'build/ask-index.json',
      indexPath: '/ask-index.json',
      url: 'https://acme.dev/docs',
    };
    const versions = {
      ondocs: '^1.0.0',
      ai: '^1.0.0',
      openai: '^1.0.0',
      workersAi: '^1.0.0',
      wrangler: '^1.0.0',
      typescript: '^1.0.0',
      workersTypes: '^1.0.0',
    };
    // Every template init writes from, with the MCP endpoint, which it writes unless --no-mcp.
    const written = [
      ...templates.vercelFiles(acme, true),
      ...templates.netlifyFiles(acme, true),
      ...templates.cloudflarePagesFiles(acme, true),
      ...templates.cloudflareWorkerFiles(acme, true),
      ...(['vercel', 'netlify', 'cloudflare'] as const).flatMap((host) =>
        templates.nextFiles(acme, host, 'app', true),
      ),
      ...(['workers-ai', 'openai'] as const).flatMap((provider) =>
        templates.standaloneWorkerFiles(acme, true, versions, provider),
      ),
    ];
    // Each handler's options: from its call to the next handler's, or to the end of the file.
    const handlers = written.flatMap(({ path, content }) =>
      content
        .split(/(?=create(?:Ask|Mcp)Handler\()/)
        .slice(1)
        .map((options) => ({ path, ask: options.startsWith('createAsk'), options })),
    );
    const ask = handlers.filter((handler) => handler.ask);
    const mcp = handlers.filter((handler) => !handler.ask);
    expect(ask).toHaveLength(9);
    expect(mcp).toHaveLength(9);
    for (const { path, options } of ask) {
      expect(options, path).toMatch(/rateLimit: \w/);
      expect(options, path).toMatch(/budget: \{ requestsPerDay: [\d_]+, tokensPerDay: [\d_]+ \}/);
      expect(options, path).toContain('answerCache: true');
    }
    // The MCP endpoint calls no model, so it has a rate limit and nothing to budget or cache: the
    // item names the ask endpoint.
    for (const { path, options } of mcp) {
      expect(options, path).toMatch(/rateLimit: \w/);
      expect(options, path).not.toMatch(/budget|answerCache/);
    }
    expect((await items())[1]).toEqual({
      text: 'Rate limit, daily budget and answer cache in every ask endpoint ondocs init writes.',
      links: ['/docs/deployment#write-the-endpoint-with-init'],
    });
  });

  it('says agent search calls no model only by default, and links the official client’s test', async () => {
    const [, , search, client] = await items();
    expect(search?.text).toBe('Agent search calls no model, by default.');
    expect(client).toEqual({
      text: 'MCP checked in CI with the official TypeScript client.',
      links: ['https://github.com/dgesteves/ondocs/blob/main/test/mcp-client.test.ts'],
    });
    expect(readFileSync(join(import.meta.dirname, 'mcp-client.test.ts'), 'utf8')).toContain(
      "from '@modelcontextprotocol/client'",
    );
  });

  it('links each live demo', async () => {
    expect((await items())[4]).toEqual({
      text: 'Live on Starlight, Docusaurus and VitePress.',
      links: DEMOS.map(({ href }) => href),
    });
  });

  it('links only to sections that exist', async () => {
    for (const { links } of await items()) {
      for (const href of links.filter((link) => link.startsWith('/docs/'))) {
        const [path = '', anchor = ''] = href.split('#');
        const slugger = new GithubSlugger();
        const anchors = [...docs(path.slice('/docs/'.length)).matchAll(/^#{2,3} (.+)$/gm)].map(
          ([, heading]) => slugger.slug(heading ?? ''),
        );
        expect(anchors, href).toContain(anchor);
      }
    }
  });
});

describe('the home page’s numbers', () => {
  const tiles = async () =>
    [...(await home()).querySelectorAll('.numbers .number')].map((tile) => ({
      value: text(tile.querySelector('.number-value')),
      label: text(tile.querySelector('.number-label')),
      note: text(tile.querySelector('dd')),
      links: [...tile.querySelectorAll('dd a')].map((a) => a.getAttribute('href')),
    }));

  it('say the 22 agent searches are ones we wrote, next to the same needs asked as a person asks', async () => {
    const numbers = await tiles();
    // test/corpus.test.ts: 22 of 22 queries and 20 of 22 questions find the page in the top three.
    expect(numbers.find((tile) => tile.value === '22 / 22')).toMatchObject({
      label: 'agent-style searches we wrote, with the right page in the top three',
      links: ['https://github.com/dgesteves/ondocs/blob/main/test/corpus.test.ts'],
    });
    const asked = numbers.find((tile) => tile.value === '20 / 22');
    expect(asked?.label).toBe('the same needs, asked as a person asks');
    // Real titles score far lower: 28 of 94 in the top three, keyword-only, on the same docs.
    expect(asked?.note).toMatch(/^Questions we wrote too\. Real Stack Overflow and GitHub/);
  });

  it('claim no “0 model calls” for what the docs don’t cover: some off-topic questions get through', async () => {
    const numbers = await tiles();
    expect(numbers.map((tile) => tile.value)).not.toContain('0');
    const page = text(document.body);
    expect(page).not.toMatch(/model calls to answer what the docs don’t cover/);
    expect(page).not.toContain('The model only sees questions your docs can answer');
    expect(page).toContain(
      'Most off-topic questions get “I don’t know” before the model is called',
    );
  });

  it('fill whole rows of three and of two', async () => {
    expect((await tiles()).length % 6).toBe(0);
  });
});

describe('the home page’s comparison', () => {
  const row = async (label: string) => {
    const body = await home();
    const tr = [...body.querySelectorAll('.compare tbody tr')].find(
      (r) => text(r.querySelector('th')) === label,
    );
    return {
      hosted: text(tr?.querySelector('td[data-label="Hosted assistants"]')),
      ours: text(tr?.querySelector('td[data-label="ondocs"]')),
      vendors: text(body.querySelector('.compare thead th:nth-of-type(1) span')),
    };
  };

  it('says Algolia Ask AI runs on your own model key, as Algolia documents it', async () => {
    const { hosted, vendors } = await row('Model and key');
    expect(vendors).toContain('Algolia Ask AI');
    expect(hosted).toBe('The vendor’s (Algolia Ask AI: yours)');
  });

  it('compares what agents get with the hosted MCP servers, not “Varies by vendor”', async () => {
    expect(await row('For agents')).toMatchObject({
      hosted: 'Hosted MCP on most plans',
      ours: 'Your own MCP endpoint and llms.txt; by default, agent search calls no model',
    });
  });
});

describe('the live demos', () => {
  it('are the example sites, Starlight first', () => {
    expect(DEMOS.map(({ label }) => label)).toEqual(['Starlight', 'Docusaurus', 'VitePress']);
    for (const { label, href } of DEMOS) {
      expect(href).toBe(`https://ondocs-${label.toLowerCase()}.vercel.app`);
    }
  });

  it('are linked from each plugin’s setup tab, Starlight’s first', async () => {
    const body = (await home()).querySelector('.setup')!;
    expect([...body.querySelectorAll('[role="tab"]')].map((tab) => text(tab))).toEqual([
      'Astro and Starlight',
      'Docusaurus',
      'VitePress',
      'Next.js and React',
      'Any site',
    ]);
    const demos = [...body.querySelectorAll('[role="tabpanel"]')].map((panel) =>
      [...panel.querySelectorAll('.setup-links a')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((href) => href.startsWith('https://')),
    );
    expect(demos).toEqual([...DEMOS.map(({ href }) => [href]), [], []]);
  });

  it('are linked from the docs home, under Pick your framework', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(site);
    vi.resetModules();
    const { default: DocsHome } = await import('../examples/nextjs/app/docs/page');
    document.body.innerHTML = renderToStaticMarkup(await DocsHome());
    const demos = document
      .querySelector('#integrations')
      ?.parentElement?.querySelector('.chooser-demos');
    expect([...(demos?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual(
      DEMOS.map(({ href }) => href),
    );
    expect(text(demos)).toBe(
      'These docs, live with each plugin: Starlight, Docusaurus and VitePress.',
    );
  });
});
