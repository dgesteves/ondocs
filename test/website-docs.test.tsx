// @vitest-environment jsdom
// The website's docs shell (examples/nextjs): its Markdown renderer, the sidebar's groups, and the
// behaviors on the docs pages.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  markOverflow,
  selectTab,
  tabTarget,
} from '../examples/nextjs/components/docs-enhancements';
import { chatLinks } from '../examples/nextjs/components/page-actions';
import {
  LONG_CODE,
  codeParts,
  keepUnits,
  packageManagers,
  renderMarkdown,
  smartQuotes,
} from '../examples/nextjs/lib/markdown';
import { editUrl } from '../examples/nextjs/lib/site';

const site = join(import.meta.dirname, '../examples/nextjs');
const { navigation } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule('node:module');
  const require = createRequire(`${import.meta.dirname}/../examples/nextjs/package.json`);
  return { navigation: require.resolve('next/navigation') };
});

vi.mock(navigation, () => ({ usePathname: () => '/docs/getting-started' }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const html = async (markdown: string) => (await renderMarkdown(markdown)).html;

describe('callouts', () => {
  it('renders :::note, :::tip and :::warning, and the other frameworks’ names for them', async () => {
    const out = await html(
      ':::note\nA note.\n:::\n\n:::tip Try it\nA tip.\n:::\n\n:::caution\nCareful.\n:::\n\n:::info\nInfo.\n:::',
    );
    expect(out).toContain(
      '<div class="callout callout-note" role="note"><p class="callout-title">Note</p><p>A note.</p>',
    );
    expect(out).toContain('<p class="callout-title">Try it</p><p>A tip.</p>');
    expect(out).toContain('callout-warning" role="note"><p class="callout-title">Caution</p>');
    expect(out.match(/callout-note/g)).toHaveLength(2);
    expect(out).not.toContain(':::');
  });

  it('renders GitHub’s alerts as callouts, and any other quote as a quote', async () => {
    const out = await html('> [!WARNING]\n> Mind the budget.\n\n> Just a quote.');
    expect(out).toContain(
      '<div class="callout callout-warning" role="note"><p class="callout-title">Warning</p><p>Mind the budget.</p>',
    );
    expect(out).toContain('<blockquote>\n<p>Just a quote.</p>\n</blockquote>');
  });

  it('leaves a container it doesn’t know as text', async () => {
    expect(await html(':::details\nHidden.\n:::')).toContain(':::details');
  });
});

describe('steps and tabs', () => {
  it('numbers the list in :::steps', async () => {
    expect(await html(':::steps\n1. Install\n2. Index\n:::')).toBe(
      '<div class="steps"><ol>\n<li>Install</li>\n<li>Index</li>\n</ol>\n</div>\n',
    );
  });

  it('makes a tab of each @tab in :::tabs, the first one showing', async () => {
    const out = await html(
      ':::tabs\n@tab Docusaurus\nOne line.\n\n@tab Starlight\nOne plugin.\n:::',
    );
    const root = document.createElement('div');
    root.innerHTML = out;
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['Docusaurus', 'true'],
      ['Starlight', 'false'],
    ]);
    const panels = [...root.querySelectorAll('[role="tabpanel"]')];
    expect(panels.map((panel) => [panel.textContent.trim(), panel.hasAttribute('hidden')])).toEqual(
      [
        ['One line.', false],
        ['One plugin.', true],
      ],
    );
    expect(panels[1]?.getAttribute('aria-labelledby')).toBe(tabs[1]?.id);
  });

  it('switches tabs, and keeps the keyboard on the selected one', async () => {
    document.body.innerHTML = await html(':::tabs\n@tab One\nFirst.\n\n@tab Two\nSecond.\n:::');
    const [one, two] = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    selectTab(two!);
    expect(two?.getAttribute('aria-selected')).toBe('true');
    expect(two?.tabIndex).toBe(0);
    expect(one?.tabIndex).toBe(-1);
    expect(document.getElementById(one!.getAttribute('aria-controls')!)?.hidden).toBe(true);
    expect(document.getElementById(two!.getAttribute('aria-controls')!)?.hidden).toBe(false);
  });

  it('moves between tabs with the arrow keys, wrapping, and to the ends with Home and End', async () => {
    document.body.innerHTML = await html(
      ':::tabs\n@tab One\nFirst.\n\n@tab Two\nSecond.\n\n@tab Three\nThird.\n:::',
    );
    const [one, two, three] = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabTarget(one!, 'ArrowRight')).toBe(two);
    expect(tabTarget(three!, 'ArrowRight')).toBe(one);
    expect(tabTarget(one!, 'ArrowLeft')).toBe(three);
    expect(tabTarget(two!, 'Home')).toBe(one);
    expect(tabTarget(one!, 'End')).toBe(three);
    expect(tabTarget(two!, 'Enter')).toBeUndefined();
  });
});

