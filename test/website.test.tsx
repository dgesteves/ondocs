// @vitest-environment jsdom
// The website's shell (examples/nextjs): the theme, the header and footer, and its SEO plumbing.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { githubStars, MIN_STARS, starLabel } from '../examples/nextjs/lib/github';
import { jsonLd, softwareSourceCode } from '../examples/nextjs/lib/json-ld';
import { HOME_DESCRIPTION } from '../examples/nextjs/lib/site';
import { THEME_KEY, THEME_SCRIPT } from '../examples/nextjs/lib/theme';
import { VERSION } from '../examples/nextjs/lib/version';

const site = join(import.meta.dirname, '../examples/nextjs');

/** WCAG 2 contrast ratio of two `#rrggbb` colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const { pathname, navigation } = vi.hoisted(() => {
  // The site's own next, as its components import it, which this folder can't resolve by name.
  const { createRequire } = process.getBuiltinModule('node:module');
  const require = createRequire(`${import.meta.dirname}/../examples/nextjs/package.json`);
  return {
    pathname: { current: '/docs/docusaurus' },
    navigation: require.resolve('next/navigation'),
  };
});

vi.mock(navigation, () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn() }),
}));

/** jsdom has no matchMedia: the OS's scheme, as a query that never changes. */
function stubColorScheme(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the theme script', () => {
  const run = () => {
    // It runs as an inline <script> in the page's <head>.
    globalThis.eval(THEME_SCRIPT);
    return document.documentElement.className;
  };

  it('follows the OS until a theme is chosen', () => {
    stubColorScheme(true);
    expect(run()).toBe('dark');
    document.documentElement.className = '';
    stubColorScheme(false);
    expect(run()).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('applies the stored choice over the OS, before paint', () => {
    stubColorScheme(true);
    localStorage.setItem(THEME_KEY, 'light');
    expect(run()).toBe('light');
    document.documentElement.className = '';
    stubColorScheme(false);
    localStorage.setItem(THEME_KEY, 'dark');
    expect(run()).toBe('dark');
  });

  it('uses its own storage key', () => {
    expect(THEME_KEY).toBe('ondocs-theme');
  });
});

describe('the theme switch', () => {
  it('sets the class on <html>, remembers it, and tells the dialog', async () => {
    stubColorScheme(false);
    const { ThemeSwitch, usePageScheme } =
      await import('../examples/nextjs/components/theme-switch');
    document.documentElement.className = 'light';
    function Scheme() {
      return <p data-testid="scheme">{usePageScheme()}</p>;
    }
    render(
      <>
        <ThemeSwitch />
        <Scheme />
      </>,
    );
    const user = userEvent.setup();
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.className).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    await act(() => Promise.resolve());
    expect(screen.getByTestId('scheme').textContent).toBe('dark');

    // Arrow keys move between the three, as in any radio group.
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.className).toBe('light');
  });
});

describe('the dialog', () => {
  it('is given the theme the page is in', () => {
    const source = readFileSync(join(site, 'components/ask-dialog.tsx'), 'utf8');
    expect(source).toContain("theme={scheme ?? 'auto'}");
    expect(source).not.toContain('theme="dark"');
  });
});

describe('the GitHub star count', () => {
  it('shows from 10 stars, shortened past 1,000', () => {
    expect(MIN_STARS).toBe(10);
    expect(starLabel(null)).toBeNull();
    expect(starLabel(9)).toBeNull();
    expect(starLabel(10)).toBe('10');
    expect(starLabel(999)).toBe('999');
    expect(starLabel(1234)).toBe('1.2k');
    expect(starLabel(12_345)).toBe('12k');
  });

  it('is read once, without a token, and is null when GitHub fails', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ stargazers_count: 42 })));
    vi.stubGlobal('fetch', fetch);
    expect(await githubStars()).toBe(42);
    expect(await githubStars()).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/dgesteves/ondocs');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    // Fresh in each build, rather than from a data cache that outlives the deployment, and the
    // pages stay static all the same.
    expect(init.cache).toBe('no-store');
    expect(readFileSync(join(site, 'app/layout.tsx'), 'utf8')).toContain(
      "export const dynamic = 'force-static';",
    );

    for (const failure of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(new Response('rate limited', { status: 403 })),
      () => Promise.resolve(Response.json({ message: 'Not Found' })),
    ]) {
      vi.resetModules();
      vi.stubGlobal('fetch', vi.fn(failure));
      const fresh = await import('../examples/nextjs/lib/github');
      expect(await fresh.githubStars()).toBeNull();
    }
  });
});

