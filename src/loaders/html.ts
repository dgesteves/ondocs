import { linkLabel, removeDelimited } from '../text/markdown';
import type { SourceDocument } from '../types';

export interface HtmlMeta {
  /** Document id, usually the file path relative to the content root. */
  id: string;
  /** URL of the page. */
  url: string;
  /** Title to use when the page has neither `<title>` nor `<h1>`. */
  fallbackTitle?: string;
  /**
   * The element that holds the page's own content. Default `main`, then `article`, then `body`.
   *
   * `article` reads the outermost `<article>` elements first, without the articles nested in them
   * (cards, teasers), and suits sites whose `<main>` also holds a table of contents or
   * pagination. In a Docusaurus page it reads the doc's or blog post's Markdown container, so
   * breadcrumbs, the version badge and a post's date and authors are left out too; the title
   * still comes from the page's `<h1>`.
   *
   * Anything else is a selector, read from every element it matches (the outermost ones, each up
   * to its own closing tag): a tag name, `#id`, `.class`, `[attribute]` or `[attribute=value]`,
   * combined as in `div.content` or listed as in `main, .post`. There are no combinators. A page
   * where it matches nothing has no content, so `fromHtml` returns `null`. Inside the elements it
   * selects, `<aside>`s are kept: there they are callouts, such as Starlight's notes and tips,
   * rather than a sidebar.
   */
  root?: string;
  /** Elements to leave out, as a selector like `root`'s, e.g. `[data-pagefind-ignore]`. */
  ignore?: string;
  /**
   * Write the content as Markdown to read, rather than text to index: links (relative ones as
   * root-relative URLs), emphasis, images, numbered and nested lists, tables with a header row
   * and quotes are kept, and headings lose their `{#id}`. What a page's `.md` copy holds.
   */
  markdown?: boolean;
}

/** Elements whose content is never prose. */
const DROP_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'select',
  'button',
  'form',
  'nav',
  'aside',
  'footer',
  'dialog',
];

/** Inside a region chosen with a selector, `<aside>` is a callout. */
const REGION_DROP_ELEMENTS = DROP_ELEMENTS.filter((tag) => tag !== 'aside');

/** After a tag name: the name has ended (so `<nav` does not match the custom element `<nav-link>`). */
const NAME_END = '(?=[\\s/>])';

const BASIC_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  trade: '™',
  rarr: '→',
  larr: '←',
  euro: '€',
  // Invisible characters SSGs put in heading permalinks; they carry no text.
  ZeroWidthSpace: '',
  zwj: '',
  zwnj: '',
  lrm: '',
  rlm: '',
};

// Named entities for U+00A0 to U+00FF, in code point order.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn ' +
  'sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave ' +
  'Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN ' +
  'szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute ' +
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml ' +
  'yacute thorn yuml';

const NAMED_ENTITIES = new Map<string, string>([
  ...LATIN1.split(' ').map((name, i): [string, string] => [name, String.fromCharCode(0xa0 + i)]),
  ...Object.entries(BASIC_ENTITIES),
]);

/**
 * Decodes numeric entities, the Latin-1 named set, and the typographic and invisible entities
 * static site generators emit. Names are case-sensitive (`&Eacute;` is not `&eacute;`), with a
 * case-insensitive fallback for legacy forms like `&AMP;`.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][\da-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z\d]{1,31});/g,
    (match, entity: string) => {
      if (entity.startsWith('#')) {
        const hex = entity[1] === 'x' || entity[1] === 'X';
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES.get(entity) ?? BASIC_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^<>]*>/g, ''));
}

/** The value of attribute `name` in the opening tag `tag`, quoted or not. */
export function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

interface Element {
  /** The opening tag's match, with its capture groups. */
  open: RegExpExecArray;
  /** Where the opening tag starts and where the closing tag ends. */
  start: number;
  end: number;
  inner: string;
}

/**
 * The elements in `html`, left to right: an opening tag matched by `open` (a global, case
 * insensitive pattern), up to the first closing tag `close(match)` after it. The same matches as
 * `/<tag …>([\s\S]*?)<\/tag>/gi`, in linear time: once a closing tag is missing after some
 * point it is missing after every later point too, so it is never searched for again (the regex
 * searches again from every opening tag, which is quadratic).
 */
function* elements(
  html: string,
  open: RegExp,
  close: (match: RegExpExecArray) => string,
): Generator<Element> {
  const pattern = new RegExp(open);
  const closers = new Map<string, RegExp>();
  const missingFrom = new Map<string, number>();
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const tag = close(match);
    const innerStart = match.index + match[0].length;
    if (innerStart >= (missingFrom.get(tag) ?? Number.POSITIVE_INFINITY)) continue;
    let closer = closers.get(tag);
    if (!closer) {
      closer = new RegExp(tag, 'gi');
      closers.set(tag, closer);
    }
    closer.lastIndex = innerStart;
    const end = closer.exec(html);
    if (!end) {
      missingFrom.set(tag, innerStart);
      continue;
    }
    pattern.lastIndex = end.index + end[0].length;
    yield {
      open: match,
      start: match.index,
      end: pattern.lastIndex,
      inner: html.slice(innerStart, end.index),
    };
  }
}

/**
 * The outermost `tag` elements in `html`, left to right, each up to its own closing tag, so an
 * element of the same name nested inside does not end it (`elements` stops at the first closing
 * tag). One that is never closed ends at the first closing tag after it, as `elements` reads it.
 * Linear: the tags are found in one scan and paired with a stack.
 */
