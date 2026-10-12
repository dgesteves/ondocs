/**
 * The few pieces of Markdown structure ondocs needs (fenced code blocks, ATX headings and
 * inline code spans), shared by the loader, the chunker and the answer renderer so they always
 * agree.
 *
 * Everything here runs in linear time. These functions see arbitrary files at build time and
 * model output in the browser, so no regex in this module can backtrack on hostile input.
 */

/** A run of three or more backticks or tildes, indented at most three spaces. */
interface Fence {
  char: '`' | '~';
  length: number;
}

function leadingFence(line: string): (Fence & { rest: string }) | null {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 32) i += 1;
  const char = line[i];
  if (char !== '`' && char !== '~') return null;
  let end = i;
  while (line[end] === char) end += 1;
  const length = end - i;
  if (length < 3) return null;
  return { char, length, rest: line.slice(end) };
}

export type FenceLine = 'prose' | 'open' | 'inside' | 'close';

/**
 * Classifies Markdown lines one at a time with respect to fenced code blocks, following
 * CommonMark: a backtick fence's info string cannot contain a backtick (so "```npm i x```" is
 * inline code, not a fence), and a closing fence uses the same character, at least as many
 * times, with nothing after it but spaces. An unclosed fence runs to the end of the input.
 */
export function createFenceScanner(): (line: string) => FenceLine {
  let open: Fence | null = null;
  return (line) => {
    const fence = leadingFence(line);
    if (open === null) {
      if (!fence || (fence.char === '`' && fence.rest.includes('`'))) return 'prose';
      open = { char: fence.char, length: fence.length };
      return 'open';
    }
    if (fence?.char === open.char && fence.length >= open.length && fence.rest.trim() === '') {
      open = null;
      return 'close';
    }
    return 'inside';
  };
}

/** True while a line opens, is inside, or closes a fenced code block. */
export function createFenceTracker(): (line: string) => boolean {
  const scan = createFenceScanner();
  return (line) => scan(line) !== 'prose';
}

export interface MarkdownSegment {
  /** True for a fenced code block, opening and closing fence lines included. */
  code: boolean;
  /** The segment's exact source. Joining every segment with "\n" restores the input. */
  text: string;
}

/** Splits Markdown into prose and fenced-code segments, losslessly. */
export function splitFenced(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const scan = createFenceScanner();
  let lines: string[] = [];
  let code = false;
  const flush = (): void => {
    if (lines.length > 0) segments.push({ code, text: lines.join('\n') });
    lines = [];
  };
  for (const line of markdown.split('\n')) {
    const state = scan(line);
    if (state === 'open') {
      flush();
      code = true;
      lines.push(line);
    } else if (state === 'close') {
      lines.push(line);
      flush();
      code = false;
    } else if (state === 'inside') {
      lines.push(line);
    } else {
      if (code) flush();
      code = false;
      lines.push(line);
    }
  }
  flush();
  return segments;
}

/** The body of a fenced code segment: the lines between its opening and closing fences. */
export function fenceBody(segment: string): string {
  const scan = createFenceScanner();
  return segment
    .split('\n')
    .filter((line) => scan(line) === 'inside')
    .join('\n');
}

/** Heading lines longer than this are treated as text: no real heading is this long. */
const MAX_HEADING_LENGTH = 1000;

/**
 * Parses an ATX heading line (`## Title`, `## Title ##`). Returns `null` for anything else,
 * including `#hashtag` (no space) and empty headings.
 *
 * A closing `#` sequence is only removed when whitespace precedes it, so `## C#` stays "C#".
 */
export function parseAtxHeading(line: string): { level: number; text: string } | null {
  if (line.length > MAX_HEADING_LENGTH) return null;
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 32) i += 1;
  let level = 0;
  while (line[i + level] === '#') level += 1;
  if (level === 0 || level > 6) return null;
  const after = line[i + level];
  if (after !== undefined && after !== ' ' && after !== '\t') return null;
  let text = line.slice(i + level).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t')) {
    text = text.slice(0, end).trimEnd();
  }
  return text ? { level, text } : null;
}