describe('the header', () => {
  async function header(stars: number | null) {
    vi.spyOn(process, 'cwd').mockReturnValue(site);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        stars === null
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(Response.json({ stargazers_count: stars })),
      ),
    );
    const { SiteHeader } = await import('../examples/nextjs/components/site-header');
    document.body.innerHTML = renderToStaticMarkup(await SiteHeader());
    return document.querySelector('header')!;
  }

  it('has the name, the pages, Ask, the theme and GitHub, in that order', async () => {
    const element = await header(null);
    const brand = element.querySelector('.brand')!;
    expect(brand.textContent).toBe('ondocs');
    // The version is in the footer.
    expect(brand.nextElementSibling?.matches('nav.header-nav')).toBe(true);
    expect(element.textContent).not.toContain(VERSION);
    const nav = element.querySelector('nav.header-nav')!;
    expect(
      [...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Docs', '/docs'],
      ['Integrations', '/docs#integrations'],
      ['Demos', '/#demos'],
    ]);
    const actions = [...element.querySelector('.header-actions')!.children].map(
      (child) =>
        child.getAttribute('aria-label') ??
        child.getAttribute('role') ??
        child.tagName.toLowerCase(),
    );
    expect(actions).toEqual(['Ask the docs', 'Theme', 'ondocs on GitHub', 'Menu', 'Site']);
    expect(element.querySelector('.header-ask')?.textContent).toContain('Ask');
    expect(element.querySelector('.header-ask kbd')?.textContent).toBe('⌘K');
  });

  it('marks the section a page is in: Integrations on a framework page, Docs on the others', async () => {
    pathname.current = '/docs/docusaurus';
    let element = await header(null);
    expect(element.querySelector('.header-nav [aria-current]')?.textContent).toBe('Integrations');
    vi.resetModules();
    pathname.current = '/docs/cli';
    element = await header(null);
    expect(element.querySelector('.header-nav [aria-current]')?.textContent).toBe('Docs');
    pathname.current = '/docs/docusaurus';
  });

  it('puts every page, GitHub, npm and the theme in the phone menu', async () => {
    const menu = (await header(null)).querySelector('#site-menu')!;
    expect(menu.getAttribute('popover')).toBe('auto');
    expect([...menu.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'Docs',
      'Integrations',
      'Demos',
      'GitHub',
      'npm',
    ]);
    expect(menu.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(document.querySelector('[aria-controls="site-menu"]')?.getAttribute('aria-label')).toBe(
      'Menu',
    );
  });

  it('shows the star count only from 10 stars', async () => {
    let github = (await header(9)).querySelector('.header-github')!;
    expect(github.textContent).toBe('');
    expect(github.getAttribute('aria-label')).toBe('ondocs on GitHub');
    vi.resetModules();
    github = (await header(1234)).querySelector('.header-github')!;
    expect(github.textContent).toBe('1.2k');
    expect(github.getAttribute('aria-label')).toBe('ondocs on GitHub, 1234 stars');
  });
});

