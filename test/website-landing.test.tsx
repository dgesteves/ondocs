// @vitest-environment jsdom
// The website's home page (examples/nextjs/app/(home)/page.tsx), as it renders: it leads with what
// ondocs is, says only what was measured, with the scope it was measured in, and links the live
// demos, as the docs home does.
import { join } from 'node:path';

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMOS, HOME_DESCRIPTION, HOME_TITLE } from '../examples/nextjs/lib/site';
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
vi.mock('../examples/nextjs/lib/sizes', () => ({ gzippedSize: () => '1.0 KB' }));
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
    expect(hero.querySelector('[data-copy]')).toBeNull();
  });

  it('asks these docs, or opens the live Starlight demo, or gets started', async () => {
    const actions = (await home()).querySelector('.hero-actions')!;
    expect(text(actions.querySelector('button .ask-button-text'))).toBe('Ask these docs');
    expect(
      [...actions.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]),
    ).toEqual([
      ['Try the live demo', 'https://ondocs-starlight.vercel.app'],
      ['Get started', '/docs/getting-started'],
    ]);
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
    const body = await home();
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
