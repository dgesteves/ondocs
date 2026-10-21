import { describe, expect, it } from 'vitest';

import { chunkDocument, decodeEntities, fromDocuments, fromHtml, fromMarkdown } from '../src';

const meta = { id: 'docs/page.md', url: '/docs/page', fallbackTitle: 'Page' };

describe('fromMarkdown', () => {
  it('reads title and url from frontmatter', () => {
    const doc = fromMarkdown(
      '---\ntitle: "Install"\nurl: /start/install\ntags: [a, b]\n---\n\n# Ignored H1\n\nBody.',
      meta,
    );
    expect(doc).toMatchObject({ id: 'docs/page.md', title: 'Install', url: '/start/install' });
    expect(doc?.content).toBe('# Ignored H1\n\nBody.');
  });

  it('falls back to the first H1, then to the fallback title', () => {
    expect(fromMarkdown('Intro\n\n# The *Title*\n\nBody', meta)?.title).toBe('The Title');
    expect(fromMarkdown('```\n# not a title\n```\n\nBody', meta)?.title).toBe('Page');
    expect(fromMarkdown('---\npermalink: /p\n---\nx', meta)?.url).toBe('/p');
  });

  it('skips drafts and opted-out pages', () => {
    expect(fromMarkdown('---\ndraft: true\n---\nx', meta)).toBeNull();
    expect(fromMarkdown('---\nask: false\n---\nx', meta)).toBeNull();
    expect(fromMarkdown('---\nnoindex: true\n---\nx', meta)).toBeNull();
  });

  it('keeps link labels, image alt text and code, and drops HTML noise', () => {
    const doc = fromMarkdown(
      [
        'See [the guide](https://example.com/a_(b)) and ![a diagram](./d.png).',
        '<!-- hidden -->',
        '<details><summary>More</summary>Inside</details>',
        'Types like `Promise<string>` stay intact.',
        '',
        '```html',
        '<div class="kept">literal</div>',
        '```',
        '',
        '[ref]: https://example.com',
      ].join('\n'),
      meta,
    );
    expect(doc?.content).toContain('See the guide and a diagram.');
    expect(doc?.content).not.toContain('hidden');
    expect(doc?.content).toContain('MoreInside');
    expect(doc?.content).toContain('`Promise<string>`');
    expect(doc?.content).toContain('<div class="kept">literal</div>');
    expect(doc?.content).not.toContain('[ref]');
  });

  it.each([
    ['[a](x(y)z) b', 'a b'],
    ['[a](x(y) and [b](c) later', '[a](x(y) and b later'],
    ['[a](x(y', '[a](x(y'],
    ['[a]((b)', '[a]((b)'],
    ['![alt](i.png) [![badge](b.svg)](link)', 'alt badge'],
    ['[a[b](c)', 'a[b'],
    ['[x][ref] and [y][]', 'x and y'],
    ['[ref]: https://x\n  [r2]: /y "t"\n    [code]: z\nText.', '[code]: z\nText.'],
    ['See <!-- note --> this <!-- unclosed', 'See  this <!-- unclosed'],
  ])(
    'reads links, definitions and comments in %j as before the linear rewrite',
    (source, content) => {
      expect(fromMarkdown(source, meta)?.content).toBe(content);
    },
  );

  it('extracts text from MDX without evaluating it', () => {
    const doc = fromMarkdown(
      [
        "import { Callout } from '../components';",
        "export const meta = { section: 'x' };",
        '',
        '# Usage',
        '',
        '{/* editor note */}',
        '<Callout type="warn" icon={<Icon />}>Back up first.</Callout>',
        '<Diagram src="/a.svg" />',
        '',
        '```jsx',
        "import React from 'react';",
        '<Callout>kept in code</Callout>',
        '```',
      ].join('\n'),
      { ...meta, mdx: true },
    );
    expect(doc?.title).toBe('Usage');
    expect(doc?.content).not.toContain('import { Callout }');
    expect(doc?.content).not.toContain('editor note');
    expect(doc?.content).toContain('Back up first.');
    expect(doc?.content).not.toContain('<Diagram');
    expect(doc?.content).toContain("import React from 'react';");
    expect(doc?.content).toContain('<Callout>kept in code</Callout>');
  });

  it('keeps the heading ids Docusaurus reads from MDX comments, and drops the other comments', () => {
    // As docusaurus.io's own docs write them: 164 of their 776 differ from the heading's slug.
    const source = [
      '## Docusaurus CLI commands {/* #docusaurus-cli-commands */}',
      '',
      '### `docusaurus start [siteDir]` {/* #docusaurus-start-sitedir */}',
      '',
      'Builds and serves a preview. {/* not an id */}',
      '',
      '#### Options {/* #options */}',
      '',
      'Flags for start.',
      '',
      '### `docusaurus swizzle [themeName] [componentName] [siteDir]` {/* #docusaurus-swizzle */}',
      '',
      'Swizzles a component.',
      '',
      '#### Options {/* #options-swizzle */}',
      '',
      'Flags for swizzle.',
      '',
      '```md',
      '## In code {/* #not-structure */}',
      '```',
    ].join('\n');
    const doc = fromMarkdown(source, { ...meta, mdx: true });
    expect(doc?.content).not.toContain('not an id');
    expect(doc?.content).toContain('## In code {/* #not-structure */}');
    const chunks = chunkDocument(doc!);
    expect(chunks.map((c) => [c.heading, c.anchor])).toEqual([
      ['Docusaurus CLI commands › docusaurus start [siteDir]', 'docusaurus-start-sitedir'],
      ['Docusaurus CLI commands › docusaurus start [siteDir] › Options', 'options'],
      [
        'Docusaurus CLI commands › docusaurus swizzle [themeName] [componentName] [siteDir]',
        'docusaurus-swizzle',
      ],
      [
        'Docusaurus CLI commands › docusaurus swizzle [themeName] [componentName] [siteDir] › Options',
        'options-swizzle',
      ],
    ]);
  });
});