describe('the nav state', () => {
  it('is page on the item itself, true under it, and nothing elsewhere', async () => {
    const { currentState } = await import('../examples/nextjs/components/site-nav');
    const docs = { href: '/docs', label: 'Docs', except: ['/docs/nextjs'] };
    const integrations = {
      href: '/docs#integrations',
      label: 'Integrations',
      paths: ['/docs/nextjs'],
    };
    expect(currentState(docs, '/docs')).toBe('page');
    expect(currentState(docs, '/docs/cli')).toBe('true');
    expect(currentState(docs, '/docs/nextjs')).toBeUndefined();
    expect(currentState(docs, '/')).toBeUndefined();
    expect(currentState(integrations, '/docs/nextjs')).toBe('true');
    expect(currentState(integrations, '/docs')).toBeUndefined();
  });
});

describe('the footer', () => {
  it('has Project, For agents, and More by Diogo Esteves', async () => {
    const { SiteFooter } = await import('../examples/nextjs/components/site-footer');
    document.body.innerHTML = renderToStaticMarkup(<SiteFooter />);
    const columns = [...document.querySelectorAll('footer nav')].map((nav) => [
      nav.querySelector('h2')?.textContent,
      [...nav.querySelectorAll('li > a')].map((a) => a.textContent),
    ]);
    expect(columns).toEqual([
      ['Project', ['Docs', 'Changelog', 'Issues', 'npm', `v${VERSION}`]],
      ['For agents', ['llms.txt', 'llms-full.txt', 'MCP server']],
      ['More by Diogo Esteves', ['onsystem', 'signoff-ui']],
    ]);
  });
});

