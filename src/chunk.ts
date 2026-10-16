import {
  createFenceScanner,
  createFenceTracker,
  mdxCommentId,
  parseAtxHeading,
} from './text/markdown';
import { createSlugger, plainHeading } from './text/slug';
import type { Chunk, ChunkingOptions, SourceDocument } from './types';

export const DEFAULT_CHUNKING = { maxChars: 1200, overlap: 150 } as const;

/**
 * Bumped whenever chunk boundaries change for most inputs, which invalidates every index. A change
 * that only moves the chunks of some inputs needs no bump: the content hash covers each chunk's
 * text, so it already changes for those indexes and no others.
 */
export const CHUNKER_VERSION = 2;

// A sentence ends after `.`, `!`, `?`, `:` or `;` and a space, or after `。`, `！`, `？`, `；` or `：`
// and the closing quotes or brackets after it, with or without a space, since Chinese and Japanese
// put none there. A run of those marks (`！？`) ends one sentence, after its last mark.
const SENTENCE_END =
  /(?<=[.!?:;])\s+|(?<=[。！？；：][」』）】”’]{0,3})(?![。！？；：」』）】”’])\s*/;
const CJK_SENTENCE_END = /[。！？；：][」』）】”’]{0,3}$/;
// Ids from `{#id}` and HTML `id` attributes: anything without whitespace or braces.
const EXPLICIT_ID = /^[^\s{}]+$/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/m;

// Splits `Title {#custom-id}`, or `Title {/* #custom-id */}` as Docusaurus writes it in MDX,
// into the title and the id, if the id is present and valid.
function explicitAnchor(text: string): { text: string; id?: string } {
  if (!text.endsWith('}')) return { text };
  const comment = mdxCommentId(text);
  if (comment && EXPLICIT_ID.test(comment.id)) return comment;
  const open = text.lastIndexOf('{#');
  const id = open === -1 ? '' : text.slice(open + 2, -1);
  return EXPLICIT_ID.test(id) ? { text: text.slice(0, open).trimEnd(), id } : { text };
}

interface Section {
  path: string[];
  anchor?: string;
  lines: string[];
}

interface Block {
  text: string;
  code: boolean;
}

export function resolveChunking(options: ChunkingOptions = {}): Required<ChunkingOptions> {
  const maxChars = options.maxChars ?? DEFAULT_CHUNKING.maxChars;
  const overlap = options.overlap ?? DEFAULT_CHUNKING.overlap;
  if (!Number.isInteger(maxChars) || maxChars < 200) {
    throw new RangeError(`chunking.maxChars must be an integer >= 200 (got ${String(maxChars)}).`);
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap > maxChars / 2) {
    throw new RangeError(
      `chunking.overlap must be an integer between 0 and maxChars / 2 (got ${String(overlap)}).`,
    );
  }
  return { maxChars, overlap };
}

/**
 * Splits a document into chunks along its heading structure.
 *
 * - A chunk never crosses a heading, so every chunk has one heading path and one anchor.
 * - Within a section, paragraphs are packed greedily up to `maxChars`. Paragraphs that are too
 *   long on their own are split by sentence, then by word. Fenced code blocks are split by line,
 *   never mid-line.
 * - Consecutive chunks of the same section share up to `overlap` characters of context, cut at a
 *   sentence or word boundary.
 * - Headings inside fenced code blocks are content, not structure.
 */
export function chunkDocument(document: SourceDocument, options?: ChunkingOptions): Chunk[] {
  const { maxChars, overlap } = resolveChunking(options);
  const chunks: Chunk[] = [];
  for (const section of splitSections(document)) {
    const heading = section.path.join(' › ');
    for (const text of packSection(section.lines, maxChars, overlap)) {
      chunks.push({
        id: `${document.id}#${chunks.length}`,
        documentId: document.id,
        url: document.url,
        title: document.title,
        heading,
        ...(section.anchor ? { anchor: section.anchor } : {}),
        text,
      });
    }
  }
  return chunks;
}

/** The text a chunk is embedded and keyword-indexed as: where it sits, then what it says. */
export function chunkSearchText(chunk: Pick<Chunk, 'title' | 'heading' | 'text'>): string {
  const location = chunk.heading ? `${chunk.title} › ${chunk.heading}` : chunk.title;
  return `${location}\n\n${chunk.text}`;
}

function splitSections(document: SourceDocument): Section[] {
  const slug = createSlugger();
  const title = document.title.trim().toLowerCase();
  const stack: { level: number; text: string; anchor: string | undefined }[] = [];
  const sections: Section[] = [{ path: [], lines: [] }];
  const inFence = createFenceTracker();

  for (const line of document.content.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = inFence(line) ? null : parseAtxHeading(line);
    if (!heading) {
      sections.at(-1)?.lines.push(line);
      continue;
    }

    const { level } = heading;
    const explicit = explicitAnchor(heading.text);
    const text = plainHeading(explicit.text);
    if (!text) {
      sections.at(-1)?.lines.push(line);
      continue;
    }
    // Slugged from the heading as written: GitHub keeps every space (`a  b` → `a--b`). A page
    // whose ids are all explicit (built HTML) has no slug the chunk could link to.
    const anchor =
      explicit.id ?? (document.anchors === 'explicit' ? undefined : slug(explicit.text));
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
    // A level-one heading that repeats the page title adds nothing to a citation.
    if (!(level === 1 && text.toLowerCase() === title)) stack.push({ level, text, anchor });
    // The innermost heading's anchor, or the nearest one above it that has one.
    const sectionAnchor = stack.findLast((entry) => entry.anchor !== undefined)?.anchor;
    sections.push({
      path: stack.map((entry) => entry.text),
      ...(sectionAnchor === undefined ? {} : { anchor: sectionAnchor }),
      lines: [],
    });
  }
  return sections;
}