describe('fromHtml', () => {
  const page = `<!doctype html>
<html><head>
  <title>Install | Acme Docs</title>
  <style>.x { color: red }</style>
</head>
<body>
  <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
  <main>
    <h1>Install</h1>
    <p>Run the <code>acme</code> installer &mdash; it takes a minute.</p>
    <h2 id="requirements">Requirements &amp; limits</h2>
    <ul><li>Node 22+</li><li>2&nbsp;GB of RAM</li></ul>
    <pre><code>npm install acme
  --save</code></pre>
    <script>window.tracking = true;</script>
    <h2>Next steps</h2>
    <p>Read the <a href="/guide">guide</a>.</p>
  </main>
  <footer>© Acme</footer>
</body></html>`;

  it('extracts main content as Markdown-shaped text', () => {
    const doc = fromHtml(page, { id: 'install.html', url: '/install' });
    expect(doc?.title).toBe('Install');
    expect(doc?.content).toContain('Run the `acme` installer — it takes a minute.');
    expect(doc?.content).toContain('## Requirements & limits {#requirements}');
    expect(doc?.content).toContain('- Node 22+');
    expect(doc?.content).toContain('- 2 GB of RAM');
    expect(doc?.content).toContain('```\nnpm install acme\n  --save\n```');
    expect(doc?.content).not.toMatch(/tracking|color: red|Home|© Acme/);
  });

  it('feeds the chunker headings with the page’s own ids', () => {
    const doc = fromHtml(page, { id: 'install.html', url: '/install' });
    const chunks = chunkDocument(doc!);
    expect(chunks.map((c) => [c.heading, c.anchor])).toEqual([
      ['', undefined],
      ['Requirements & limits', 'requirements'],
      // No id on the page, so no anchor to make up: the citation links to the page.
      ['Next steps', undefined],
    ]);
  });

  it('links a heading without an id to the nearest heading above it that has one', () => {
    const doc = fromHtml(
      '<main><h2 id="setup">Setup</h2><p>Run it.</p><h3>Details</h3><p>More.</p></main>',
      { id: 'a.html', url: '/a.html' },
    );
    expect(chunkDocument(doc!).map((c) => [c.heading, c.anchor])).toEqual([
      ['Setup', 'setup'],
      ['Setup › Details', 'setup'],
    ]);
    // Markdown keeps its slugs, the ids its renderer gives those headings.
    const markdown = {
      id: 'a.md',
      url: '/a',
      title: 'A',
      content: '## Setup\n\nRun it.\n\n### Details\n\nMore.',
    };
    expect(chunkDocument(markdown).map((c) => c.anchor)).toEqual(['setup', 'details']);
  });

  it('falls back to <title>, honours robots noindex, decodes entities', () => {
    expect(fromHtml('<title>Only &amp; title</title><p>x</p>', { id: 'a', url: '/a' })?.title).toBe(
      'Only & title',
    );
    expect(
      fromHtml('<meta name="robots" content="noindex, nofollow"><p>x</p>', { id: 'a', url: '/a' }),
    ).toBeNull();
    expect(decodeEntities('&#x2192; &#8594; &rarr; &bogus;')).toBe('→ → → &bogus;');
  });
});