function* outermost(html: string, tag: string): Generator<Element> {
  const pattern = new RegExp(`<(/?)${tag}${NAME_END}[^<>]*>`, 'gi');
  const tags: { match: RegExpExecArray; close: boolean; end: number }[] = [];
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    tags.push({ match, close: match[1] === '/', end: pattern.lastIndex });
  }
  // closer[i]: the closing tag that pairs with opening tag i, else the first one after it.
  const closer: (number | undefined)[] = [];
  const unclosed: number[] = [];
  tags.forEach(({ close }, i) => {
    if (!close) {
      unclosed.push(i);
      return;
    }
    const opened = unclosed.pop();
    if (opened !== undefined) closer[opened] = i;
  });
  let next: number | undefined;
  for (let i = tags.length - 1; i >= 0; i--) {
    if (tags[i]?.close) next = i;
    else closer[i] ??= next;
  }
  for (let i = 0; i < tags.length; i++) {
    const open = tags[i];
    if (!open || open.close) continue;
    const j = closer[i];
    const close = j === undefined ? undefined : tags[j];
    // No closing tag after this one, so none after any later one either.
    if (j === undefined || !close) return;
    yield {
      open: open.match,
      start: open.match.index,
      end: close.end,
      inner: html.slice(open.end, close.match.index),
    };
    i = j;
  }
}

/** `html` with each of `found` (left to right, not overlapping) replaced by `replace(element)`. */
function replaceEach<T extends { start: number; end: number }>(
  html: string,
  found: Iterable<T>,
  replace: (element: T) => string,
): string {
  let out = '';
  let last = 0;
  for (const element of found) {
    out += html.slice(last, element.start) + replace(element);
    last = element.end;
  }
  return out + html.slice(last);
}

/** `html` with each element `elements` finds replaced by `replace(element)`. */
function replaceElements(
  html: string,
  open: RegExp,
  close: (match: RegExpExecArray) => string,
  replace: (element: Element) => string,
): string {
  return replaceEach(html, elements(html, open, close), replace);
}

const openTag = (tag: string): RegExp => new RegExp(`<${tag}${NAME_END}[^<>]*>`, 'gi');

function innerOf(html: string, tag: string): string | undefined {
  for (const element of outermost(html, tag)) return element.inner;
  return undefined;
}

function innerOfAll(html: string, tag: string): string[] {
  return Array.from(outermost(html, tag), (element) => element.inner);
}

/** One compound selector, such as `div.note` or `[data-pagefind-body]`. */
interface Compound {
  tag?: string;
  /** `.class` matches one of the attribute's space-separated words; the others, its whole value. */
  attributes: { name: string; value?: string; word?: boolean }[];
}