describe('package managers', () => {
  it('turns a block of npm installs into npm, pnpm, yarn and bun', () => {
    expect(packageManagers('npm i ondocs ai cmdk\nnpm i -D @types/react')).toEqual([
      { label: 'npm', code: 'npm i ondocs ai cmdk\nnpm i -D @types/react' },
      { label: 'pnpm', code: 'pnpm add ondocs ai cmdk\npnpm add -D @types/react' },
      { label: 'yarn', code: 'yarn add ondocs ai cmdk\nyarn add -D @types/react' },
      { label: 'bun', code: 'bun add ondocs ai cmdk\nbun add -d @types/react' },
    ]);
    expect(packageManagers('npm install')?.map((variant) => variant.code)).toEqual([
      'npm install',
      'pnpm install',
      'yarn',
      'bun install',
    ]);
  });

  it('leaves any other command as one block', async () => {
    expect(packageManagers('npm uninstall ask-my-site\nnpm install ondocs')).toBeNull();
    expect(packageManagers('npx ondocs init')).toBeNull();
    expect(packageManagers('npm i ondocs && npx ondocs init')).toBeNull();
    document.body.innerHTML = await html('```sh\nnpm i ondocs\n```');
    const block = document.querySelector('[data-sync="package-manager"]')!;
    expect(block.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Package manager',
    );
    expect(
      [...block.querySelectorAll('[role="tabpanel"] pre')].map((pre) => pre.textContent),
    ).toEqual(['npm i ondocs', 'pnpm add ondocs', 'yarn add ondocs', 'bun add ondocs']);
  });
});

