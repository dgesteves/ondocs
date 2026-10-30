import { parse as parseYaml } from 'yaml';

import {
  mapOutsideCodeSpans,
  mdxCommentId,
  parseAtxHeading,
  removeDelimited,
  splitFenced,
} from '../text/markdown';
import { plainHeading } from '../text/slug';
import type { SourceDocument } from '../types';

export interface MarkdownMeta {
  /** Document id, usually the file path relative to the content root. */
  id: string;
  /** URL to use when the frontmatter has no `url` or `permalink`. */
  url: string;
  /** Title to use when there is neither a frontmatter `title` nor a leading `# Heading`. */
  fallbackTitle?: string;
  /** Treat the source as MDX: drop `import`/`export` lines and unwrap JSX elements. */
  mdx?: boolean;
  /**
   * Keep the content as Markdown to read, rather than text to index: links, images and link
   * definitions stay. What a page's `.md` copy holds.
   */
  markdown?: boolean;
}

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/** Splits YAML frontmatter from the body. A document without frontmatter has empty `data`. */
export function parseFrontmatter(source: string): Frontmatter {
  const match = FRONTMATTER.exec(source);
  if (!match) return { data: {}, body: source.replace(/^\uFEFF/, '') };
  const parsed: unknown = parseYaml(match[1] ?? '');
  const data =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, body: source.slice(match[0].length) };
}

/**
 * Turns a Markdown or MDX source into a {@link SourceDocument}.
 *
 * Frontmatter keys it reads: `title`, `url` (or `permalink`), and `draft: true`, `ask: false` or
 * `noindex: true` to leave the page out (the function then returns `null`).
 *
 * MDX support is text extraction, not evaluation: imports, exports and JSX comments are dropped,
 * JSX tags are removed and their children kept. Fenced code blocks are left exactly as written.
 */
export function fromMarkdown(source: string, meta: MarkdownMeta): SourceDocument | null {
  const { data, body } = parseFrontmatter(source);
  if (data.draft === true || data.ask === false || data.noindex === true) return null;

  const segments = splitFenced(body.replace(/\r\n?/g, '\n'));
  const content = segments
    .map((segment) =>
      segment.code
        ? segment.text
        : cleanProse(segment.text, meta.mdx ?? false, meta.markdown ?? false),
    )
    .join('\n')
    .trim();
  const title =
    stringField(data.title) ?? firstH1(splitFenced(content)) ?? meta.fallbackTitle ?? meta.id;
  const url = stringField(data.url) ?? stringField(data.permalink) ?? meta.url;
  const description = stringField(data.description);

  return { id: meta.id, url, title, ...(description ? { description } : {}), content };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The text of the first `# Heading` outside code blocks. */
function firstH1(segments: ReturnType<typeof splitFenced>): string | undefined {
  for (const segment of segments) {
    if (segment.code) continue;
    for (const line of segment.text.split('\n')) {
      const heading = parseAtxHeading(line);
      if (heading?.level === 1) return plainHeading(heading.text) || undefined;
    }
  }
  return undefined;
}

function cleanProse(prose: string, mdx: boolean, markdown: boolean): string {
  const text = mdx ? removeEsm(keepHeadingIds(prose)) : prose;
  return mapOutsideCodeSpans(removeDelimited(text, '<!--', '-->'), (part) =>
    cleanText(part, mdx, markdown),
  ).replace(/\n{3,}/g, '\n\n');
}

const ESM_START = /^(?:import|export)\s/;
const FENCE_LIKE = /^\s*(?:`{3,}|~{3,})/;
/** Lines after which MDX starts a block: a JSX tag or `{expression}` on its own line, a thematic break or a setext underline. */
const BLOCK_LINE = /^ {0,3}(?:<\/?[A-Za-z][^<>]*>|\{.*\}|(?:[-*_][ \t]*){3,}|=+[ \t]*|-+[ \t]*)$/;

/**
 * MDX's `import` and `export` blocks dropped: one starts a line that starts a block (the first
 * line, or one after a blank line or a heading), and runs to the next blank line. A line that
 * continues a paragraph is text, as MDX reads it, even when it starts with `export `.
 */
function removeEsm(prose: string): string {
  if (!prose.includes('import') && !prose.includes('export')) return prose;
  const kept: string[] = [];
  let inEsm = false;
  let inFence = false;
  let blockStart = true;
  for (const line of prose.split('\n')) {
    const blank = line.trim() === '';
    const fence = FENCE_LIKE.test(line);
    if (inEsm) {
      // A fence line ends it too: code that is not a fence here, such as one indented in JSX.
      if (!blank && !fence) continue;
      inEsm = false;
    } else if (!inFence && blockStart && ESM_START.test(line)) {
      inEsm = true;
      continue;
    }
    // A fence indented in JSX is code to MDX: an `export` line inside it stays.
    if (fence) inFence = !inFence;
    kept.push(line);
    blockStart = blank || parseAtxHeading(line) !== null || BLOCK_LINE.test(line);
  }
  return kept.join('\n');
}

// In MDX, Docusaurus reads a heading's id from an MDX comment at its end, `{/* #id */}`. MDX
// comments are dropped below, so on heading lines that one becomes `{#id}` first, which the
// chunker reads as the anchor.
function keepHeadingIds(prose: string): string {
  if (!prose.includes('{/*')) return prose;
  return prose
    .split('\n')
    .map((line) => {
      const comment = parseAtxHeading(line) ? mdxCommentId(line.trimEnd()) : null;
      return comment ? `${comment.text} {#${comment.id}}` : line;
    })
    .join('\n');
}

function cleanText(input: string, mdx: boolean, markdown = false): string {
  let text = input;
  if (mdx) {
    text = removeDelimited(text, '{/*', '*/}').replace(
      /<\/?[A-Z][\w.]*(?:\s(?:[^<>{}]|\{[^{}]*\})*)?\/?>/g,
      '',
    );
  }
  const withoutTags = text.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/g, '');
  if (markdown) return withoutTags;
  return removeDefinitions(referenceLinks(inlineLinks(images(withoutTags))));
}

/*
 * Links and images become their text. Each function below matches what the regex in its comment
 * matches, but in linear time. A label runs from `[` to the first `]` after it, so every `[`
 * before that `]` has the same label end: when one fails, they all do, and the scan moves past
 * the `]` instead of retrying from each `[` (which made the regexes quadratic).
 */

/** `![alt](src)` → `alt`, as `/!\[([^\]]*)\]\([^)]*\)/g`. */
function images(text: string): string {
  let out = '';
  let last = 0;
  for (let from = 0; ;) {
    const start = text.indexOf('![', from);
    const close = start === -1 ? -1 : text.indexOf(']', start + 2);
    if (close === -1) break;
    if (text[close + 1] !== '(') {
      from = close + 1;
      continue;
    }
    const end = text.indexOf(')', close + 2);
    // No `)` here means none for any later image either.
    if (end === -1) break;
    out += text.slice(last, start) + text.slice(start + 2, close);
    last = from = end + 1;
  }
  return out + text.slice(last);
}

/** `[label](url)` → `label`, as `/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g`. */
function inlineLinks(text: string): string {
  if (!text.includes('](')) return text;
  const ends = destinationEnds(text);
  let out = '';
  let last = 0;
  for (let from = 0; ;) {
    const start = text.indexOf('[', from);
    const close = start === -1 ? -1 : text.indexOf(']', start + 1);
    if (close === -1) break;
    const end = close > start + 1 && text[close + 1] === '(' ? (ends[close + 2] ?? -1) : -1;
    if (end === -1) {
      from = close + 1;
      continue;
    }
    out += text.slice(last, start) + text.slice(start + 1, close);
    last = from = end + 1;
  }
  return out + text.slice(last);
}

/**
 * For each position, the index of the `)` that ends a link destination starting there, or -1.
 * A destination is any run of non-parentheses and `( … )` groups (which may hold `(` but not
 * `)`), the language of `(?:[^()]|\([^)]*\))*\)`. Filled right to left, so each position is
 * computed once from positions after it.
 */
function destinationEnds(text: string): Int32Array {
  const ends = new Int32Array(text.length + 1).fill(-1);
  let nextClose = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === ')') {
      ends[i] = i;
      nextClose = i;
    } else if (char === '(') {
      ends[i] = nextClose === -1 ? -1 : (ends[nextClose + 1] ?? -1);
    } else {
      ends[i] = ends[i + 1] ?? -1;
    }
  }
  return ends;
}