describe('the SEO plumbing', () => {
  it('describes the project as SoftwareSourceCode, safe inside a script tag', () => {
    const data = softwareSourceCode();
    expect(data).toMatchObject({
      '@type': 'SoftwareSourceCode',
      name: 'ondocs',
      codeRepository: 'https://github.com/dgesteves/ondocs',
      version: VERSION,
    });
    expect(jsonLd({ name: '</script><script>' })).toBe('{"name":"\\u003c/script>\\u003cscript>"}');
  });

  it('keeps the home description to what a search result shows', () => {
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('gives the 404 page its own description and no share card or canonical URL', async () => {
    const { metadata } = await import('../examples/nextjs/app/not-found');
    expect(metadata.description).toMatch(/no page at this address/);
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
    expect(metadata.alternates).toBeNull();
  });

  it('sets the canonical URL and share card per page, not in the root layout', () => {
    const layout = readFileSync(join(site, 'app/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/openGraph:|alternates:|twitter:/);
    // The home page's share card files live with it, so the 404 page inherits none.
    expect(() => readFileSync(join(site, 'app/opengraph-image.tsx'))).toThrow();
    readFileSync(join(site, 'app/(home)/opengraph-image.tsx'));
    const home = readFileSync(join(site, 'app/(home)/page.tsx'), 'utf8');
    expect(home).toContain("canonical: '/'");
    expect(home).toContain('application/ld+json');
  });

  it('has a web manifest, and a sitemap without changefreq', async () => {
    const { default: manifest } = await import('../examples/nextjs/app/manifest');
    expect(manifest()).toMatchObject({ name: 'ondocs', start_url: '/' });
    expect(readFileSync(join(site, 'app/sitemap.ts'), 'utf8')).not.toContain('changeFrequency');
  });
});

describe('the share cards', () => {
  it('draw Geist unkerned, as Satori lays their words out, and spell out ⌘', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(site);
    const { cardText, ogFonts } = await import('../examples/nextjs/lib/og');
    const fonts = await ogFonts();
    expect(fonts.map((font) => font.name)).toEqual(['Geist', 'Geist', 'Geist Mono']);
    // The font's tables, from its table directory.
    const tables = (font: Buffer) =>
      Array.from({ length: font.readUInt16BE(4) }, (_, i) =>
        font.toString('latin1', 12 + i * 16, 16 + i * 16),
      );
    for (const { name, data } of fonts) {
      // Geist's kerning is hidden, and nothing else: its glyphs and substitutions are all there.
      expect(tables(data).includes('GPOS'), name).toBe(name !== 'Geist');
      expect(tables(data), name).toEqual(expect.arrayContaining(['GSUB', 'glyf', 'hmtx', 'cmap']));
    }
    expect(cardText('behind a button and ⌘I, and')).toBe('behind a button and Cmd+I, and');
  });
});

describe('Vercel Web Analytics', () => {
  it('is rendered once, with no options, at the end of <body>', () => {
    const layout = readFileSync(join(site, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain("import { Analytics } from '@vercel/analytics/next';");
    expect(layout.match(/<Analytics\b/g)).toHaveLength(1);
    expect(layout).toMatch(/<Analytics \/>\s*<\/body>/);
    const { dependencies } = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(dependencies['@vercel/analytics']).toBe('^2.0.1');
  });

  it('sends no custom events: only the root layout uses the package', () => {
    const users = ['app', 'components', 'lib'].flatMap((dir) =>
      readdirSync(join(site, dir), { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => join(dir, file))
        .filter((file) => readFileSync(join(site, file), 'utf8').includes('@vercel/analytics')),
    );
    expect(users).toEqual(['app/layout.tsx']);
  });
});

describe('the client bundle', () => {
  it('has no package.json: no module a client component reaches imports one', () => {
    const sources = ['app', 'components', 'lib'].flatMap((dir) =>
      readdirSync(join(site, dir), { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => join(site, dir, file)),
    );
    const resolve = (from: string, specifier: string) =>
      ['.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((extension) => join(from, '..', specifier) + extension)
        .find((file) => sources.includes(file));
    const reached = new Set(
      sources.filter((file) => readFileSync(file, 'utf8').startsWith("'use client';")),
    );
    expect(reached.size).toBeGreaterThan(5);
    for (const file of reached) {
      for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(
        /^import (?!type )[^;]*?from '(\.{1,2}\/[^']+)';$/gm,
      )) {
        const target = resolve(file, specifier);
        if (target) reached.add(target);
      }
    }
    const withPackage = [...reached].filter((file) =>
      /from '[^']*package\.json'/.test(readFileSync(file, 'utf8')),
    );
    expect(withPackage.map((file) => file.slice(site.length + 1))).toEqual([]);
  });
});

describe('the stylesheets', () => {
  const css = (file: string) => readFileSync(join(site, file), 'utf8');

  it('give every color token a light and a dark value, and follow .light and .dark', () => {
    const globals = css('app/globals.css');
    const root = /:root \{([\s\S]*?)\n\}/.exec(globals)?.[1] ?? '';
    expect(root).toContain('color-scheme: light dark;');
    const colors = [...root.matchAll(/^\s*(--[\w-]+): (.+);$/gm)].filter(([, , value]) =>
      /#|rgb|light-dark/.test(value ?? ''),
    );
    expect(colors.length).toBeGreaterThan(10);
    for (const [, name, value] of colors) expect(`${name}: ${value}`).toMatch(/: light-dark\(/);
    expect(globals).toMatch(/\.light \{\s*color-scheme: light;\s*\}/);
    expect(globals).toMatch(/\.dark \{\s*color-scheme: dark;\s*\}/);
  });

  it('name no color outside the tokens that holds in only one theme', () => {
    for (const file of ['app/globals.css', 'app/(home)/landing.css', 'app/docs/docs.css']) {
      const lines = css(file)
        .split('\n')
        .filter((line) => /#[\da-f]{3,8}\b|rgba?\(/i.test(line))
        .filter((line) => !line.includes('light-dark(') && !line.includes('mask-image'));
      expect(lines, file).toEqual([]);
    }
  });
});

describe('code highlighting', () => {
  it('colors each token for both themes, with the sibling sites’ theme pair', async () => {
    const { codeBlock } = await import('../examples/nextjs/lib/highlight');
    const html = await codeBlock("export default { plugins: ['ondocs/docusaurus'] };", 'ts');
    // The keyword: cyan in each theme, and the string: amber, as on signoff-ui's site.
    expect(html).toContain('light-dark(#155E75, #67E8F9)');
    expect(html).toContain('light-dark(#9A3412, #F5C27A)');
  });

  it('keeps the theme pair signoff-ui’s site highlights with', async () => {
    const { CODE_PALETTES } = await import('../examples/nextjs/lib/code-theme');
    expect(CODE_PALETTES.dark).toMatchObject({
      bg: '#101317',
      keyword: '#67e8f9',
      string: '#f5c27a',
      number: '#f9a8d4',
      comment: '#8b94a0',
    });
    expect(CODE_PALETTES.light).toMatchObject({
      bg: '#f6f7f9',
      keyword: '#155e75',
      string: '#9a3412',
      number: '#9d174d',
      comment: '#525b67',
    });
  });

  it.each(['light', 'dark'] as const)(
    'keeps every code token at 4.5:1 or more on the code background, %s',
    async (theme) => {
      const { CODE_PALETTES } = await import('../examples/nextjs/lib/code-theme');
      const { bg, ...colors } = CODE_PALETTES[theme];
      // The site's own code surface is the palette's background.
      const globals = readFileSync(join(site, 'app/globals.css'), 'utf8');
      const tokens = Object.fromEntries(
        [
          ...globals.matchAll(/^\s*--(code[\w-]*): light-dark\((#[\da-f]{6}), (#[\da-f]{6})\);$/gm),
        ].map(([, name = '', light = '', dark = '']) => [name, theme === 'light' ? light : dark]),
      );
      expect(tokens.code).toBe(bg);
      // Source code (Shiki), and terminal output (lib/terminal.ts).
      const { code: _surface, ...terminal } = tokens;
      expect(Object.keys(terminal).sort()).toEqual([
        'code-accent',
        'code-add',
        'code-amber',
        'code-del',
        'code-dim',
        'code-fg',
        'code-green',
        'code-number',
        'code-red',
        'code-soft',
        'code-string',
      ]);
      for (const [name, color] of [...Object.entries(colors), ...Object.entries(terminal)]) {
        expect([name, contrast(color, bg) >= 4.5]).toEqual([name, true]);
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps a diff’s added and removed lines at 4.5:1 or more on their tints, as signoff-ui’s, %s',
    async (theme) => {
      const { CODE_PALETTES } = await import('../examples/nextjs/lib/code-theme');
      const { bg } = CODE_PALETTES[theme];
      const globals = readFileSync(join(site, 'app/globals.css'), 'utf8');
      const value = (name: string) => {
        const pair = new RegExp(`--${name}: light-dark\\((.+?), (.+?)\\);`).exec(globals);
        return (theme === 'light' ? pair?.[1] : pair?.[2]) ?? '';
      };
      // signoff-ui's DiffReview: --signoff-add-bg and --signoff-del-bg, --signoff-accent-fg and
      // --signoff-hot-fg (packages/signoff-ui/src/styles/theme.css).
      const signoff = {
        light: ['rgb(8 145 178 / 0.08)', 'rgb(190 24 93 / 0.07)', '#155e75', '#9d174d'],
        dark: ['rgb(34 211 238 / 0.08)', 'rgb(240 70 138 / 0.08)', '#67e8f9', '#f472a8'],
      }[theme];
      expect(['code-add-bg', 'code-del-bg', 'code-add', 'code-del'].map(value)).toEqual(signoff);
      /** A tint over the code surface, as `#rrggbb`. */
      const over = (tint: string) => {
        const [r = 0, g = 0, b = 0, a = 0] = (
          /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(tint) ?? []
        )
          .slice(1)
          .map(Number);
        return `#${[r, g, b]
          .map((c, i) => Math.round(c * a + parseInt(bg.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a)))
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')}`;
      };
      for (const [line, text] of [
        ['code-add-bg', 'code-add'],
        ['code-del-bg', 'code-del'],
      ] as const) {
        expect([text, contrast(value(text), over(value(line))) >= 4.5]).toEqual([text, true]);
      }
    },
  );
});
