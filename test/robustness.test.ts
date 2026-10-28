import { describe, expect, it } from 'vitest';

import GithubSlugger from 'github-slugger';

import {
  buildLlmsFiles,
  chunkDocument,
  createSlugger,
  fromHtml,
  fromMarkdown,
  slugify,
} from '../src';
import { configLocales, wranglerWorkerConfig } from '../src/cli/init';
import { nextHeadingIds } from '../src/node/next';
import { dropHeadingFootnotes } from '../src/text/markdown';
import type { SourceDocument } from '../src';
import { resolveMarkdownLinks } from '../src/llms';
import { seeded } from './helpers';

const doc = (content: string, title = 'Page'): SourceDocument => ({
  id: 'page.md',
  url: '/page',
  title,
  content,
});

/**
 * The budget for one hostile input. The slowest linear cases here take under 100 ms on a laptop and
 * have measured 261 to 328 ms on CI runners, while the fastest quadratic case they catch took 0.8 s
 * on a laptop (unclosed `<pre>`, below) and several times that on CI. So 250 ms locally and 1 s on
 * CI both tell them apart, on a machine running at its usual speed.
 */
const LOCAL_BUDGET_MS = 250;
const USUAL_BUDGET_MS = process.env.CI ? 1000 : LOCAL_BUDGET_MS;

/**
 * Under coverage the times say little: the instrumentation slowed chunking 2.3 times and init's
 * config reader 5.8 times (the line of `/`s below), so the cases run with no budget there.
 * vitest.config.ts sets ONDOCS_COVERAGE for a run with --coverage; `pnpm test` and CI's verify job
 * keep the budget.
 */
const BUDGET_MS = process.env.ONDOCS_COVERAGE ? Infinity : USUAL_BUDGET_MS;

/**
 * A linear workload to measure the machine's speed by: 850 KB of plain Markdown, chunked. It takes
 * about 20 ms on an Apple M1 Max shared with other work, and on CI the budget allows 4 times that.
 */
const REFERENCE = Array.from(
  { length: 6000 },
  (_, i) =>
    `## Section ${String(i)}\n\nA paragraph with a [link](/x/${String(i)}), some \`code\`, and *emphasis*.\n\n- one\n- two\n\n\`\`\`js\nconst x = ${String(i)};\n\`\`\`\n`,
).join('\n');
const REFERENCE_MS = 20 * (USUAL_BUDGET_MS / LOCAL_BUDGET_MS);
const reference = () => chunkDocument(doc(REFERENCE));

