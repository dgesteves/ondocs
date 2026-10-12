import { describe, expect, it } from 'vitest';

import GithubSlugger from 'github-slugger';

import { chunkDocument, createSlugger, fromHtml, fromMarkdown, slugify } from '../src';
import { nextHeadingIds } from '../src/node/next';
import type { SourceDocument } from '../src';
import { seeded } from './helpers';

const doc = (content: string, title = 'Page'): SourceDocument => ({
  id: 'page.md',
  url: '/page',
  title,
  content,
});

/**
 * Runs `fn` three times and returns the fastest, in milliseconds. A GC pause or a busy CI runner
 * can slow one run several times over; the quadratic cases these tests guard against take seconds.
 */
function timed(fn: () => unknown): number {
  let fastest = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

describe('linear-time parsing of hostile input', () => {
  it('parses headings with long whitespace runs quickly', () => {
    const line = `# a${' \t'.repeat(20_000)}b`;
    expect(timed(() => chunkDocument(doc(line)))).toBeLessThan(250);
    const ids = `## a {/* #b${' \t'.repeat(400)}`.repeat(25).concat('\n').repeat(400);
    expect(timed(() => chunkDocument(doc(ids)))).toBeLessThan(250);
    expect(timed(() => fromMarkdown(line, { id: 'x', url: '/x' }))).toBeLessThan(250);
  });

  it('reads `[#id]` heading ids quickly, on long and on many lines', () => {
    const long = `## a${' [#'.repeat(20_000)}]`;
    expect(timed(() => nextHeadingIds(long, 'fumadocs'))).toBeLessThan(250);
    const many = `## a [#b${' '.repeat(200)}[#c]\n`.repeat(20_000);
    expect(timed(() => nextHeadingIds(many, 'nextra'))).toBeLessThan(250);
  });

  it('handles long backtick runs and unclosed tags quickly', () => {
    const backticks = 'a'.concat('`'.repeat(20_000), ' b');
    expect(timed(() => fromMarkdown(backticks, { id: 'x', url: '/x' }))).toBeLessThan(250);
    const metas = '<meta name=robots '.repeat(5_000);
    expect(timed(() => fromHtml(metas, { id: 'x', url: '/x' }))).toBeLessThan(250);
  });
});

describe('linear-time loaders on unclosed constructs', () => {
  // Quadratic before: 0.8 s (unclosed <pre>) to 70 s (unclosed link labels) at this size.
  const n = 40_000;
  const html = (source: string, root?: string, ignore?: string) => () =>
    fromHtml(source, { id: 'x', url: '/x', root, ...(ignore ? { ignore } : {}) });
  const md =
    (source: string, mdx = false, markdown = false) =>
    () =>
      fromMarkdown(source, { id: 'x', url: '/x', mdx, markdown });
  const markdown = (source: string) => () =>
    fromHtml(source, { id: 'x', url: '/docs/x', markdown: true });

  it.each([
    ['unclosed dropped elements', html(`<main>${'<nav>x '.repeat(n)}</main>`)],
    ['unclosed headings', html(`<main>${'<h2>x '.repeat(n)}</main>`)],
    ['unclosed <pre>', html(`<main>${'<pre>x '.repeat(n)}</main>`)],
    ['unclosed <code>', html(`<main>${'<code>x '.repeat(n)}</main>`)],
    ['unclosed HTML comments', html(`<main>${'<!-- x '.repeat(n)}</main>`)],
    ['unclosed <main>', html('<main>x '.repeat(n))],
    ['unclosed <article>', html('<article>x '.repeat(n))],
    ['unclosed <article>s around closed ones', html('<article>x<article>y</article>'.repeat(n))],
    ['nested <article>s', html(`${'<article>x '.repeat(n)}${'</article>'.repeat(n)}`, 'article')],
    [
      'an unclosed Docusaurus container',
      html(`<article>${'<div class=theme-doc-markdown>x '.repeat(n)}`, 'article'),
    ],
    ['unclosed <title>', html('<title>x '.repeat(n))],
    ['unclosed selected elements', html(`<main>${'<div class=x>x '.repeat(n)}</main>`, '.x')],
    [
      'nested selected elements',
      html(`${'<div class=x>'.repeat(n)}${'</div>'.repeat(n)}`, 'div.x'),
    ],
    ['many selected elements', html('<div class=x>x</div>'.repeat(n), '[class=x], main')],
    [
      'many ignored elements',
      // Two elements a repeat, so half as many repeats: as many elements as the other cases.
      html(`<main>${'<p data-i>x</p><p>y</p>'.repeat(n / 2)}</main>`, undefined, '[data-i]'),
    ],
    [
      'unclosed ignored elements',
      html(`<main>${'<p data-i>x '.repeat(n)}</main>`, undefined, '[data-i]'),
    ],
    ['brackets in attribute values', html(`<main>${'<a title="<p> => x">y</a>'.repeat(n)}</main>`)],
    ['values that open tags', html(`<main>${'<a b="<a b="'.repeat(n)}</main>`)],
    ['a value that never closes', html(`<main><a b="${'<p>x</p>'.repeat(n)}</main>`)],
    ['tags that never end', html(`<main>${'<a b=c '.repeat(n)}`)],
    ['attributes without values', html(`<main><p ${'a '.repeat(5 * n)}>x</p></main>`, 'p[b]')],
    ['a heading link full of spaces', html(`<main><h2><a>${' '.repeat(5 * n)}</h2></main>`)],
    // The Markdown a page's .md copy is written as. Each element does more work here (a URL to
    // resolve, a cell to convert), so a quarter as many: a quadratic case still takes seconds.
    ['Markdown: nested lists', markdown(`<main>${'<ul><li>x'.repeat(n / 4)}</main>`)],
    ['Markdown: unclosed tables', markdown(`<main>${'<table><tr><td>x'.repeat(n / 4)}</main>`)],
    [
      'Markdown: cells without closing tags',
      markdown(`<main><table>${'<tr><td>x<td>y'.repeat(n / 4)}</table></main>`),
    ],
    ['Markdown: unclosed quotes', markdown(`<main>${'<blockquote>x '.repeat(n / 4)}</main>`)],
    ['Markdown: unclosed links', markdown(`<main>${'<a href=/x>y '.repeat(n)}</main>`)],
    [
      'Markdown: many links and images',
      markdown(`<main>${'<a href="../a">b</a><img src=c alt=d>'.repeat(n / 4)}</main>`),
    ],
    ['Markdown: Markdown with unclosed link labels', md(`${'['.repeat(4 * n)}]`, false, true)],
    ['Markdown links with unclosed destinations', md('[a](('.repeat(n))],
    ['Markdown links without destinations', md('[a]('.repeat(n))],
    ['Markdown images with unclosed destinations', md('![a]('.repeat(n))],
    ['unclosed link labels', md(`${'['.repeat(4 * n)}]`)],
    ['unclosed image labels', md(`!${'['.repeat(4 * n)}]`)],
    ['link definitions with unclosed labels', md(`${'[x\n'.repeat(n)}]: /url`)],
    ['labels before a far bracket', md(`${'[x'.repeat(n)}]: y`)],
    ['unclosed Markdown comments', md('<!-- x '.repeat(n))],
    ['unclosed MDX comments', md('{/* x '.repeat(n), true)],
    ['unclosed MDX heading ids', md('## x {/* #a\n'.repeat(n), true)],
    ['MDX heading ids full of openers', md(`## x ${'{/* #'.repeat(150)}\n`.repeat(n / 100), true)],
    [
      'MDX heading ids with long whitespace',
      md(`## x {/* #a${' \t'.repeat(400)}*/}${' '.repeat(100)}\n`.repeat(n / 100), true),
    ],
  ])('%s', (_, parse) => {
    expect(timed(parse)).toBeLessThan(250);
  });
});

describe('headings', () => {
  it('keeps a trailing # that is part of the text, and strips real closing sequences', () => {
    const chunks = chunkDocument(doc('## C#\n\nA.\n\n## F# and C# ##\n\nB.\n\n## Done ###\n\nC.'));
    expect(chunks.map((c) => c.heading)).toEqual(['C#', 'F# and C#', 'Done']);
    expect(fromMarkdown('# C#\n\nBody', { id: 'x', url: '/x' })?.title).toBe('C#');
  });

  it('slugs underscores like GitHub: kept inside words and code, dropped as emphasis', () => {
    expect(slugify('`max_tokens`')).toBe('max_tokens');
    expect(slugify('snake_case_name')).toBe('snake_case_name');
    expect(slugify('`__init__` method')).toBe('__init__-method');
    expect(slugify('_emphasis_ and __strong__')).toBe('emphasis-and-strong');
    const [chunk] = chunkDocument(doc('## `max_tokens`\n\nBody.'));
    expect(chunk).toMatchObject({ heading: 'max_tokens', anchor: 'max_tokens' });
  });

  it('slugs exactly like github-slugger, whitespace and all', () => {
    // [heading Markdown, the text GitHub renders for it]
    const cases: [string, string][] = [
      ['a  b', 'a  b'],
      ['x\ty', 'x\ty'],
      ['a\u00a0b', 'a\u00a0b'],
      ['A \u2014 B', 'A \u2014 B'],
      ['x\u00b2 and \u00bd', 'x\u00b2 and \u00bd'],
      ['foo_bar_', 'foo_bar_'],
      ['_foo_bar', '_foo_bar'],
      ['a _ b', 'a _ b'],
      ['snake_case_name', 'snake_case_name'],
      ['_emphasis_ and __strong__', 'emphasis and strong'],
      ['__init__ method', 'init method'],
      ['`__init__` method', '__init__ method'],
      ['__init__.py', 'init.py'],
      ['foo\\_bar', 'foo_bar'],
      ['***both*** and **_mixed_**', 'both and mixed'],
      ['*a **b** c*', 'a b c'],
      ['a * b * c', 'a * b * c'],
      ['`` `code` ``', '`code`'],
      ['[link](http://a) text', 'link text'],
      ['C++ & C#', 'C++ & C#'],
      ['emoji \u{1F389} test', 'emoji \u{1F389} test'],
      ['Foo', 'Foo'],
      ['Foo', 'Foo'],
      ['Foo-1', 'Foo-1'],
      ['', ''],
      ['', ''],
    ];
    const ours = createSlugger();
    const github = new GithubSlugger();
    for (const [markdown, rendered] of cases) {
      expect([markdown, ours(markdown)]).toEqual([markdown, github.slug(rendered)]);
    }
  });

  it('agrees with github-slugger on any text without Markdown syntax', () => {
    const random = seeded(7);
    const alphabet = [
      ...Array.from('aZ09 -.,!?:;\'"()/@&%$+='),
      '  ',
      '\t',
      '\u00a0',
      '\u3000',
      '\u00e9',
      'e\u0301',
      '\u00b2',
      '\u216b',
      '\u0663',
      '\u4e2d',
      '\u{1F389}',
      '\u2014',
      '\u{31350}',
      '\u0130',
    ];
    const ours = createSlugger();
    const github = new GithubSlugger();
    for (let i = 0; i < 2000; i += 1) {
      let text = '';
      for (let j = Math.floor(random() * 12); j >= 0; j -= 1) {
        text += alphabet[Math.floor(random() * alphabet.length)] ?? '';
      }
      expect([text, ours(text)]).toEqual([text, github.slug(text)]);
    }
  });

  it('anchors headings by their exact text, collapsing whitespace only for display', () => {
    const chunks = chunkDocument(doc('## a  b\n\nA.\n\n## foo_bar_\n\nB.'));
    expect(chunks.map((c) => [c.heading, c.anchor])).toEqual([
      ['a b', 'a--b'],
      ['foo_bar_', 'foo_bar_'],
    ]);
  });

  it('accepts explicit ids with dots, colons and non-ASCII letters', () => {
    const chunks = chunkDocument(
      doc('## new {#method.new}\n\nA.\n\n## Über uns {#über:uns}\n\nB.'),
    );
    expect(chunks.map((c) => [c.heading, c.anchor])).toEqual([
      ['new', 'method.new'],
      ['Über uns', 'über:uns'],
    ]);
  });

  it('does not treat #hashtags or empty headings as structure', () => {
    const chunks = chunkDocument(doc('#hashtag line\n\n##\n\nText.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe('');
  });
});

describe('fenced code', () => {
  it('does not open a fence on a line of inline triple-backtick code', () => {
    const chunks = chunkDocument(doc('```npm i foo```\n\n## Next\n\nStill a section.'));
    expect(chunks.map((c) => c.heading)).toEqual(['', 'Next']);
  });

  it('closes a fence indented differently from its opener, in the loader and the chunker', () => {
    const source = '```js\nconst a = 1;\n  ```\n\n<!-- private note -->\n\n## After\n\nText.';
    const document = fromMarkdown(source, { id: 'x', url: '/x' });
    expect(document?.content).not.toContain('private note');
    expect(chunkDocument(document!).map((c) => c.heading)).toEqual(['', 'After']);
  });

  it('re-fences split code and never carries a fence line through overlap', () => {
    const code = [
      '```ts',
      ...Array.from({ length: 30 }, (_, i) => `const value${String(i)} = compute(${String(i)});`),
      '```',
    ].join('\n');
    const chunks = chunkDocument(
      doc(`Intro prose that ends here.\n\n${code}\n\nAfter the code, a sentence of prose follows.`),
      { maxChars: 400, overlap: 150 },
    );
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(400);
      // Every chunk's fences pair up: an opener with a language, then a bare closer.
      const fences = chunk.text.split('\n').filter((line) => line.startsWith('```'));
      expect(fences.length % 2).toBe(0);
      for (let i = 0; i < fences.length; i += 2)
        expect([fences[i], fences[i + 1]]).toEqual(['```ts', '```']);
    }
    const all = chunks.map((c) => c.text).join('\n');
    for (let i = 0; i < 30; i += 1)
      expect(all).toContain(`const value${String(i)} = compute(${String(i)});`);
  });
});

describe('HTML loader', () => {
  it('does not mistake custom elements for the built-in tags it drops', () => {
    const page =
      '<main><p>Intro.</p><nav-link>Docs</nav-link><h2 id="install">Install</h2><p>Run npm i.</p>' +
      '<button-group><span>Kept</span></button-group><nav>menu</nav><p>End.</p></main>';
    const content = fromHtml(page, { id: 'x', url: '/x' })?.content ?? '';
    expect(content).toContain('## Install {#install}');
    expect(content).toContain('Run npm i.');
    expect(content).toContain('Kept');
    expect(content).not.toContain('menu');
  });

  it('reads every <article> when there is no <main>', () => {
    const page =
      '<body><article><h1>One</h1><p>First.</p></article><article><p>Second.</p></article></body>';
    const content = fromHtml(page, { id: 'x', url: '/x' })?.content ?? '';
    expect(content).toContain('First.');
    expect(content).toContain('Second.');
  });

  it('drops permalink anchors from headings and decodes Latin-1 entities', () => {
    const page =
      '<main><h2 id="getting-started">Getting Started <a class="header-anchor" href="#getting-started">&ZeroWidthSpace;</a></h2><p>Start.</p>' +
      '<h2 id="api">API <a href="#api">#</a></h2><p>Caf&eacute; &Eacute;t&eacute; &AMP; co.</p></main>';
    const document = fromHtml(page, { id: 'x', url: '/x' })!;
    expect(chunkDocument(document).map((c) => c.heading)).toEqual(['Getting Started', 'API']);
    expect(document.content).toContain('Café Été & co.');
  });

  it('fences <pre> blocks so code containing ``` cannot close them', () => {
    const page =
      '<main><h2>Example</h2><pre><code>```\n# not a heading\n```</code></pre><p>After.</p></main>';
    const chunks = chunkDocument(fromHtml(page, { id: 'x', url: '/x' })!);
    expect(chunks.map((c) => c.heading)).toEqual(['Example']);
    expect(chunks[0]?.text).toContain('# not a heading');
  });
});