/** `[label][ref]` → `label`, as `/\[([^\]]+)\]\[[^\]]*\]/g`. */
function referenceLinks(text: string): string {
  let out = '';
  let last = 0;
  for (let from = 0; ;) {
    const start = text.indexOf('[', from);
    const close = start === -1 ? -1 : text.indexOf(']', start + 1);
    if (close === -1) break;
    if (close === start + 1 || text[close + 1] !== '[') {
      from = close + 1;
      continue;
    }
    const end = text.indexOf(']', close + 2);
    if (end === -1) break;
    out += text.slice(last, start) + text.slice(start + 1, close);
    last = from = end + 1;
  }
  return out + text.slice(last);
}

const LINE_BREAK = /[\n\r\u2028\u2029]/g;
const DEFINITION_START = /[ \t]{0,3}\[/y;
const DESTINATION = /[ \t]*\S/y;

/** Drops link reference definitions (`[ref]: https://…`), as `/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm`. */
function removeDefinitions(text: string): string {
  let out = '';
  let last = 0;
  // The first `]` after the current label's `[`. Lines only move forward, so a label starting
  // before it shares it, and it is searched for again only once a label starts past it.
  let bracket = text.indexOf(']');
  for (let line = 0; line < text.length && bracket !== -1;) {
    DEFINITION_START.lastIndex = line;
    const opening = DEFINITION_START.exec(text);
    if (opening) {
      const start = line + opening[0].length - 1;
      if (start > bracket) bracket = text.indexOf(']', start + 1);
      DESTINATION.lastIndex = bracket + 2;
      if (bracket > start + 1 && text[bracket + 1] === ':' && DESTINATION.test(text)) {
        LINE_BREAK.lastIndex = bracket;
        const end = LINE_BREAK.exec(text)?.index ?? text.length;
        out += text.slice(last, line);
        last = end;
        line = end + 1;
        continue;
      }
    }
    LINE_BREAK.lastIndex = line;
    const next = LINE_BREAK.exec(text);
    if (!next) break;
    line = next.index + 1;
  }
  return out + text.slice(last);
}