describe('fromHtml on unclosed elements', () => {
  it.each([
    [
      '<main><h2 id="x"><a href="#x"> ¶ </a>Title</h2><nav>menu</nav><p>Body <code>x</code></p><h3>open',
      '## Title {#x}\n\nBody `x`\n\nopen',
    ],
    ['<article>A</article><article>B', 'A'],
    ['<main>x<main>y</main>', 'xy'],
  ])('reads %j as before the linear rewrite', (source, content) => {
    expect(fromHtml(source, { id: 'a', url: '/a' })?.content).toBe(content);
  });
});

describe('fromHtml on nested elements', () => {
  it('reads an element up to its own closing tag, not a nested one’s', () => {
    const page =
      '<body><article><h1>Post</h1><p>Intro.</p><article><p>A comment.</p></article>' +
      '<p>Outro.</p></article></body>';
    const doc = fromHtml(page, { id: 'a', url: '/a' });
    expect(doc?.content).toBe('# Post\n\nIntro.\n\nA comment.\n\nOutro.');
    expect(
      fromHtml('<main><div><main><p>x</p></main><p>y</p></div></main>', { id: 'a', url: '/a' })
        ?.content,
    ).toBe('x\n\ny');
  });

  it('drops the articles nested in the root with root: article, and keeps what follows them', () => {
    // Docusaurus's <DocCardList>: a card per page, each an <article>.
    const card = (title: string) =>
      `<article class="col col--6"><a class=card href=/${title.toLowerCase()}><h2 title=${title}>📄️<!-- -->${title}</h2><p>About ${title}.</p></a></article>`;
    const page = `<main><article><h1>Reference</h1><p>Every option.</p><section class=row>${card('Alpha')}${card('Beta')}</section>
<h2 id=after>After the cards</h2><p>Still indexed.</p></article><nav>Next</nav></main>`;
    const doc = fromHtml(page, { id: 'a', url: '/a', root: 'article' })!;
    expect(doc.title).toBe('Reference');
    expect(doc.content).toBe(
      '# Reference\n\nEvery option.\n\n## After the cards {#after}\n\nStill indexed.',
    );
  });

  it('reads Docusaurus’s Markdown container with root: article, and the title from the page', () => {
    const doc = `<html><head><title>Setup | Acme</title></head><body><main><article>
<nav class=theme-doc-breadcrumbs>Home Guides</nav><span class="theme-doc-version-badge badge">Version: 1.0</span>
<div class="theme-doc-markdown markdown"><header><h1>Setup</h1></header><div><p>Install it.</p></div><div class=row><p>Then run it.</p></div></div>
<footer>Edit this page</footer></article></main></body></html>`;
    expect(fromHtml(doc, { id: 'a', url: '/a', root: 'article' })).toMatchObject({
      title: 'Setup',
      content: '# Setup\n\nInstall it.\n\nThen run it.',
    });

    // A blog post's <h1>, date and authors sit in a header outside its container.
    const post = `<html><head><title>Hello | Acme</title></head><body><main><article class="">
<header><h1 class=title_x>Hello</h1><div class=container><time>May 1, 2026</time> · <!-- -->One min read</div><div class=row><span>Jane Doe</span></div></header>
<div id=__blog-post-container class=markdown><p>First post.</div><footer>Tags: news</footer></article></main></body></html>`;
    expect(fromHtml(post, { id: 'b', url: '/b', root: 'article' })).toMatchObject({
      title: 'Hello',
      content: 'First post.',
    });
  });

  it('leaves other sites’ pages as they were', () => {
    // A `markdown` class alone is not Docusaurus's container, and the default root ignores it.
    const page =
      '<main><article><header><p>By Jane</p></header><div class=markdown><h1>Post</h1><p>Body.</p></div></article></main>';
    expect(fromHtml(page, { id: 'a', url: '/a', root: 'article' })?.content).toBe(
      'By Jane\n\n# Post\n\nBody.',
    );
    const docusaurus =
      '<main><article><nav>Home</nav><span>Version: 1.0</span><div class=theme-doc-markdown><p>Body.</p></div></article></main>';
    expect(fromHtml(docusaurus, { id: 'a', url: '/a' })?.content).toBe('Version: 1.0\n\nBody.');
  });
});