describe('code blocks', () => {
  it('takes the title from the fence, or from a first line that names a file', () => {
    expect(codeParts('export default {};', 'ts title="docusaurus.config.ts"')).toEqual({
      lang: 'ts',
      title: 'docusaurus.config.ts',
      code: 'export default {};',
    });
    expect(codeParts('// app/api/ask/route.ts\nexport const POST = handler;', 'ts')).toEqual({
      lang: 'ts',
      title: 'app/api/ask/route.ts',
      code: 'export const POST = handler;',
    });
    expect(codeParts('# wrangler.toml\nname = "ask"', 'toml').title).toBe('wrangler.toml');
    // A comment that isn't a file name stays in the code.
    expect(codeParts('// Then call it\nrun();', 'js')).toEqual({
      lang: 'js',
      code: '// Then call it\nrun();',
    });
  });

  it('puts the language or file name and a copy icon in a bar above the code', async () => {
    const out = await html('```ts\n// lib/ask.ts\nexport {};\n```');
    expect(out).toMatch(
      /^<div class="code-block" data-code-block><div class="code-head"><span class="code-label">lib\/ask\.ts<\/span><button type="button" class="copy-button" data-copy aria-label="Copy code" title="Copy code"><\/button><\/div><pre/,
    );
    expect(out).not.toContain('// lib/ask.ts');
    // Without a file name, the language, in the quieter style.
    expect(await html('```sh\nnpx ondocs init\n```')).toContain(
      '<span class="code-label code-label-language">Shell</span>',
    );
  });

  it('wraps prose-like output, and scrolls source code, sessions and event streams', async () => {
    expect(await html('```text\nI don’t know.\n```')).toContain('code-wrap');
    expect(await html('```output\nanswered from 5 sources\n```')).toContain('code-wrap');
    // A session's output is often in columns, which wrapping would break.
    expect(await html('```console\n$ npx ondocs dev\n```')).not.toContain('code-wrap');
    expect(await html('```ts\nconst a = 1;\n```')).not.toContain('code-wrap');
    expect(await html('```\ndata: {"type":"start"}\n```')).not.toContain('code-wrap');
  });

  it('highlights YAML, diffs, CSS and Markdown, not only scripts', async () => {
    const yaml = await html('```yaml\nthresholds:\n  hit@3: 0.8\n```');
    // The key and the number take the theme's property and number colors.
    expect(yaml).toContain('light-dark(#9D174D, #F9A8D4)');
    expect(yaml).toContain('<span class="code-label code-label-language">YAML</span>');
    const diff = await html('```diff\n--- a.ts\n+++ b.ts\n-old\n+new\n same\n```');
    // Added and removed lines in the family's add and delete colours (cyan, magenta), as
    // signoff-ui's DiffReview, every token of them; the file headers keep the grammar's.
    expect(
      diff.match(
        /class="line diff-add">(?:<span style="color:var\(--code-add\)">[^<]*<\/span>)+<\/span>/g,
      ),
    ).toHaveLength(1);
    expect(
      diff.match(
        /class="line diff-del">(?:<span style="color:var\(--code-del\)">[^<]*<\/span>)+<\/span>/g,
      ),
    ).toHaveLength(1);
    expect(diff).not.toMatch(/diff-(?:add|del)">[^\n]*(?:\+\+\+|---)/);
    expect(await html('```css\n.a { color: red; }\n```')).toContain('light-dark(');
    expect(await html('```md\n# Title\n```')).toContain('light-dark(');
  });

  it('shows a stream of Server-Sent Events as events: each field dim, each value as JSON', async () => {
    const out = await html(
      '```\ndata: {"type":"start","messageMetadata":{"refused":false}}\ndata: [DONE]\n```',
    );
    expect(out).toContain('<span class="code-label code-label-language">Server-Sent Events</span>');
    expect(out).toContain('event-stream');
    expect(out.match(/<span class="t-dim">data: <\/span>/g)).toHaveLength(2);
    // The JSON value's string, in the theme's string color.
    expect(out).toContain('light-dark(#9A3412, #F5C27A)');
    const pre = new DOMParser().parseFromString(out, 'text/html').querySelector('pre');
    expect(pre?.textContent).toBe(
      'data: {"type":"start","messageMetadata":{"refused":false}}\ndata: [DONE]',
    );
  });

  it('lets only inline code longer than 28 characters break', async () => {
    expect(LONG_CODE).toBe(28);
    const out = await html(
      '`createAskHandler` and `createAskHandler({ index, model, embeddingModel })`',
    );
    expect(out).toContain('<code>createAskHandler</code>');
    expect(out).toContain(
      '<code class="code-long">createAskHandler({ index, model, embeddingModel })</code>',
    );
  });
});

describe('typography', () => {
  it('curls quotes and apostrophes in prose', () => {
    expect(smartQuotes('the "Ask AI" box doesn\'t')).toBe('the “Ask AI” box doesn’t');
    expect(smartQuotes("'single'")).toBe('‘single’');
  });

  it('keeps a number and its unit together', () => {
    expect(keepUnits('about 1.6 MB, 0.71 ms and 3 s.')).toBe('about 1.6 MB, 0.71 ms and 3 s.');
    expect(keepUnits('10 seconds')).toBe('10 seconds');
  });

  it('curls prose around code and links, but never code, and keeps heading ids', async () => {
    const { html: out, headings } = await renderMarkdown(
      '## Saying "I don\'t know"\n\nThe "`gate`" says "I don\'t know" at 1.6 MB. `"raw"` stays.',
    );
    expect(headings).toEqual([
      { depth: 2, text: 'Saying “I don’t know”', id: 'saying-i-dont-know' },
    ]);
    expect(out).toContain('The “<code>gate</code>” says “I don’t know” at 1.6 MB.');
    expect(out).toContain('<code>&quot;raw&quot;</code>');
  });

  it('opens a quote at the start of each table cell, whatever the cell before ends with', async () => {
    const out = await html(
      '| Prop | Default |\n| --- | --- |\n| `title` | "Ask this site" |\n| `noAnswerMessage` | "I don\'t know…" |\n| `footer` | |',
    );
    expect(out).toContain('<td data-label="Default">“Ask this site”</td>');
    expect(out).toContain('<td data-label="Default">“I don’t know…”</td>');
    expect(out).not.toContain('”Ask');
  });
});

describe('tables', () => {
  it('are named after their heading, uniquely, and focusable only once they scroll', async () => {
    const table = '| Flag | Default |\n| --- | --- |\n| `-o` | ask-index.json |';
    const out = await html(`## ondocs index\n\n${table}\n\n${table}\n\n## ondocs dev\n\n${table}`);
    const names = [...out.matchAll(/data-name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([
      'Table: ondocs index',
      'Table: ondocs index, table 2',
      'Table: ondocs dev',
    ]);
    document.body.innerHTML = out;
    for (const scroller of document.querySelectorAll('.table-scroll')) {
      expect(scroller.hasAttribute('tabindex')).toBe(false);
      expect(scroller.hasAttribute('role')).toBe(false);
    }
  });

  it('marks what overflows: a fade, a tab stop and, for a table, its name', () => {
    document.body.innerHTML =
      '<div class="table-scroll" data-name="Table: Flags"><table></table></div><pre tabindex="0"></pre>';
    const table = document.querySelector<HTMLElement>('.table-scroll')!;
    const pre = document.querySelector<HTMLElement>('pre')!;
    const size = (element: HTMLElement, scrollWidth: number) => {
      Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
      Object.defineProperty(element, 'clientWidth', { value: 300, configurable: true });
    };
    size(table, 600);
    size(pre, 300);
    markOverflow(table);
    markOverflow(pre);
    expect(table.getAttribute('role')).toBe('region');
    expect(table.getAttribute('aria-label')).toBe('Table: Flags');
    expect(table.tabIndex).toBe(0);
    expect(table.hasAttribute('data-overflow')).toBe(true);
    expect(table.hasAttribute('data-scrolled-end')).toBe(false);
    expect(pre.hasAttribute('tabindex')).toBe(false);
    expect(pre.hasAttribute('data-overflow')).toBe(false);

    table.scrollLeft = 300;
    markOverflow(table);
    expect(table.hasAttribute('data-scrolled-end')).toBe(true);
    size(table, 300);
    markOverflow(table);
    expect(table.hasAttribute('role')).toBe(false);
    expect(table.hasAttribute('tabindex')).toBe(false);
  });
});

describe('the sidebar', () => {
  async function docs() {
    vi.spyOn(process, 'cwd').mockReturnValue(site);
    return import('../examples/nextjs/lib/docs');
  }

  it('groups the pages: Get started, Frameworks, For agents, Deploy & operate, Guides, Reference', async () => {
    const { getSections, INTEGRATIONS_SECTION, sectionId } = await docs();
    const sections = await getSections();
    expect(sections.map((section) => section.title)).toEqual([
      'Get started',
      'Frameworks',
      'For agents',
      'Deploy & operate',
      'Guides',
      'Reference',
    ]);
    const slugs = (title: string) =>
      sections.find((section) => section.title === title)?.docs.map((doc) => doc.slug);
    expect(slugs('For agents')).toEqual(['mcp', 'llms-txt']);
    expect(slugs('Deploy & operate')).toEqual([
      'deployment',
      'workers-ai',
      'security',
      'bot-challenge',
    ]);
    expect(slugs(INTEGRATIONS_SECTION)).toContain('docusaurus');
    expect(sectionId(INTEGRATIONS_SECTION)).toBe('integrations');
    expect(sectionId('Deploy & operate')).toBe('deploy-operate');
  });

  it('uses short labels where a title is long', async () => {
    const all = await (await docs()).getDocs();
    const label = (slug: string) => all.find((doc) => doc.slug === slug)?.label;
    expect(label('workers-ai')).toBe('Workers AI');
    expect(label('llms-txt')).toBe('llms.txt');
    expect(label('getting-started')).toBe('Getting started');
  });

  it('gives every page a description a search result shows whole', async () => {
    for (const doc of await (await docs()).getDocs()) {
      expect(doc.description.length, doc.slug).toBeGreaterThan(0);
      expect(doc.description.length, doc.slug).toBeLessThanOrEqual(160);
    }
  });

  it('keeps the frontmatter the other examples share as it was', () => {
    // The sync script maps `section` to the other examples' sidebars and Starlight's folders.
    for (const file of readdirSync(join(site, 'content/docs'))) {
      const source = readFileSync(join(site, 'content/docs', file), 'utf8');
      expect(source, file).toMatch(/^section: (Get started|Integrations|Guides|Reference)$/m);
    }
  });
});

describe('a docs page', () => {
  it('links its source to edit, and its Markdown copy to ChatGPT and Claude', () => {
    expect(editUrl('mcp')).toBe(
      'https://github.com/dgesteves/ondocs/edit/main/examples/nextjs/content/docs/mcp.md',
    );
    const links = chatLinks('mcp');
    const prompt =
      'Read https://ondocs.vercel.app/docs/mcp.md so I can ask you questions about it.';
    expect(new URL(links.chatgpt).searchParams.get('q')).toBe(prompt);
    expect(new URL(links.claude).searchParams.get('q')).toBe(prompt);
    expect(links.claude.startsWith('https://claude.ai/new?')).toBe(true);
  });

  it('gets its date from git, and none past a shallow clone’s history or for a file git doesn’t know', async () => {
    // A repository of the test's own, so the result doesn't depend on how deep CI clones this one.
    const root = mkdtempSync(join(tmpdir(), 'ondocs-git-'));
    const git = (cwd: string, args: string[], date?: string) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        {
          cwd,
          stdio: 'ignore',
          env: date
            ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
            : process.env,
        },
      );
    const commit = (date: string, file: string) => {
      writeFileSync(join(root, 'full', file), date);
      git(join(root, 'full'), ['add', file]);
      git(join(root, 'full'), ['commit', '-q', '-m', file], date);
    };
    try {
      git(root, ['init', '-q', 'full']);
      commit('2025-12-01T00:00:00Z', 'readme.md');
      commit('2026-01-02T03:04:05Z', 'old.md');
      commit('2026-02-03T04:05:06Z', 'new.md');
      // Two commits deep, as a host clones: the history stops at old.md's commit.
      git(root, ['clone', '-q', '--depth', '2', `file://${join(root, 'full')}`, 'shallow']);

      const read = async (repo: string) => {
        vi.resetModules();
        vi.spyOn(process, 'cwd').mockReturnValue(join(root, repo));
        const { lastModified } = await import('../examples/nextjs/lib/git');
        return {
          first: lastModified('readme.md')?.toISOString(),
          old: lastModified('old.md')?.toISOString(),
          new: lastModified('new.md')?.toISOString(),
          missing: lastModified('not-a-page.md'),
        };
      };
      // The first commit has no parents either, but in a full clone that's where the file began.
      expect(await read('full')).toEqual({
        first: '2025-12-01T00:00:00.000Z',
        old: '2026-01-02T03:04:05.000Z',
        new: '2026-02-03T04:05:06.000Z',
        missing: undefined,
      });
      expect(await read('shallow')).toEqual({
        first: undefined,
        old: undefined,
        new: '2026-02-03T04:05:06.000Z',
        missing: undefined,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks the section being read in On this page', async () => {
    const { Toc } = await import('../examples/nextjs/components/docs-nav');
    const tops: Record<string, number> = { install: -200, build: 40, deploy: 600 };
    document.body.innerHTML = Object.keys(tops)
      .map((id) => `<h2 id="${id}">${id}</h2>`)
      .join('');
    for (const [id, top] of Object.entries(tops)) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ top }) as DOMRect;
    }
    document.documentElement.style.scrollPaddingTop = '80px';
    // A long page, not scrolled to its end.
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 5000,
      configurable: true,
    });
    const headings = Object.keys(tops).map((id) => ({ depth: 2, text: id, id }));
    const container = document.body.appendChild(document.createElement('div'));
    render(<Toc headings={headings} />, { container });
    await act(() => Promise.resolve());
    expect(screen.getByRole('link', { current: 'location' }).textContent).toBe('build');
  });

  it('closes the docs bar’s lists on Escape, and on a click outside them', async () => {
    const { DocsBar } = await import('../examples/nextjs/components/docs-nav');
    const sections = [
      { title: 'Get started', docs: [{ slug: 'getting-started', label: 'Start' }] },
    ];
    const headings = [{ depth: 2, text: 'Install', id: 'install' }];
    render(<DocsBar sections={sections} headings={headings} />);
    const [pages, toc] = screen.getAllByRole('button');
    const open = () => [pages, toc].map((button) => button?.getAttribute('aria-expanded'));

    fireEvent.click(pages!);
    expect(open()).toEqual(['true', 'false']);
    // Inside the list, it stays open.
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Start' }));
    expect(open()).toEqual(['true', 'false']);
    fireEvent.pointerDown(document.body);
    expect(open()).toEqual(['false', 'false']);

    // Opening the other one closes the first, as the press lands outside it.
    fireEvent.click(pages!);
    fireEvent.pointerDown(toc!);
    fireEvent.click(toc!);
    expect(open()).toEqual(['false', 'true']);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(open()).toEqual(['false', 'false']);
    expect(document.activeElement).toBe(toc);
  });
});

describe('the docs content', () => {
  it('mentions the old name only where it is the subject', () => {
    const files = readdirSync(join(site, 'content/docs')).filter((file) =>
      readFileSync(join(site, 'content/docs', file), 'utf8').includes('ask-my-site'),
    );
    // index-format.md names the format id, which keeps the old name.
    expect(files.sort()).toEqual(['faq.md', 'index-format.md', 'migrating.md']);
  });
});