/** The fastest of three runs of `fn`, in milliseconds. A GC pause can slow one run several times over. */
function fastest(fn: () => unknown): number {
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * A case's time, `ms`, as on a machine running at its usual speed: divided by how many times
 * slower than `REFERENCE_MS` the reference ran just now, `referenceMs`, when it was slower. Other
 * work on the machine slows a linear case as much as it slows the reference, so the case stays
 * under the budget; a quadratic case takes seconds at the usual speed, and stays over it.
 */
function atUsualSpeed(ms: number, referenceMs: number): number {
  return ms / Math.max(1, referenceMs / REFERENCE_MS);
}

/**
 * How long `fn` takes, in milliseconds, for the budget. Over the budget, it measures `fn` and the
 * reference again and gives the time `atUsualSpeed`. Sampled every 20 s for 20 minutes on a
 * 10-core machine shared with other builds, at load averages from 7 to 24, the reference took
 * 18.7 to 34.3 ms: a fixed budget that holds on a quiet machine fails on a busy one.
 */
function timed(fn: () => unknown): number {
  const first = fastest(fn);
  if (first < BUDGET_MS) return first;
  const again = fastest(fn);
  return atUsualSpeed(Math.min(first, again), fastest(reference));
}

describe('the time budget', () => {
  it('lets a linear case through on a busy machine, and still catches a quadratic one', () => {
    // A linear case 20% over the budget, while the machine runs at two thirds of its usual speed.
    expect(atUsualSpeed(1.2 * USUAL_BUDGET_MS, 1.5 * REFERENCE_MS)).toBeLessThan(USUAL_BUDGET_MS);
    // The unclosed <pre> case, when it was quadratic: 3.2 times the budget at the usual speed.
    expect(atUsualSpeed(3.2 * 1.5 * USUAL_BUDGET_MS, 1.5 * REFERENCE_MS)).toBeGreaterThan(
      USUAL_BUDGET_MS,
    );
    // A machine faster than usual leaves the time as it is.
    expect(atUsualSpeed(1.2 * USUAL_BUDGET_MS, REFERENCE_MS / 2)).toBe(1.2 * USUAL_BUDGET_MS);
  });

  // The reference is ondocs's own chunker, so a regression that made it slow would loosen every
  // budget: it must stay well inside one.
  it('measures the machine with a linear workload, one chunk per section, well inside the budget', () => {
    expect(reference()).toHaveLength(6000);
    const ms = fastest(reference);
    // Not so short that the timer's resolution decides it.
    expect(ms).toBeGreaterThan(2);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('linear-time parsing of hostile input', () => {
  it('parses headings with long whitespace runs quickly', () => {
    const line = `# a${' \t'.repeat(20_000)}b`;
    expect(timed(() => chunkDocument(doc(line)))).toBeLessThan(BUDGET_MS);
    const ids = `## a {/* #b${' \t'.repeat(400)}`.repeat(25).concat('\n').repeat(400);
    expect(timed(() => chunkDocument(doc(ids)))).toBeLessThan(BUDGET_MS);
    expect(timed(() => fromMarkdown(line, { id: 'x', url: '/x' }))).toBeLessThan(BUDGET_MS);
  });

  it('reads `[#id]` heading ids quickly, on long and on many lines', () => {
    const long = `## a${' [#'.repeat(20_000)}]`;
    expect(timed(() => nextHeadingIds(long, { nextra: false }))).toBeLessThan(BUDGET_MS);
    const many = `## a [#b${' '.repeat(200)}[#c]\n`.repeat(20_000);
    expect(timed(() => nextHeadingIds(many, { nextra: true }))).toBeLessThan(BUDGET_MS);
  });

  it('leaves footnote references out of headings quickly, on long and on many lines', () => {
    const long = `## a${' [^'.repeat(20_000)}]\n\n[^a]: A footnote.`;
    expect(timed(() => dropHeadingFootnotes(long))).toBeLessThan(BUDGET_MS);
    const many = `## a [^b${' '.repeat(200)}[^c]\n[^c]: C.\n`.repeat(20_000);
    expect(timed(() => dropHeadingFootnotes(many))).toBeLessThan(BUDGET_MS);
  });

  it('splits long lines of CJK sentence ends and closing quotes quickly', () => {
    for (const unit of ['。', '」', '。」', '！？ ', '。」」」」a', '😀']) {
      const line = unit.repeat(Math.ceil(100_000 / unit.length));
      expect(timed(() => chunkDocument(doc(line)))).toBeLessThan(BUDGET_MS);
    }
  });

  it('compares a page’s H1 with a long title quickly, whatever runs it holds', () => {
    // A heading line is at most 1,000 characters; a title, as an <h1>'s text, can be any length.
    for (const run of [' ', '#', '¶ ', '\u200B', '*', '`', '<a ']) {
      const title = `a${run.repeat(Math.ceil(100_000 / run.length))}b`;
      const page = { url: '/p', title, content: '# a\n\nBody.' };
      const copy = () => buildLlmsFiles([page], { title: 'S' }, { index: false, full: false });
      expect(timed(copy)).toBeLessThan(BUDGET_MS);
    }
  });

  it('escapes a link label of backtick runs of mixed lengths quickly, in a .md copy and llms.txt', () => {
    // Runs of every length to 300 that no later run closes, then pairs of single backticks: a
    // search from each unclosed run for its closer would read every run after it.
    const runs = Array.from({ length: 300 }, (_, i) => '`'.repeat(i + 2)).join('[');
    const label = `${runs}${'[`'.repeat(25_000)}`;
    const copy = () =>
      fromHtml(`<main><p><a href=/x>${label}</a></p></main>`, {
        id: 'x',
        url: '/x',
        markdown: true,
      });
    expect(timed(copy)).toBeLessThan(BUDGET_MS);
    const page = { url: '/p', title: label, content: 'Body.' };
    const llms = () => buildLlmsFiles([page], { title: 'S' }, { full: false, markdown: false });
    expect(timed(llms)).toBeLessThan(BUDGET_MS);
  });

  it('handles long backtick runs and unclosed tags quickly', () => {
    const backticks = 'a'.concat('`'.repeat(20_000), ' b');
    expect(timed(() => fromMarkdown(backticks, { id: 'x', url: '/x' }))).toBeLessThan(BUDGET_MS);
    const metas = '<meta name=robots '.repeat(5_000);
    expect(timed(() => fromHtml(metas, { id: 'x', url: '/x' }))).toBeLessThan(BUDGET_MS);
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
  // A Markdown file's links, resolved for its .md copy.
  const relinked = (source: string) => () =>
    resolveMarkdownLinks(source, 'guide/index.md', '/docs/guide/', () => undefined);

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
    [
      'Markdown: nested quotes',
      markdown(`<main>${'<blockquote>x '.repeat(n / 4)}${'</blockquote>'.repeat(n / 4)}</main>`),
    ],
    [
      'Markdown: nested admonitions',
      markdown(
        `<main>${'<div class="custom-block tip"><p class=custom-block-title>T</p>x '.repeat(n / 4)}${'</div>'.repeat(n / 4)}</main>`,
      ),
    ],
    // Tabs and admonitions are read before the rest, a scan of their own: a quarter as many too.
    [
      'nested admonitions',
      html(
        `<main>${'<div class="theme-admonition-tip"><div class=admonitionHeading>T</div>x '.repeat(n / 4)}${'</div></div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: many tabs, and panels that name them',
      markdown(
        `<main><ul role=tablist>${'<li role=tab id=t>x'.repeat(n / 4)}</ul>${'<div role=tabpanel aria-labelledby=t>y</div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'nested tab panels',
      html(
        `<main><ul role=tablist><li role=tab>a</ul>${'<div role=tabpanel><ul role=tablist><li role=tab>b</ul>'.repeat(n / 4)}${'</div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: nested code groups',
      markdown(
        `<main>${'<div class=vp-code-group><label>a</label><pre>x</pre>'.repeat(n / 4)}${'</div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: nested code blocks with titles',
      markdown(
        `<main>${'<div class=theme-code-block><div class=codeBlockTitle>t</div>'.repeat(n / 4)}${'</div>'.repeat(n / 4)}<pre>x</pre></main>`,
      ),
    ],
    // An element in an open title is part of the title: none of it is read twice.
    [
      'admonitions in their titles',
      html(
        `<main>${'<div class="theme-admonition-tip"><div class=admonitionHeading>x '.repeat(n / 4)}${'</div></div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: admonitions in their titles',
      markdown(
        `<main>${'<div class="theme-admonition-tip"><div class=admonitionHeading>x '.repeat(n / 4)}${'</div></div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: code blocks in their titles, and their code after them',
      markdown(
        `<main>${'<div class=theme-code-block><div class=codeBlockTitle>t '.repeat(n / 4)}${'</div></div>'.repeat(n / 4)}<pre>x</pre></main>`,
      ),
    ],
    [
      'Markdown: code blocks in their titles, and their code in them',
      markdown(
        `<main>${'<div class=theme-code-block><div class=codeBlockTitle>t '.repeat(n / 4)}<pre>x</pre>${'</div></div>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: Expressive Code frames in their titles',
      markdown(
        `<main>${'<figure class=frame><figcaption class=header><span class=title>t '.repeat(n / 4)}<pre>x</pre>${'</span></figcaption></figure>'.repeat(n / 4)}</main>`,
      ),
    ],
    [
      'Markdown: labels in labels in a code group',
      markdown(
        `<main><div class=vp-code-group>${'<label>a '.repeat(n / 4)}${'</label>'.repeat(n / 4)}<pre>x</pre></div></main>`,
      ),
    ],
    ['Markdown: loose list items', markdown(`<main><ul>${'<li> <p>x'.repeat(n / 4)}</ul></main>`)],
    [
      'Markdown: code spans with backticks',
      markdown(`<main><p>${'<code>a`b</code>'.repeat(n)}</main>`),
    ],
    ['Markdown: unclosed links', markdown(`<main>${'<a href=/x>y '.repeat(n)}</main>`)],
    [
      'Markdown: many links and images',
      markdown(`<main>${'<a href="../a">b</a><img src=c alt=d>'.repeat(n / 4)}</main>`),
    ],
    ['Markdown: Markdown with unclosed link labels', md(`${'['.repeat(4 * n)}]`, false, true)],
    ['Markdown links with unclosed destinations', md('[a](('.repeat(n))],
    ['Markdown links without destinations', md('[a]('.repeat(n))],
    ['Markdown images with unclosed destinations', md('![a]('.repeat(n))],
    ['Resolved links with unclosed destinations', relinked('[a](('.repeat(n))],
    ['Resolved links with unclosed angle brackets', relinked('[a](<x '.repeat(n))],
    ['Resolved angle brackets across lines', relinked(`${'[a](<x\n'.repeat(n)}>`)],
    ['Resolved links, many of them', relinked('[a](./b.md) ![c](d.png "e")\n'.repeat(n / 4))],
    ['Resolved links without destinations', relinked('[a]('.repeat(n))],
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
    expect(timed(parse)).toBeLessThan(BUDGET_MS);
  });
});

describe('linear-time reading of a site config by init', () => {
  // A megabyte of config, as a site's config file with a large sidebar can be. When each match
  // was checked from the start of the source, the first two took 11.7 s and 14.3 s at 128 KB,
  // and the third 35 s.
  const megabyte = (unit: string) => unit.repeat(Math.ceil(2 ** 20 / unit.length));
  it.each([
    ['many `locales:` properties', `export default { ${megabyte('locales: x, ')} };`, false],
    ['many `{ i18n }` shorthands', `export default [${megabyte('{ i18n }, ')}];`, false],
    [
      'many commented-out locales',
      `${megabyte("// locales: { fr: { label: 'Français' } },\n")}export default {};`,
      true,
    ],
    // Each `/` after a `[` looked like a regular expression, read to the end of its line: 8.4 s
    // at 64 KB.
    [
      'a line of `/`s that start no regular expression',
      `${megabyte('[/')}\nexport default { i18n: { locales: ['en', 'fr'] } };`,
      false,
    ],
    // Each `const L:` read to the end of its line for an `=`: 0.77 s at 64 KB.
    [
      'a line of declarations without an `=`',
      `export default { i18n: L };\n${megabyte('const L: ')}`,
      false,
    ],
  ])('%s', (_, config, starlight) => {
    expect(timed(() => configLocales(config, starlight))).toBeLessThan(BUDGET_MS);
  });

  it('a line of exports without an `=`, in an imported file', () => {
    // As above, in the file the config imports its locales from: 0.87 s at 64 KB.
    const imported = megabyte('export const L: ');
    const read = (path: string) => (path === './i18n.mjs' ? imported : null);
    const config = "import { L } from './i18n.mjs';\nexport default { i18n: L };";
    expect(timed(() => configLocales(config, false, read))).toBeLessThan(BUDGET_MS);
  });

  it('a wrangler.jsonc of keys without commas', () => {
    // Each key was looked for from the last comma: 1.2 s at 64 KB.
    const config = `{\n${megabyte('"key": 1\n')}}\n`;
    expect(timed(() => wranglerWorkerConfig('wrangler.jsonc', config))).toBeLessThan(BUDGET_MS);
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