const SELECTOR_TAG = /[a-z][a-z\d-]*|\*/iy;
const SELECTOR_PART =
  /([#.])([\w-]+)|\[\s*([\w:.-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\]]+))\s*)?\]/y;

/** Parses a comma-separated list of compound selectors; throws on anything else. */
function parseSelector(selector: string): Compound[] {
  return selector.split(',').map((text) => {
    const source = text.trim();
    const compound: Compound = { attributes: [] };
    SELECTOR_TAG.lastIndex = 0;
    const tag = SELECTOR_TAG.exec(source);
    let position = tag ? SELECTOR_TAG.lastIndex : 0;
    if (tag && tag[0] !== '*') compound.tag = tag[0].toLowerCase();
    while (position < source.length) {
      SELECTOR_PART.lastIndex = position;
      const part = SELECTOR_PART.exec(source);
      if (!part) break;
      position = SELECTOR_PART.lastIndex;
      const [, prefix, name = '', attribute = ''] = part;
      if (prefix === '.') compound.attributes.push({ name: 'class', value: name, word: true });
      else if (prefix === '#') compound.attributes.push({ name: 'id', value: name });
      else {
        const value = part[4] ?? part[5] ?? part[6];
        compound.attributes.push({
          name: attribute.toLowerCase(),
          ...(value === undefined ? {} : { value }),
        });
      }
    }
    if (!source || position < source.length) {
      throw new Error(
        `Unsupported selector "${selector}": use tag names, #ids, .classes and [attributes], combined as in div.content, in a comma-separated list.`,
      );
    }
    return compound;
  });
}

const TAG_ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The attributes of an opening tag, by lowercase name. Values are not decoded. */
function attributesOf(attributes: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of attributes.matchAll(TAG_ATTRIBUTE)) {
    const key = (match[1] ?? '').toLowerCase();
    if (!found.has(key)) found.set(key, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

function matchesCompound(
  compound: Compound,
  tag: string,
  attributes: Map<string, string>,
): boolean {
  if (compound.tag !== undefined && compound.tag !== tag) return false;
  return compound.attributes.every(({ name, value, word }) => {
    const actual = attributes.get(name);
    if (actual === undefined) return false;
    if (value === undefined) return true;
    return word ? actual.split(/\s+/).includes(value) : actual === value;
  });
}

interface Tag {
  /** Lowercase. */
  name: string;
  close: boolean;
  /** Where the tag starts and where it ends. */
  start: number;
  end: number;
  /** What follows the name, as written. */
  attributes: string;
}

/**
 * Every tag in `html`, left to right, and for each opening tag the index of the closing tag that
 * pairs with it, through a stack per tag name; none for one that is never closed. One scan.
 */
function pairedTags(html: string): { tags: Tag[]; closer: (number | undefined)[] } {
  const pattern = /<(\/?)([a-z][a-z\d-]*)(?=[\s/>])([^<>]*)>/gi;
  const tags: Tag[] = [];
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    tags.push({
      name: (match[2] ?? '').toLowerCase(),
      close: match[1] === '/',
      start: match.index,
      end: pattern.lastIndex,
      attributes: match[3] ?? '',
    });
  }
  const closer: (number | undefined)[] = [];
  const open = new Map<string, number[]>();
  tags.forEach(({ name, close }, i) => {
    let stack = open.get(name);
    if (!stack) {
      stack = [];
      open.set(name, stack);
    }
    if (!close) {
      stack.push(i);
      return;
    }
    const opened = stack.pop();
    if (opened !== undefined) closer[opened] = i;
  });
  return { tags, closer };
}

/**
 * The outermost elements `selector` matches, left to right, each up to its own closing tag; an
 * element that is never closed is not matched. Linear: every tag is found in one scan, paired
 * with its closing tag through a stack per tag name, and matched once.
 */
function* select(
  html: string,
  selector: string,
): Generator<{ start: number; end: number; inner: string }> {
  const compounds = parseSelector(selector);
  const { tags, closer } = pairedTags(html);
  let after = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const end = tags[closer[i] ?? -1];
    if (!tag || !end || tag.start < after) continue;
    const candidates = compounds.filter((c) => c.tag === undefined || c.tag === tag.name);
    if (candidates.length === 0) continue;
    const attributes = attributesOf(tag.attributes);
    if (!candidates.some((compound) => matchesCompound(compound, tag.name, attributes))) continue;
    yield { start: tag.start, end: end.end, inner: html.slice(tag.end, end.start) };
    after = end.end;
  }
}

/**
 * Where Docusaurus renders a page's Markdown: a doc's `theme-doc-markdown` container, or a blog
 * post's `__blog-post-container` (the element Docusaurus's own feeds read), without the
 * breadcrumbs, version badge, mobile table of contents, or a post's date and authors around it.
 */
function docusaurusMarkdown(html: string): string | undefined {
  if (!html.includes('theme-doc-markdown') && !html.includes('__blog-post-container')) {
    return undefined;
  }
  const pattern = /<([a-z][a-z\d-]*)(?=[\s/>])[^<>]*>/gi;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const tag = match[0];
    if (
      attribute(tag, 'class')?.split(/\s+/).includes('theme-doc-markdown') ||
      attribute(tag, 'id') === '__blog-post-container'
    ) {
      for (const element of outermost(html.slice(match.index), match[1] ?? '')) {
        return element.inner;
      }
      return undefined;
    }
  }
  return undefined;
}

const isSpace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/**
 * `html` with the `<` and `>` inside quoted attribute values written as entities, so every tag
 * reads as `<…>` with no bracket inside. Highlighters keep code in attributes (Expressive Code's
 * copy button holds the whole snippet in `data-code`), and a `>` there would otherwise end the
 * tag early and leak the rest of it as text. One forward scan: a quote that is never closed has
 * no later quote of its kind, so at most two searches for a closing quote run to the end.
 */
function escapeAttributeBrackets(html: string): string {
  let out = '';
  let last = 0;
  for (let i = html.indexOf('<'); i !== -1;) {
    let k = html[i + 1] === '/' ? i + 2 : i + 1;
    if (!/[a-z]/i.test(html.charAt(k))) {
      i = html.indexOf('<', i + 1);
      continue;
    }
    // Where to look for the next tag: after this one's `>`, or at a `<` that shows it was not one.
    let next = -1;
    let equals = false;
    for (; k < html.length; k++) {
      const c = html.charAt(k);
      if (c === '>' || c === '<') {
        next = c === '>' ? k + 1 : k;
        break;
      }
      // A quote opens a value only after `=`; elsewhere (`<p it's>`) it is just a character.
      if ((c === '"' || c === "'") && equals) {
        const close = html.indexOf(c, k + 1);
        if (close === -1) {
          next = k + 1;
          break;
        }
        const value = html.slice(k + 1, close);
        if (value.includes('<') || value.includes('>')) {
          out += html.slice(last, k + 1) + value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
          last = close;
        }
        k = close;
        equals = false;
      } else if (c === '=') equals = true;
      else if (!isSpace(c)) equals = false;
    }
    if (next === -1) break;
    i = html.indexOf('<', next);
  }
  return last === 0 ? html : out + html.slice(last);
}

/** True if any `<meta name="robots">` says noindex. Scans tag by tag, without backtracking. */
function isNoindex(html: string): boolean {
  const lower = html.toLowerCase();
  for (
    let start = lower.indexOf('<meta');
    start !== -1;
    start = lower.indexOf('<meta', start + 5)
  ) {
    const end = lower.indexOf('>', start);
    if (end === -1) return false;
    const tag = html.slice(start, end + 1);
    if (
      attribute(tag, 'name')?.toLowerCase() === 'robots' &&
      /noindex/i.test(attribute(tag, 'content') ?? '')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Turns an HTML page into a {@link SourceDocument} whose content is Markdown-shaped text.
 *
 * It reads `<main>` if the page has one, then the outermost `<article>`s, then `<body>`
 * (`root: 'article'` reads the articles first, and `root` can also be a selector; see
 * {@link HtmlMeta.root}). Navigation, scripts, styles, forms and other chrome are dropped, and so
 * is whatever `ignore` selects. Headings become `#` lines and keep their `id` attribute as the
 * anchor, and a heading without one gets none (`anchors: 'explicit'`); `<pre>` becomes a fenced
 * code block. Pages with
 * `<meta name="robots" content="noindex">` return `null`.
 *
 * This is a tag stripper, not a DOM parser: it is fast and dependency-free, and it expects the
 * well-formed output of a static site generator rather than arbitrary HTML.
 */
export function fromHtml(original: string, meta: HtmlMeta): SourceDocument | null {
  if (isNoindex(original)) return null;

  const source = escapeAttributeBrackets(original);
  const headTitle = innerOf(source, 'title');
  const selector = meta.root === 'main' || meta.root === 'article' ? undefined : meta.root;
  let html: string;
  if (selector === undefined) {
    const articles = innerOfAll(source, 'article');
    const article = articles.length > 0 ? articles.join('\n\n') : undefined;
    html =
      (meta.root === 'article'
        ? // Every <article> left inside the outermost ones is nested: a card or a teaser.
          ((article === undefined
            ? undefined
            : replaceEach(article, outermost(article, 'article'), () => ' ')) ??
          innerOf(source, 'main'))
        : (innerOf(source, 'main') ?? article)) ??
      innerOf(source, 'body') ??
      source;
  } else {
    // Commented-out markup and scripts are not elements of the page.
    let page = removeDelimited(source, '<!--', '-->');
    for (const tag of ['script', 'style']) {
      page = replaceElements(
        page,
        openTag(tag),
        () => `</${tag}>`,
        () => ' ',
      );
    }
    const regions = Array.from(select(page, selector), (region) => region.inner);
    if (regions.length === 0) return null;
    html = regions.join('\n\n');
  }
  html = removeDelimited(html, '<!--', '-->');
  if (meta.ignore) html = replaceEach(html, select(html, meta.ignore), () => ' ');
  for (const tag of selector === undefined ? DROP_ELEMENTS : REGION_DROP_ELEMENTS) {
    html = replaceElements(
      html,
      openTag(tag),
      () => `</${tag}>`,
      () => ' ',
    );
  }

  // The first <h1> beats <title>, which usually carries a " | Site name" suffix. It is read from
  // the whole root: a Docusaurus blog post's <h1> sits outside its Markdown container.
  const firstH1 = innerOf(html, 'h1');
  const title =
    (firstH1 && stripTags(firstH1).replace(/\s+/g, ' ').trim()) ||
    (headTitle && stripTags(headTitle).replace(/\s+/g, ' ').trim()) ||
    meta.fallbackTitle ||
    meta.id;

  const body = (meta.root === 'article' ? docusaurusMarkdown(html) : undefined) ?? html;
  const content = meta.markdown ? htmlToText(body, { url: linkBase(meta) }) : htmlToText(body);
  const description = metaDescription(original);
  // Headings link only to the ids the page has: one without an id has no anchor to land on.
  return {
    id: meta.id,
    url: meta.url,
    title,
    ...(description ? { description } : {}),
    content,
    anchors: 'explicit',
  };
}

/** The page's `<meta name="description">` (or `og:description`), decoded, or `undefined`. */
function metaDescription(html: string): string | undefined {
  const head = innerOf(html, 'head') ?? '';
  let og: string | undefined;
  for (
    let start = head.toLowerCase().indexOf('<meta');
    start !== -1;
    start = head.toLowerCase().indexOf('<meta', start + 5)
  ) {
    const end = head.indexOf('>', start);
    if (end === -1) break;
    const tag = head.slice(start, end + 1);
    const content = attribute(tag, 'content');
    if (!content?.trim()) continue;
    const name = (attribute(tag, 'name') ?? attribute(tag, 'property'))?.toLowerCase();
    const text = decodeEntities(content).replace(/\s+/g, ' ').trim();
    if (name === 'description') return text;
    if (name === 'og:description') og ??= text;
  }
  return og;
}

/** A fence longer than any backtick run inside the code, so the code can never close it. */
function fenceFor(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The URL a page's relative links resolve against: its own, or for a folder's `index.html` read
 * from a file, whose URL is the folder's (`guide/index.html` is `/guide`), the folder with a
 * trailing slash, where a server serves it and the browser resolves its links.
 */
function linkBase({ id, url }: HtmlMeta): string {
  const folderPage = /(?:^|\/)(?:_?index|readme)\.html?$/i.test(id);
  return folderPage && !/(?:\/|\.html?)$/i.test(url) ? `${url}/` : url;
}

/** How many levels of quotes a Markdown copy writes. */
const MAX_QUOTE_DEPTH = 4;

/**
 * Permalink anchors (`#`, `¶`, an invisible character or entity, such as the zero-width space
 * Docusaurus writes, or an emptied icon) are not heading text.
 * The second `\s*` sits inside the optional group, so whitespace has one way to match.
 */
const PERMALINK =
  /<a(?=[\s>])[^<>]*>\s*(?:(?:[#¶§\u200B-\u200D\u2060\uFEFF]|&[A-Za-z]+;|&#x?[\da-fA-F]+;)\s*)?<\/a>/gi;

/**
 * The text of a page's HTML, Markdown-shaped. With `markdown` (the page's URL, to resolve its
 * relative links against), it is Markdown to read: links, emphasis, images, numbered and nested
 * lists, tables and quotes are kept, and headings have no `{#id}`. Without it, the text an index
 * holds, which those would only add noise to.
 *
 * A quote's content is read as `quoted`: with the blocks already swapped out of the page around
 * it, so the code blocks in it are written into it, and how deep in quotes it is.
 */
function htmlToText(
  html: string,
  markdown?: { url: string },
  quoted?: { blocks: string[]; depth: number },
): string {
  // Code blocks (and, for Markdown, tables and quotes) are swapped out first so whitespace
  // normalization never touches them.
  const blocks: string[] = quoted?.blocks ?? [];
  const keep = (block: string): string => {
    blocks.push(block);
    return `\n\n\uE000${String(blocks.length - 1)}\uE000\n\n`;
  };
  let withoutCode = replaceElements(
    html,
    /<pre(?=[\s>])[^<>]*>/gi,
    () => '</pre>',
    ({ open, inner }) => {
      // A line is a `<br>`, or a `<div>` (Expressive Code, which Starlight uses, writes each line
      // as one with no newline between them). A line's own newline, kept in the markup next to
      // or inside its `<div>`, does not count twice.
      const body = stripTags(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\uE001'))
        .replace(/\n?\uE001+\n?/g, '\n')
        // Not `/^\n+|\s+$/g`: `\s+$` started a match at each character of a run of blank lines
        // inside the block, and each failed at the run's end, which is quadratic.
        .replace(/^\n+/, '')
        .trimEnd();
      const fence = fenceFor(body);
      // Markdown keeps the language, as highlighters record it on <pre> or its <code>.
      const language = markdown ? codeLanguage(open[0], inner) : '';
      return keep(`${fence}${language}\n${body}\n${fence}`);
    },
  );
  // A quote's content was read with the page around it.
  if (!quoted) withoutCode = structure(withoutCode, blocks, markdown !== undefined);
  if (markdown) {
    withoutCode = replaceEach(withoutCode, outermost(withoutCode, 'table'), ({ inner }) =>
      keep(markdownTable(inner, markdown.url)),
    );
    // Each level of quotes reads its content again, so only a few levels are quotes: deeper ones
    // (no page has them) are text in the innermost, and the work stays linear.
    const depth = quoted?.depth ?? 0;
    if (depth < MAX_QUOTE_DEPTH) {
      withoutCode = replaceEach(withoutCode, outermost(withoutCode, 'blockquote'), ({ inner }) =>
        keep(
          htmlToText(inner, markdown, { blocks, depth: depth + 1 })
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n'),
        ),
      );
    }
    withoutCode = markdownLists(withoutCode).replace(/<hr(?=[\s/>])[^<>]*>/gi, '\n\n---\n\n');
  }
  const withHeadings = replaceElements(
    withoutCode,
    /<h([1-6])(?=[\s>])([^<>]*)>/gi,
    (open) => `</h${open[1] ?? ''}>`,
    ({ open, inner }) => {
      // Entities are decoded once, at the end, for everything outside code blocks. Markdown
      // keeps a heading's code: "## The `ask` option".
      const heading = (markdown ? codeSpans(inner) : inner)
        .replace(PERMALINK, '')
        .replace(/<[^<>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[#¶§] | [#¶§]$/g, '');
      if (!heading) return '\n\n';
      const id = markdown ? undefined : attribute(` ${open[2] ?? ''}`, 'id');
      return `\n\n${'#'.repeat(Number(open[1]))} ${heading}${id ? ` {#${id}}` : ''}\n\n`;
    },
  );
  let text = codeSpans(
    (markdown ? withHeadings : withHeadings.replace(LIST_ITEM, '\n- '))
      .replace(
        /<\/(?:p|div|section|article|header|ul|ol|table|blockquote|dl|figure|details|summary)>/gi,
        '\n\n',
      )
      // They close a paragraph left open, as minified HTML leaves it: "plugins.<details>".
      .replace(/<(?:details|summary)(?=[\s>])[^<>]*>/gi, '\n\n')
      .replace(/<tr(?=[\s>])[^<>]*>/gi, '\n| ')
      .replace(/<(?:p|div|section|br|dt|dd|hr|blockquote|figcaption)(?=[\s/>])[^<>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | '),
  );
  if (markdown) text = markdownInline(text, markdown.url);

  return decodeEntities(text.replace(/<[^<>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\uE002(\d+)\uE002/g, (_, depth: string) => '  '.repeat(Number(depth)))
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => blocks[Number(index)] ?? '');
}

/**
 * A code block's language, from `data-language` (Expressive Code) or a `language-*` class on the
 * `<pre>` or its first `<code>` (Prism, Shiki, highlight.js); empty when it names none.
 */
function codeLanguage(pre: string, inner: string): string {
  const code = /^\s*<code(?=[\s>])[^<>]*>/i.exec(inner)?.[0] ?? '';
  for (const tag of [pre, code]) {
    const named = attribute(tag, 'data-language');
    if (named && /^[\w+#.-]{1,30}$/.test(named) && named !== 'plaintext') return named;
    const language = /(?:^|\s)(?:language|lang)-([\w+#.-]{1,30})(?=\s|$)/.exec(
      attribute(tag, 'class') ?? '',
    )?.[1];
    if (language) return language;
  }
  return '';
}

/** The markup `structure` reads; a page without any of it is left as it is. */
const STRUCTURE_HINT =
  /role|vp-code-group|admonition|starlight-aside|custom-block|code-block|frame/i;

/** The types VitePress writes as a custom block's class, beside `custom-block`. */
const CUSTOM_BLOCK_TYPES = new Set([
  'note',
  'tip',
  'info',
  'important',
  'warning',
  'caution',
  'danger',
]);

const classesOf = (attributes: Map<string, string>): string[] =>
  (attributes.get('class') ?? '').split(/\s+/);

/** An admonition's type: a Docusaurus admonition's, a Starlight aside's or a VitePress block's. */
function admonitionType(tag: Tag, classes: readonly string[]): string | undefined {
  for (const word of classes) {
    const type = /^(?:theme-admonition-|starlight-aside--)([a-z][a-z-]*)$/.exec(word)?.[1];
    if (type) return type;
  }
  return tag.name !== 'details' && classes.includes('custom-block')
    ? classes.find((word) => CUSTOM_BLOCK_TYPES.has(word))
    : undefined;
}

const isAdmonitionTitle = (classes: readonly string[]): boolean =>
  classes.some(
    (word) =>
      /^admonitionHeading(?:_|$)/.test(word) ||
      word === 'starlight-aside__title' ||
      word === 'custom-block-title',
  );

/**
 * What an admonition is called: its type ("Tip"), and its title when that says something else
 * ("Tip: My tip"). The index keeps a title that is only the type as the page writes it.
 */
function admonitionLabel(type: string, title: string, markdown: boolean): string {
  const name = `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  if (!title) return name;
  if (title.toLowerCase() === type.toLowerCase()) return markdown ? name : title;
  return `${name}: ${title}`;
}

/**
 * `text` as Markdown that reads as the text itself: a backslash, `*` and `` ` `` escaped, and a
 * `_` that is not inside a word (one inside a word, as in `my_file`, is never emphasis).
 */
const markdownText = (text: string): string =>
  text.replace(/[\\`*]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\$&');

/**
 * A code block's title as the value of a fence's `title=`, quoted as Docusaurus, Expressive Code
 * and rehype-pretty-code read it: in double quotes, or in single quotes when it holds a double
 * quote and no single one (with both, its double quotes and backslashes are escaped, so a title
 * that ends in `\` still closes). A backtick fence's info string cannot hold a backtick, so those
 * go. Empty for a title with no text.
 */
function fenceTitle(text: string): string {
  const title = text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  if (!title.includes('"')) return `"${title}"`;
  if (!title.includes("'")) return `'${title}'`;
  return `"${title.replace(/["\\]/g, '\\$&')}"`;
}

/** The labels of a list of tabs, for its panels: by the tab a panel names, else in order. */
interface Tabs {
  labels: string[];
  ids: Map<string, number>;
  used: Set<number>;
  next: number;
}

function takeLabel(tabs: Tabs, id: string | undefined): string | undefined {
  let n = id === undefined ? undefined : tabs.ids.get(id);
  if (n === undefined || tabs.used.has(n)) {
    while (tabs.used.has(tabs.next)) tabs.next += 1;
    n = tabs.next;
  }
  tabs.used.add(n);
  return tabs.labels[n];
}

/**
 * What a page's markup says that its text would lose, written into it before the rest is read:
 *
 * - Each tab panel starts with its tab's label, so a command says which package manager it is
 *   for: Docusaurus's and Starlight's tabs, by their ARIA roles, and VitePress's code groups. The
 *   list of tabs itself goes.
 * - An admonition (a Docusaurus admonition, a Starlight aside, a VitePress custom block) is a
 *   quote that starts with its type and title: "Danger: Take care".
 * - In Markdown, a code block's title (Docusaurus's, or Expressive Code's) goes on its fence, as
 *   `title="…"`, instead of a line of its own.
 *
 * `blocks` are the code blocks already swapped out of `html`. Linear: one scan over the tags, and
 * what an element holds is read again only for one the scan then skips (a list of tabs, a code
 * group, an admonition's or a code block's title, each replaced as a whole), or for the first
 * two tags in it. So no text is read twice, however deep elements nest in each other's titles.
 */
function structure(html: string, blocks: string[], markdown: boolean): string {
  if (!STRUCTURE_HINT.test(html)) return html;
  const { tags, closer } = pairedTags(html);
  const code = Array.from(html.matchAll(/\uE000(\d+)\uE000/g), (match) => ({
    at: match.index,
    block: Number(match[1]),
  }));
  let nextCode = 0;
  // By tag: the text that replaces it, or the element it opens (up to tag `to`), and the text
  // that goes after it.
  const replaced = new Map<number, { to: number; text: string }>();
  const after = new Map<number, string>();
  const textOf = (from: number, to: number): string =>
    html
      .slice(from, to)
      .replace(/<[^<>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  // A label is the page's text, which Markdown must not read as emphasis or code.
  const label = (text: string): string =>
    text ? `<p><strong>${markdown ? markdownText(text) : text}</strong></p>` : '';
  // The tabs whose panels come next, and while in a panel, those of the lists around it.
  let tabs: Tabs | undefined;
  const around: { until: number; tabs: Tabs | undefined }[] = [];
  for (let i = 0; i < tags.length; i++) {
    while (around.length > 0 && i >= (around.at(-1)?.until ?? 0)) tabs = around.pop()?.tabs;
    const tag = tags[i];
    const j = closer[i];
    const end = j === undefined ? undefined : tags[j];
    if (!tag || tag.close || j === undefined || !end) continue;
    if (!STRUCTURE_HINT.test(tag.attributes)) continue;
    const attributes = attributesOf(tag.attributes);
    const classes = classesOf(attributes);
    const role = attributes.get('role');

    if (role === 'tablist') {
      // A tab's label runs to the next tab, as minified HTML leaves out its `</li>`.
      const found: { id: string | undefined; start: number; end: number }[] = [];
      for (let k = i + 1; k < j; k++) {
        const tab = tags[k];
        if (!tab || tab.close || !/role\s*=/i.test(tab.attributes)) continue;
        const own = attributesOf(tab.attributes);
        if (own.get('role') !== 'tab') continue;
        found.push({ id: own.get('id'), start: tab.start, end: tab.end });
      }
      const labels = found.map((tab, n) => textOf(tab.end, found[n + 1]?.start ?? end.start));
      const ids = new Map<string, number>();
      found.forEach((tab, n) => {
        if (tab.id !== undefined && !ids.has(tab.id)) ids.set(tab.id, n);
      });
      tabs = { labels, ids, used: new Set(), next: 0 };
      replaced.set(i, { to: j, text: ' ' });
      i = j;
      continue;
    }

    if (role === 'tabpanel' && tabs) {
      const text = takeLabel(tabs, attributes.get('aria-labelledby'));
      if (text) after.set(i, label(text));
      around.push({ until: j, tabs });
      tabs = undefined;
      continue;
    }

    if (classes.includes('vp-code-group')) {
      while (nextCode < code.length && (code[nextCode]?.at ?? 0) < tag.end) nextCode += 1;
      const inGroup: string[] = [];
      for (let c = nextCode; c < code.length && (code[c]?.at ?? 0) < end.start; c++) {
        inGroup.push(`\uE000${String(code[c]?.block)}\uE000`);
      }
      if (inGroup.length > 0) {
        const labels: string[] = [];
        for (let k = i + 1; k < j; k++) {
          const tab = tags[k];
          if (tab?.name !== 'label' || tab.close) continue;
          const close = closer[k];
          const to = close !== undefined && close < j ? tags[close] : tags[k + 1];
          labels.push(textOf(tab.end, to?.start ?? end.start));
          // A label in a label is part of its text, not one to read again.
          if (close !== undefined && close < j) k = close;
        }
        const text = inGroup.map((block, n) => `${label(labels[n] ?? '')}\n\n${block}\n\n`);
        replaced.set(i, { to: j, text: text.join('') });
        i = j;
        continue;
      }
    }

    const type = admonitionType(tag, classes);
    if (type) {
      // The title is the admonition's first element in each.
      const t = closer[i + 1];
      const first = tags[i + 1];
      const firstEnd = t === undefined ? undefined : tags[t];
      let title = '';
      let read = i;
      if (t !== undefined && first && firstEnd && !first.close && t < j) {
        if (isAdmonitionTitle(classesOf(attributesOf(first.attributes)))) {
          title = textOf(first.end, firstEnd.start);
          replaced.set(i + 1, { to: t, text: ' ' });
          read = t;
        }
      }
      const text = label(admonitionLabel(type, title, markdown));
      replaced.set(i, { to: i, text: `<blockquote>${text}` });
      replaced.set(j, { to: j, text: '</blockquote>' });
      // The title was read, and is replaced as a whole: the scan goes on after it.
      i = read;
      continue;
    }

    if (
      markdown &&
      (classes.includes('theme-code-block') || (tag.name === 'figure' && classes.includes('frame')))
    ) {
      // Docusaurus's title is the container's first element; Expressive Code's, in the frame's
      // `<figcaption>`, its second.
      for (const k of [i + 1, i + 2]) {
        const t = closer[k];
        const title = tags[k];
        const titleEnd = t === undefined ? undefined : tags[t];
        if (t === undefined || !title || !titleEnd || title.close || t >= j) continue;
        const own = classesOf(attributesOf(title.attributes));
        if (!own.some((word) => /^codeBlockTitle(?:_|$)/.test(word) || word === 'title')) continue;
        // The block the title is for, before the title is read: the blocks are passed in order,
        // so a block in a title is behind the scan, and of a chain of titles in titles, only the
        // outermost has one.
        while (nextCode < code.length && (code[nextCode]?.at ?? 0) < titleEnd.end) nextCode += 1;
        const block = code[nextCode];
        if (!block || block.at >= end.start) break;
        const text = fenceTitle(decodeEntities(textOf(title.end, titleEnd.start)));
        if (!text) break;
        blocks[block.block] = (blocks[block.block] ?? '').replace(
          /^(`+)(.*)/,
          (_, fence: string, info: string) => `${fence}${info || 'text'} title=${text}`,
        );
        replaced.set(k, { to: t, text: ' ' });
        // The title is replaced as a whole: the scan goes on after it.
        i = t;
        break;
      }
    }
  }
  if (replaced.size === 0 && after.size === 0) return html;
  // In order: what an element replaced holds (a title's own markup) is replaced with it.
  let out = '';
  let last = 0;
  for (let i = 0; i < tags.length; i++) {
    const edit = replaced.get(i);
    const tag = tags[i];
    const to = edit ? tags[edit.to] : undefined;
    if (edit && tag && to) {
      out += html.slice(last, tag.start) + edit.text;
      last = to.end;
      i = edit.to;
    }
    const text = after.get(i);
    const at = tags[i];
    if (text !== undefined && at) {
      out += html.slice(last, at.end) + text;
      last = at.end;
    }
  }
  return out + html.slice(last);
}

/**
 * `href` as a Markdown link target: absolute URLs and fragments as they are, anything else
 * resolved against the page's URL into a root-relative one. `null` for a scheme a reader should
 * not follow, such as `javascript:`.
 */
function linkTarget(href: string, page: string): string | null {
  const value = decodeEntities(href).trim();
  if (!value || value.startsWith('#')) return value || null;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme) return ['http', 'https', 'mailto'].includes(scheme) ? value : null;
  const base = 'https://ondocs.invalid';
  try {
    const resolved = new URL(value, new URL(page, `${base}/`));
    return resolved.origin === base
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : resolved.href;
  } catch {
    return null;
  }
}

/** Links, images and emphasis as Markdown; the tags they were are dropped later. */
function markdownInline(html: string, page: string): string {
  // A page links to the same few places over and over: resolve each once.
  const targets = new Map<string, string | null>();
  const target = (href: string): string | null => {
    let resolved = targets.get(href);
    if (resolved === undefined && !targets.has(href)) {
      resolved = linkTarget(href, page);
      targets.set(href, resolved);
    }
    return resolved ?? null;
  };
  const withImages = html.replace(/<img(?=[\s/>])[^<>]*>/gi, (tag) => {
    const alt = decodeEntities(attribute(tag, 'alt') ?? '')
      .replace(/[[\]]/g, '')
      .trim();
    const src = target(attribute(tag, 'src') ?? '');
    return alt && src ? `![${alt}](${src})` : alt;
  });
  const withLinks = replaceElements(
    withImages,
    /<a(?=[\s>])([^<>]*)>/gi,
    () => '</a>',
    ({ open, inner }) => {
      const label = inner
        .replace(/<[^<>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const href = target(attribute(` ${open[1] ?? ''}`, 'href') ?? '');
      if (!label) return '';
      return href ? `[${linkLabel(label)}](${href.replace(/[()\s]/g, encodeURIComponent)})` : label;
    },
  );
  return withLinks
    .replace(/<\/?(?:strong|b)(?=[\s>])[^<>]*>/gi, '**')
    .replace(/<\/?(?:em|i)(?=[\s>])[^<>]*>/gi, '*');
}

/**
 * An `<li>` tag, with the `<p>` that opens a loose list's item, whose text goes on the item's
 * line: `- First item`, not `-` and then the text as a paragraph of its own.
 */
const LIST_ITEM = /<li(?=[\s>])[^<>]*>(?:\s*<p(?=[\s>])[^<>]*>)?/gi;

/** A list tag, with the `<p>` that opens a loose list's item after an `<li>`. */
const LIST_TAG = /<(\/?)(ul|ol|li)(?=[\s/>])([^<>]*)>(\s*<p(?=[\s>])[^<>]*>)?/gi;

/**
 * Lists as Markdown: each `<li>` starts a line with `- `, or its number in an `<ol>`, counted from
 * the list's `start`, indented two spaces per level of nesting (written as a marker that survives
 * the trimming of lines). A loose list's `<li><p>` is one line too. One scan over the list tags,
 * with a stack of the lists open.
 */
function markdownLists(html: string): string {
  const open: { ordered: boolean; next: number }[] = [];
  const markdownOf = (
    close: string,
    name: string,
    attributes: string,
    item: string | undefined,
  ) => {
    const tag = name.toLowerCase();
    const paragraph = item ?? '';
    if (tag === 'li') {
      if (close) return paragraph;
      const list = open.at(-1);
      const depth = Math.max(0, open.length - 1);
      const marker = list?.ordered ? `${String(list.next++)}.` : '-';
      return `\n\uE002${String(depth)}\uE002${marker} `;
    }
    // A list nested in an item continues it; one at the top stands apart.
    if (close) open.pop();
    else {
      const start = Number.parseInt(attribute(` ${attributes}`, 'start') ?? '', 10);
      open.push({ ordered: tag === 'ol', next: start >= 0 ? start : 1 });
    }
    return (open.length > (close ? 0 : 1) ? '' : '\n\n') + paragraph;
  };
  // The whitespace before a list tag goes with it, so items are not a blank line apart. It is
  // trimmed off the text before the tag: a leading `\s*` in the pattern would scan a long run of
  // whitespace again from each of its characters.
  let lists = '';
  let end = 0;
  for (const match of html.matchAll(LIST_TAG)) {
    lists += html.slice(end, match.index).trimEnd();
    lists += markdownOf(match[1] ?? '', match[2] ?? '', match[3] ?? '', match[4]);
    end = match.index + match[0].length;
  }
  return lists + html.slice(end);
}

const CODE = /<code(?=[\s>])[^<>]*>/gi;

/** `html` with each `<code>` element written as a Markdown code span. */
function codeSpans(html: string): string {
  return replaceElements(
    html,
    CODE,
    () => '</code>',
    ({ inner }) => codeSpan(inner.replace(/<[^<>]*>/g, '')),
  );
}

/**
 * `code` (HTML text, decoded later) as a code span: between backtick runs longer than any in it,
 * with a space inside each when it holds a backtick, so `` a`b `` is one span, or when it starts
 * and ends with a space, which a span would otherwise lose.
 */
function codeSpan(code: string): string {
  const text = decodeEntities(code);
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = '`'.repeat(longest + 1);
  const spaced = text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '';
  const pad = longest > 0 || spaced ? ' ' : '';
  return `${ticks}${pad}${code}${pad}${ticks}`;
}

/**
 * A table's rows as a Markdown table: the first row is the header, and cells keep their links.
 * Rows and cells run from one opening tag to the next, as minified HTML omits the optional
 * `</tr>`, `</th>` and `</td>`.
 */
function markdownTable(html: string, page: string): string {
  const cell = (inner: string): string =>
    decodeEntities(
      markdownInline(codeSpans(inner.replace(/<\/t[hd]>[\s\S]*$/i, '')), page).replace(
        /<[^<>]*>/g,
        ' ',
      ),
    )
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\|/g, '\\|');
  const rows = html
    .split(/<tr(?=[\s>])[^<>]*>/i)
    .slice(1)
    .map((row) =>
      row
        .split(/<t[hd](?=[\s>])[^<>]*>/i)
        .slice(1)
        .map(cell),
    )
    .filter((cells) => cells.length > 0);
  const [header, ...body] = rows;
  if (!header) return '';
  const width = Math.max(...rows.map((cells) => cells.length));
  const line = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [
    line(header),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map(line),
  ].join('\n');
}