describe('fromHtml with a selector', () => {
  // A Starlight page, as Starlight 0.42 builds it: the title, Markdown and page footer in the
  // region it marks for Pagefind, the sidebar and table of contents outside it.
  const starlight = (
    attributes = 'data-pagefind-body',
  ) => `<html lang=en data-theme=dark><head><title>Setup | Acme</title></head><body>
<header><a href=/ class=site-title>Acme</a><site-search><button data-open-modal>Search</button></site-search></header>
<nav class=sidebar aria-label=Main><a href=/guides/setup/>Setup</a></nav>
<aside class=right-sidebar-container><h2 id=starlight__on-this-page>On this page</h2></aside>
<main ${attributes} class=astro-uknsdzpk lang=en dir=ltr><div class=sl-banner data-pagefind-ignore>New release!</div>
<div class=content-panel><div class=sl-container><h1 id=_top>Setup</h1></div></div>
<div class=content-panel><div class=sl-container><div class=sl-markdown-content><p>Install it.</p>
<div class="sl-heading-wrapper level-h2"><h2 id=configure>Configure</h2><a class=sl-anchor-link href=#configure><span aria-hidden=true class=sl-anchor-icon><svg><path d=M0 /></svg></span><span class=sr-only data-pagefind-ignore>Section titled “Configure”</span></a></div>
<aside aria-label=Tip class="starlight-aside starlight-aside--tip"><p class=starlight-aside__title aria-hidden=true>Tip</p><div class=starlight-aside__content><p>Pin the version.</p></div></aside>
</div><footer class=sl-flex><div class="meta sl-flex"><a href=https://example.com/edit>Edit page</a></div><div class=pagination-links><a href=/ rel=prev>Previous</a></div></footer></div></div></main></body></html>`;

  it('reads only what the selector matches, without what `ignore` matches, and keeps asides', () => {
    const doc = fromHtml(starlight(), {
      id: 'a',
      url: '/a',
      root: '[data-pagefind-body]',
      ignore: '[data-pagefind-ignore]',
    });
    expect(doc).toEqual({
      id: 'a',
      url: '/a',
      title: 'Setup',
      content:
        '# Setup {#_top}\n\nInstall it.\n\n## Configure {#configure}\n\nTip\n\nPin the version.',
      anchors: 'explicit',
    });
  });

  it('returns null when the selector matches nothing, as for pagefind: false', () => {
    const page = starlight('');
    expect(fromHtml(page, { id: 'a', url: '/a', root: '[data-pagefind-body]' })).toBeNull();
    // The default root still reads the page.
    expect(fromHtml(page, { id: 'a', url: '/a' })?.content).toContain('Install it.');
  });

  it('matches tags, ids, classes and attribute values, combined or listed', () => {
    const page =
      '<body><div class="post wide" id=one data-kind=note>A</div><div class=post>B</div>' +
      '<section class=post>C</section><p data-kind="other">D</p><div class=post><div class=post>E</div></div></body>';
    const read = (root: string) => fromHtml(page, { id: 'a', url: '/a', root })?.content;
    expect(read('.post')).toBe('A\n\nB\n\nC\n\nE');
    expect(read('div.post')).toBe('A\n\nB\n\nE');
    expect(read('#one')).toBe('A');
    expect(read('[data-kind=note], [data-kind="other"]')).toBe('A\n\nD');
    expect(read('section, #one')).toBe('A\n\nC');
    expect(read('DIV.wide[data-kind]')).toBe('A');
    // Commented-out markup and scripts are not elements.
    expect(
      fromHtml(
        '<body><!-- <main class=x>no</main> --><script>"<main class=x>"</script><main class=x>yes</main>',
        {
          id: 'a',
          url: '/a',
          root: 'main.x',
        },
      )?.content,
    ).toBe('yes');
  });

  it('rejects selectors it cannot read', () => {
    for (const root of ['main p', 'main > p', 'a:hover', '', '.']) {
      expect(() => fromHtml('<main>x</main>', { id: 'a', url: '/a', root })).toThrow(
        /Unsupported selector/,
      );
    }
  });
});