function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const inFence = createFenceTracker();
  let current: string[] = [];
  let code = false;

  const flush = (): void => {
    const text = code ? current.join('\n') : current.join('\n').trim();
    if (text.trim()) blocks.push({ text, code });
    current = [];
  };

  for (const line of lines) {
    const fenced = inFence(line);
    if (fenced !== code) {
      // Entering a fence: close the paragraph. Leaving one: the closing line already belongs to
      // the code block, so close that instead.
      if (fenced) {
        flush();
        code = true;
        current.push(line);
      } else {
        flush();
        code = false;
        if (line.trim()) current.push(line);
      }
      continue;
    }
    if (!code && line.trim() === '') flush();
    else current.push(line);
  }
  // An unterminated fence is still code.
  flush();
  return blocks;
}

function packSection(lines: string[], maxChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const block of toBlocks(lines)) {
    const pieces = block.text.length > maxChars ? splitBlock(block, maxChars) : [block.text];
    for (const piece of pieces) {
      if (current && current.length + 2 + piece.length <= maxChars) {
        current = `${current}\n\n${piece}`;
        continue;
      }
      const previous = current || chunks.at(-1) || '';
      flush();
      let tail = overlapTail(previous, Math.min(overlap, maxChars - piece.length - 2));
      // Never carry a fence line into the next chunk: it would flip code and prose there.
      if (FENCE_LINE.test(tail)) tail = '';
      current = tail ? `${tail}\n\n${piece}` : piece;
    }
  }
  flush();
  return chunks;
}

/** Splits an oversized block by line (lists, tables, code), then by sentence, then by word. */
function splitBlock(block: Block, maxChars: number): string[] {
  if (block.code) return splitCode(block.text, maxChars);
  const units = block.text.split('\n').flatMap((line) => {
    if (line.length <= maxChars) return [line];
    return pack(
      line.split(SENTENCE_END).flatMap((s) => splitWords(s, maxChars)),
      // After a CJK sentence end (4 characters at most), the next sentence follows with no space,
      // as it did in the text.
      (piece) => (CJK_SENTENCE_END.test(piece.slice(-4)) ? '' : ' '),
      maxChars,
    );
  });
  return pack(units, '\n', maxChars).filter((piece) => piece.trim());
}

/**
 * Splits a fenced code block by line and re-fences every piece with the original opening line,
 * so each chunk holds well-formed code that cannot flip the code and prose that follow it.
 */
function splitCode(text: string, maxChars: number): string[] {
  const lines = text.split('\n');
  const opener = lines[0] ?? '```';
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(opener)?.[1] ?? '```';
  const scan = createFenceScanner();
  const body = lines.filter((line) => scan(line) === 'inside');
  const budget = Math.max(40, maxChars - opener.length - fence.length - 2);
  const units = body.flatMap((line) => (line.length > budget ? splitWords(line, budget) : [line]));
  return pack(units, '\n', budget).map((piece) => `${opener}\n${piece}\n${fence}`);
}

/**
 * Greedily joins units with `separator` into pieces no longer than `maxChars`. A function as
 * `separator` is given the piece so far and returns what to put after it.
 */
function pack(
  units: string[],
  separator: string | ((before: string) => string),
  maxChars: number,
): string[] {
  const pieces: string[] = [];
  let current: string | null = null;
  for (const unit of units) {
    if (current === null) {
      current = unit;
      continue;
    }
    const glue: string = typeof separator === 'string' ? separator : separator(current);
    if (current.length + glue.length + unit.length > maxChars) {
      pieces.push(current);
      current = unit;
    } else {
      current = `${current}${glue}${unit}`;
    }
  }
  if (current !== null) pieces.push(current);
  return pieces;
}

function splitWords(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    // A single "word" longer than a chunk (a minified line, a data URI, CJK text with no
    // punctuation) is cut hard, though never between the two halves of a surrogate pair.
    let start = 0;
    while (start < word.length) {
      let end = Math.min(start + maxChars, word.length);
      if (
        end - 1 > start &&
        isHighSurrogate(word.charCodeAt(end - 1)) &&
        isLowSurrogate(word.charCodeAt(end))
      ) {
        end -= 1;
      }
      const part = word.slice(start, end);
      start = end;
      if (current && current.length + 1 + part.length > maxChars) {
        pieces.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** The last `size` characters of `text`, starting at a sentence boundary if one fits. */
function overlapTail(text: string, size: number): string {
  if (size <= 0 || !text) return '';
  if (text.length <= size) return text;
  const window = text.slice(-size);
  const sentence = /[.!?]\s+(?=\S)|[。！？][」』）】”’]{0,3}\s*(?=\S)/.exec(window);
  if (sentence) return window.slice(sentence.index + sentence[0].length);
  const space = window.search(/\s/);
  return space === -1 ? '' : window.slice(space + 1);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