// Docusaurus's explicit heading id in MDX, where `{#id}` is not valid syntax, is an MDX comment
// at the end of the heading: `## Title {/* #custom-id */}`.
const MDX_COMMENT_ID = /^\{\/\*[ \t]*#([^\s{}*]+)[ \t]*\*\/\}[ \t]*$/;

// Splits `Title {/* #custom-id */}` into the title and the id, or returns `null` when the text
// does not end with such a comment. Linear: one anchored match on the text after the last `{/*`.
export function mdxCommentId(text: string): { text: string; id: string } | null {
  const open = text.lastIndexOf('{/*');
  if (open === -1) return null;
  const id = MDX_COMMENT_ID.exec(text.slice(open))?.[1];
  return id ? { text: text.slice(0, open).trimEnd(), id } : null;
}

/**
 * Finds inline code spans: a run of N backticks closed by the next run of exactly N backticks.
 * Linear time, using a per-length cursor over the backtick runs.
 */
export function findCodeSpans(text: string): [start: number, end: number][] {
  const runs: { start: number; length: number }[] = [];
  for (let i = 0; i < text.length;) {
    if (text.charCodeAt(i) !== 96) {
      i += 1;
      continue;
    }
    const start = i;
    while (text.charCodeAt(i) === 96) i += 1;
    runs.push({ start, length: i - start });
  }
  const byLength = new Map<number, number[]>();
  runs.forEach((run, index) => {
    const list = byLength.get(run.length);
    if (list) list.push(index);
    else byLength.set(run.length, [index]);
  });
  const cursor = new Map<number, number>();
  const spans: [number, number][] = [];
  for (let r = 0; r < runs.length;) {
    const run = runs[r];
    if (!run) break;
    const list = byLength.get(run.length) ?? [];
    let position = cursor.get(run.length) ?? 0;
    while (position < list.length && (list[position] ?? 0) <= r) position += 1;
    cursor.set(run.length, position);
    const closing = list[position];
    if (closing === undefined) {
      r += 1;
      continue;
    }
    const end = runs[closing];
    if (end) spans.push([run.start, end.start + end.length]);
    r = closing + 1;
  }
  return spans;
}

/** Applies `transform` to the text outside inline code spans, leaving the spans untouched. */
export function mapOutsideCodeSpans(text: string, transform: (prose: string) => string): string {
  let out = '';
  let last = 0;
  for (const [start, end] of findCodeSpans(text)) {
    out += transform(text.slice(last, start)) + text.slice(start, end);
    last = end;
  }
  return out + transform(text.slice(last));
}

/**
 * Removes every `open … close` span, shortest first and left to right, like
 * `text.replace(/open[\s\S]*?close/g, replacement)` but in linear time: when one `open` has no
 * `close` after it, neither has any later one, so the scan stops instead of retrying each.
 */
export function removeDelimited(
  text: string,
  open: string,
  close: string,
  replacement = '',
): string {
  let out = '';
  let last = 0;
  for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, last)) {
    const end = text.indexOf(close, start + open.length);
    if (end === -1) break;
    out += text.slice(last, start) + replacement;
    last = end + close.length;
  }
  return out + text.slice(last);
}

// A GFM footnote label: no whitespace or brackets. Labels match case-insensitively.
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\s[\]]+)\]:/;
const FOOTNOTE_REFERENCE = /\[\^([^\s[\]]+)\]/g;
const footnoteLabel = (label: string): string => label.toLowerCase().toUpperCase();

/**
 * Rewrites each footnote reference in a heading (`## Install [^1]`), outside code, as `~`, for
 * the renderers that leave references out of a heading's text and id: Docusaurus, Fumadocs and
 * Nextra slug `Install ` (`install-`). The chunker drops `~`, a strikethrough marker, from a
 * heading's text and slug; unlike removing the reference, it keeps the space before it, which an
 * ATX heading would trim. As in GFM, `[^label]` is a reference only when the page defines the
 * label (`[^label]: ...`); any other stays as text.
 */
export function dropHeadingFootnotes(source: string): string {
  if (!source.includes('[^')) return source;
  const lines = source.split('\n');
  const defined = new Set<string>();
  const scanDefinitions = createFenceScanner();
  for (const line of lines) {
    const label = scanDefinitions(line) === 'prose' ? FOOTNOTE_DEFINITION.exec(line)?.[1] : null;
    if (label) defined.add(footnoteLabel(label));
  }
  if (defined.size === 0) return source;
  const scanHeadings = createFenceScanner();
  return lines
    .map((line) =>
      scanHeadings(line) === 'prose' && parseAtxHeading(line)
        ? mapOutsideCodeSpans(line, (prose) =>
            prose.replace(FOOTNOTE_REFERENCE, (reference, label: string) =>
              defined.has(footnoteLabel(label)) ? '~' : reference,
            ),
          )
        : line,
    )
    .join('\n');
}