describe('fromHtml on highlighted code', () => {
  it('reads Expressive Code blocks line by line', () => {
    // Starlight's code blocks: one <div> per line, with no newline between them; an empty line
    // keeps its newline inside its <div>.
    const line = (code: string) =>
      `<div class=ec-line><div class=code>${code ? `<span style="--0:#82AAFF">${code}</span>` : '\n'}</div></div>`;
    const page = `<main><div class=expressive-code><figure class="frame is-terminal"><figcaption class=header><span class=title></span><span class=sr-only>Terminal window</span></figcaption><pre data-language=sh><code>${line('npm install acme')}${line('')}${line('npx acme --init')}</code></pre><div class=copy><button title="Copy to clipboard" data-code="npm install acme\u007f\u007fnpx acme --init"><div></div></button></div></figure></div></main>`;
    expect(fromHtml(page, { id: 'a', url: '/a', ignore: '.sr-only' })?.content).toBe(
      '```\nnpm install acme\n\nnpx acme --init\n```',
    );
    // Shiki's lines are spans with the newlines between them; one <div> per line with newlines
    // between them counts each line once.
    const shiki =
      '<main><pre><code><span class=line>a</span>\n<span class=line>b</span></code></pre></main>';
    expect(fromHtml(shiki, { id: 'a', url: '/a' })?.content).toBe('```\na\nb\n```');
    const divs = '<main><pre><div>a</div>\n<div></div>\n<div>b</div></pre></main>';
    expect(fromHtml(divs, { id: 'a', url: '/a' })?.content).toBe('```\na\n\nb\n```');
  });

  it('reads a tag to its end when an attribute value holds < or >', () => {
    // Expressive Code keeps the whole snippet in the copy button's data-code.
    const page = `<main><p>Before.</p><button data-code="<Ask endpoint='/api' /> => ok" title='a > b'>Copy</button><p data-x=">">After.</p></main>`;
    expect(fromHtml(page, { id: 'a', url: '/a' })?.content).toBe('Before.\n\nAfter.');
    // A quote only opens a value after `=`.
    expect(
      fromHtml(`<main><p class=x it's>Kept.</p><p>Also kept.</p></main>`, { id: 'a', url: '/a' })
        ?.content,
    ).toBe('Kept.\n\nAlso kept.');
  });
});

describe('fromHtml on lists, tabs and admonitions', () => {
  const read = (main: string) => fromHtml(`<main>${main}</main>`, { id: 'a', url: '/a' });

  it('writes a loose list’s items on their own lines', () => {
    expect(
      read('<ul>\n<li>\n<p>First item</p>\n</li>\n<li><p>Second item</p></li>\n</ul>')?.content,
    ).toBe('- First item\n\n- Second item');
  });

  it('says which tab each panel is, and leaves out the list of tabs', () => {
    const doc = read(
      '<h2 id=install>Install</h2><ul role=tablist><li role=tab>npm<li role=tab>pnpm</ul><div role=tabpanel><pre><code>npm i acme</code></pre></div><div role=tabpanel hidden><pre><code>pnpm add acme</code></pre></div>',
    );
    expect(doc?.content).toBe(
      '## Install {#install}\n\nnpm\n\n```\nnpm i acme\n```\n\npnpm\n\n```\npnpm add acme\n```',
    );
    // What the MCP server's search and fetch return.
    expect(chunkDocument(doc!).map((chunk) => chunk.text)).toEqual([
      'npm\n\n```\nnpm i acme\n```\n\npnpm\n\n```\npnpm add acme\n```',
    ]);
  });

  it('names an admonition’s type when its title is another', () => {
    const admonition = (type: string, title: string) =>
      `<div class="theme-admonition theme-admonition-${type} alert"><div class=admonitionHeading_FzoX>${title}</div><div class=admonitionContent_Knsx><p>Body.</p></div></div>`;
    expect(read(admonition('danger', 'Take care') + admonition('note', 'note'))?.content).toBe(
      'Danger: Take care\n\nBody.\n\nnote\n\nBody.',
    );
  });
});

describe('fromDocuments', () => {
  it('validates records and rejects duplicates', () => {
    const docs = fromDocuments([{ id: 'a', url: '/a', title: 'A', content: 'x\r\ny' }]);
    expect(docs[0]?.content).toBe('x\ny');
    expect(() => fromDocuments([{ id: 'a', url: '/a', title: 'A' }])).toThrow(/content/);
    expect(() =>
      fromDocuments([
        { id: 'a', url: '/a', title: 'A', content: '' },
        { id: 'a', url: '/b', title: 'B', content: '' },
      ]),
    ).toThrow(/Duplicate/);
  });
});
