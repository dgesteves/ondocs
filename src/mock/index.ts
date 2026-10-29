/**
 * ondocs/mock: deterministic stand-ins for the embedding and language models, so the whole
 * pipeline (index, retrieval, streaming, citations) runs without an API key.
 *
 * - `mockEmbeddingModel` hashes words and word pairs into a fixed-size vector (feature hashing).
 *   Similarity tracks shared vocabulary, so retrieval is lexical but real.
 * - `mockLanguageModel` answers extractively: it quotes the sentences from the retrieved sources
 *   that best match the question, with the code or list a sentence introduces, and cites them.
 *   It never invents text.
 *
 * Both are built on the AI SDK's own test models from `ai/test`.
 */

import { simulateReadableStream } from 'ai';
import * as aiTest from 'ai/test';
import {
  MockEmbeddingModelV3,
  MockLanguageModelV3,
  type MockEmbeddingModelV4,
  type MockLanguageModelV4,
} from 'ai/test';

import { createFenceScanner, parseAtxHeading, splitFenced } from '../text/markdown';
import { tokenize } from '../text/tokenize';

/**
 * A `minSimilarity` that suits {@link mockEmbeddingModel} at its default size. Chance similarity
 * between hashed vectors has a standard deviation of about 1/sqrt(dimensions), 0.044 at 512, so
 * 0.2 sits well clear of noise. Most relevant matches pass on keyword coverage instead. A short
 * question can still collide with a short chunk ("France" and "npm" share a bucket at 512), and
 * one common word, such as "git" or "file", makes a short section similar enough, so retrieval
 * over a mock index only counts similarity from chunks that share two of the question's words
 * (`similarityNeedsKeyword`).
 */
export const MOCK_MIN_SIMILARITY = 0.2;

/**
 * What `ai/test` exports as `name`, looked up rather than imported, so that ondocs loads with AI
 * SDK 6 as well as 7: AI SDK 6 has none of the v4 test models. Where it has none, its v3 ones
 * stand in, which AI SDK 7 takes too, and what the models below return is the same for both.
 */
const fromAiTest = (name: string): unknown => Reflect.get(aiTest, name);
const MockEmbeddingModel = (fromAiTest('MockEmbeddingModelV4') ??
  MockEmbeddingModelV3) as typeof MockEmbeddingModelV4;
const MockLanguageModel = (fromAiTest('MockLanguageModelV4') ??
  MockLanguageModelV3) as typeof MockLanguageModelV4;

export interface MockEmbeddingModelOptions {
  /** Vector size. Default 512. */
  dimensions?: number;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The mock embedding of one text: signed feature hashing of terms and term pairs, L2-normalized. */
export function hashEmbedding(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const terms = tokenize(text);
  const features: [string, number][] = terms.map((term) => [term, 1]);
  for (let i = 1; i < terms.length; i += 1)
    features.push([`${terms[i - 1] ?? ''} ${terms[i] ?? ''}`, 0.5]);
  for (const [feature, weight] of features) {
    const hash = fnv1a(feature);
    const bucket = hash % dimensions;
    vector[bucket] = (vector[bucket] ?? 0) + (hash & 0x80000000 ? -weight : weight);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

/** A deterministic, offline embedding model. Its id is `mock-hash-<dimensions>`. */
export function mockEmbeddingModel(options: MockEmbeddingModelOptions = {}): MockEmbeddingModelV4 {
  const dimensions = options.dimensions ?? 512;
  return new MockEmbeddingModel({
    provider: 'ondocs',
    modelId: `mock-hash-${String(dimensions)}`,
    maxEmbeddingsPerCall: 2048,
    supportsParallelCalls: true,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((value) => hashEmbedding(value, dimensions)),
        usage: { tokens: values.reduce((sum, value) => sum + tokenize(value).length, 0) },
        warnings: [],
      }),
  });
}

export interface MockLanguageModelOptions {
  /** Delay before the first token, in ms. Default 250. */
  initialDelayMs?: number;
  /** Delay between streamed words, in ms. Default 18. */
  wordDelayMs?: number;
}

// `formatPrompt` tags end in a per-prompt suffix; a back-reference matches the closing tag.
const SOURCE = /<source-([\da-f]+) id="(\d+)"([^\n]*)>\n([\s\S]*?)\n<\/source-\1>/g;
const QUESTION = /<question-([\da-f]+)>\n([\s\S]*?)\n<\/question-\1>/;
const TITLE = /\btitle="([^"]*)"/;

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** Longest code block quoted after the sentence that introduces it, in lines. */
const MAX_CODE_LINES = 30;
/** Most list items quoted after the sentence that introduces them. */
const MAX_LIST_ITEMS = 6;
/** "How do I…", "How can I…", "How to…": an answer that shows the code is better. */
const HOW_TO = /^\s*how\s+(?:do|does|can|could|should|would|to)\b/i;
/** "What is X?": a sentence that starts "X is" defines it. */
const DEFINITION = /^\s*what(?:'s|\s+is|\s+are)\s+(?:an?\s+|the\s+)?(.+?)\s*\??\s*$/i;

interface Source {
  id: number;
  /** Position in the prompt, which is the retrieval rank. */
  rank: number;
  /** Terms of the source's title and heading path. */
  label: Set<string>;
  /** Terms of the label and the text. */
  terms: Set<string>;
}

/** A code block or list that the sentence before it introduces, quoted with it. */
interface Attachment {
  text: string;
  code: boolean;
  /** Terms of a list's items; a code block's are not counted. */
  terms: Set<string>;
  /** The list items it quotes, so they are not quoted again on their own. */
  blocks: string[];
}

interface Unit {
  text: string;
  source: Source;
  terms: Set<string>;
  /** `rank:block`, the source block the unit comes from. */
  block: string;
  /** `rank:list` for a list item, shared by the items of one list. */
  list?: string;
  /** Reading order: by source, then by position in the source. */
  order: number;
  attachment?: Attachment;
  /** The share of the question's weight the unit itself (and a quoted list) contains. */
  own: number;
  score: number;
}

type Block =
  | { kind: 'prose'; text: string }
  | { kind: 'item'; text: string; marker: string; list: number }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'other' };

/**
 * The answer the mock model gives for a prompt produced by `formatPrompt`: sentences quoted from
 * the sources, each cited, and never any text of its own.
 *
 * Every sentence and list item of every source is scored by the question words it shares, the
 * rarer ones counting more, and by how well its source's title and heading match the question,
 * so a section headed "Deploy to Netlify" answers "How do I deploy to Netlify?" before a passing
 * mention does. The best sentence leads, with up to two more that are nearly as good. A sentence
 * that ends with a colon brings the code block or list it introduces.
 */
export function extractiveAnswer(prompt: string): string {
  const questionText = QUESTION.exec(prompt)?.[2] ?? '';
  const question = [...new Set(tokenize(questionText))];
  const parsed = [...prompt.matchAll(SOURCE)].map((match, rank) => {
    const label = decodeAttribute(TITLE.exec(match[3] ?? '')?.[1] ?? '');
    const text = match[4] ?? '';
    const labelTerms = new Set(tokenize(label));
    const source: Source = {
      id: Number(match[2]),
      rank,
      label: labelTerms,
      terms: new Set([...labelTerms, ...tokenize(text)]),
    };
    return { source, text };
  });
  if (parsed.length === 0) return "I don't know. No sources were provided.";

  const units = parsed.flatMap(({ source, text }) => unitsOf(source, text));
  const first = units[0];
  if (!first) return `See source [${String(parsed[0]?.source.id ?? 1)}].`;

  // A question word found in every source says little about which one answers; a rare one says
  // a lot. Words found in none carry no weight.
  const sourceCount = parsed.length;
  const weight = new Map<string, number>();
  for (const term of question) {
    const found = parsed.filter(({ source }) => source.terms.has(term)).length;
    weight.set(term, found === 0 ? 0 : Math.log(1 + sourceCount / found) + 0.1);
  }
  const total = question.reduce((sum, term) => sum + (weight.get(term) ?? 0), 0);
  if (total === 0) return cite(first, true);
  const share = (has: (term: string) => boolean): number =>
    question.reduce((sum, term) => sum + (has(term) ? (weight.get(term) ?? 0) : 0), 0) / total;

  const howTo = HOW_TO.test(questionText);
  const subject = DEFINITION.exec(questionText)?.[1]?.toLowerCase().replace(/`/g, '');
  for (const unit of units) {
    unit.own = share((term) => unit.terms.has(term) || (unit.attachment?.terms.has(term) ?? false));
    unit.score =
      0.45 * unit.own +
      0.25 * share((term) => unit.source.label.has(term)) +
      0.3 * share((term) => unit.source.terms.has(term)) +
      0.06 * (1 - unit.source.rank / sourceCount);
    // Code answers "how do I…" best, when the sentence that introduces it is about the question.
    if (howTo && unit.attachment?.code && unit.own >= 0.5) unit.score += 0.12;
    else if (unit.attachment) unit.score += 0.03;
    if (subject && definesSubject(unit.text, subject)) unit.score += 0.3;
  }

  const ranked = [...units].sort((a, b) => b.score - a.score || a.order - b.order);
  const best = ranked[0] ?? first;
  const chosen = [best];
  const quoted = new Set(best.attachment?.blocks);
  const limit = best.attachment ? 2 : 3;
  for (const unit of ranked.slice(1)) {
    if (chosen.length >= limit) break;
    const sameSource = unit.source === best.source;
    // Code or a list leads the answer: anything more stays in its section.
    if (best.attachment && !sameSource) continue;
    if (unit.score < best.score * (sameSource ? 0.7 : 0.85)) continue;
    if (unit.own < best.own * (sameSource ? 0.5 : 0.6)) continue;
    // Another item of the best one's list is an alternative to it, not more of the answer.
    if (unit.list && unit.list === best.list && unit.own < best.own) continue;
    if (unit.attachment && chosen.some((c) => c.attachment)) continue;
    if (quoted.has(unit.block) || unit.text.length < 40) continue;
    if (chosen.some((c) => repeats(c, unit))) continue;
    chosen.push(unit);
    for (const block of unit.attachment?.blocks ?? []) quoted.add(block);
  }
  // The best source first, then the others by rank, each in reading order. A best unit that
  // quotes code or a list leads: the rest only adds to it.
  const position = (unit: Unit): number =>
    unit === best && best.attachment ? -2 : unit.source === best.source ? -1 : unit.source.rank;
  chosen.sort((a, b) => position(a) - position(b) || a.order - b.order);

  // Consecutive sentences from one source share a citation, which comes before any attachment.
  return chosen
    .map((unit, i) => cite(unit, chosen[i + 1]?.source !== unit.source))
    .join(' ')
    .replace(/\n\n /g, '\n\n')
    .trim();
}

/** The unit's text with its citation, then whatever it introduces. */
function cite(unit: Pick<Unit, 'text' | 'source' | 'attachment'>, withCitation: boolean): string {
  const citation = withCitation || unit.attachment ? ` [${String(unit.source.id)}]` : '';
  if (unit.attachment) return `${unit.text}${citation}\n\n${unit.attachment.text}\n\n`;
  return `${unit.text.replace(/[:;,]$/, '.')}${citation}`;
}

/** Whether `text` starts by defining `subject`: "ondocs is …". */
function definesSubject(text: string, subject: string): boolean {
  const start = text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/^(?:the|an?)\s+/, '');
  return start.startsWith(`${subject} is `) || start.startsWith(`${subject} are `);
}

/** Two units that share most of their words say the same thing. */
function repeats(a: Pick<Unit, 'terms'>, b: Pick<Unit, 'terms'>): boolean {
  let shared = 0;
  for (const term of a.terms) if (b.terms.has(term)) shared += 1;
  return shared / Math.max(1, Math.min(a.terms.size, b.terms.size)) > 0.6;
}

function decodeAttribute(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** A source's paragraphs, list items and code blocks. Headings and table rows are dropped. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  for (const segment of splitFenced(text)) {
    if (segment.code) {
      blocks.push({ kind: 'code', text: closeFence(segment.text) });
      continue;
    }
    let paragraph: string[] = [];
    const flush = (): void => {
      if (paragraph.length > 0) blocks.push({ kind: 'prose', text: paragraph.join(' ') });
      paragraph = [];
    };
    for (const line of segment.text.split('\n')) {
      const trimmed = line.trim();
      const last = blocks.at(-1);
      if (!trimmed) {
        flush();
      } else if (TABLE_ROW.test(line)) {
        flush();
        const cells = trimmed
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => cell.trim());
        // The row under the header (`| --- | :-: |`) only sets alignment.
        if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
        if (last?.kind === 'table') last.rows.push(cells);
        else blocks.push({ kind: 'table', rows: [cells] });
      } else if (parseAtxHeading(line)) {
        flush();
        blocks.push({ kind: 'other' });
      } else if (LIST_ITEM.test(line)) {
        flush();
        const marker = LIST_ITEM.exec(line)?.[0].trim() ?? '-';
        const list = last?.kind === 'item' ? last.list : blocks.length;
        blocks.push({ kind: 'item', text: trimmed.replace(LIST_ITEM, ''), marker, list });
      } else if (last?.kind === 'item' && paragraph.length === 0 && /^\s/.test(line)) {
        // An indented line continues the list item above it.
        last.text = `${last.text} ${trimmed}`;
      } else {
        paragraph.push(trimmed);
      }
    }
    flush();
  }
  return blocks;
}

/** A chunk can end inside a code block; quote it closed. */
function closeFence(code: string): string {
  const scan = createFenceScanner();
  const lines = code.split('\n');
  if (lines.map((line) => scan(line)).at(-1) === 'close') return code;
  return `${code}\n${FENCE.exec(lines[0] ?? '')?.[1] ?? '```'}`;
}

/**
 * Sentences and list items of one source. A paragraph or item whose last sentence ends with a
 * colon right before a code block or a list brings it along; a short paragraph like that is one
 * unit, so the sentences that name the task stay with the code that does it.
 */
function unitsOf(source: Source, text: string): Unit[] {
  const blocks = blocksOf(text);
  const units: Unit[] = [];
  let position = 0;
  const add = (unitText: string, b: number, attachment?: Attachment): void => {
    // "See Deploying." is what is left of a link: it says nothing on its own.
    if (/^See\b/.test(unitText)) return;
    const block = blocks[b];
    units.push({
      text: unitText,
      source,
      terms: new Set(tokenize(unitText)),
      block: `${String(source.rank)}:${String(b)}`,
      ...(block?.kind === 'item' ? { list: `${String(source.rank)}:${String(block.list)}` } : {}),
      order: source.rank * 1000 + position++,
      ...(attachment ? { attachment } : {}),
      own: 0,
      score: 0,
    });
  };
  blocks.forEach((block, b) => {
    if (block.kind !== 'prose' && block.kind !== 'item') return;
    const sentences = sentencesOf(block.text);
    const attachment = (sentences.at(-1) ?? '').endsWith(':')
      ? attachmentAfter(blocks, b, source.rank, block.kind === 'prose')
      : undefined;
    if (attachment && sentences.length <= 3) {
      add(sentences.join(' '), b, attachment);
      return;
    }
    sentences.forEach((sentence, i) => {
      add(sentence, b, i === sentences.length - 1 ? attachment : undefined);
    });
  });
  return units;
}

function attachmentAfter(
  blocks: readonly Block[],
  index: number,
  rank: number,
  lists: boolean,
): Attachment | undefined {
  const next = blocks[index + 1];
  if (next?.kind === 'code') {
    if (next.text.split('\n').length > MAX_CODE_LINES + 2) return undefined;
    return { text: next.text, code: true, terms: new Set(), blocks: [] };
  }
  if (!lists) return undefined;
  if (next?.kind === 'table') {
    // A table is quoted as a list, one row per item: "- first: second; Header: third".
    const [header = [], ...rows] = next.rows;
    const text = rows
      .slice(0, MAX_LIST_ITEMS)
      .map((cells) => {
        const [name = '', value = '', ...rest] = cells;
        const more = rest.flatMap((cell, i) =>
          cell ? [`${header[i + 2] ? `${header[i + 2] ?? ''}: ` : ''}${cell}`] : [],
        );
        return `- ${[value ? `${name}: ${value}` : name, ...more].join('; ')}`;
      })
      .join('\n');
    return text ? { text, code: false, terms: new Set(tokenize(text)), blocks: [] } : undefined;
  }
  if (next?.kind !== 'item') return undefined;
  const items: string[] = [];
  const quoted: string[] = [];
  for (let j = index + 1; items.length < MAX_LIST_ITEMS; j += 1) {
    const item = blocks[j];
    if (item?.kind !== 'item') break;
    items.push(`${/^\d/.test(item.marker) ? item.marker : '-'} ${item.text}`);
    quoted.push(`${String(rank)}:${String(j)}`);
  }
  const text = items.join('\n');
  return { text, code: false, terms: new Set(tokenize(text)), blocks: quoted };
}

/**
 * The sentences of a paragraph, never split inside double quotes or inline code, so
 * `answers "I don't know. I couldn't find…"` stays one sentence.
 */
function sentencesOf(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  const sentences: string[] = [];
  let start = 0;
  let quoted = false;
  let code = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '`') code = !code;
    else if (char === '"' && !code) quoted = !quoted;
    else if (
      !quoted &&
      !code &&
      (char === '.' || char === '!' || char === '?') &&
      text[i + 1] === ' ' &&
      /[A-Z0-9`"(*[]/.test(text[i + 2] ?? '')
    ) {
      sentences.push(text.slice(start, i + 1));
      start = i + 2;
    }
  }
  sentences.push(text.slice(start));
  return sentences.map((sentence) => clip(sentence.trim(), 320)).filter((s) => s.length >= 20);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function promptText(prompt: MockLanguageModelV4['doStreamCalls'][number]['prompt']): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (message?.role === 'user') {
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
    }
  }
  return '';
}

const usage = (text: string) => ({
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: text.split(/\s+/).length, text: undefined, reasoning: undefined },
});

/**
 * The mock's rewrite of a follow-up, for the handler's `followUps` prompt: the conversation's last
 * question and the follow-up, joined, which a real model would turn into one sentence. `null` for
 * any other prompt.
 */
export function mockStandaloneQuestion(prompt: string): string | null {
  const question = /<question-([\da-f]+)>\n([\s\S]*?)\n<\/question-\1>/.exec(prompt);
  if (!question?.[1] || !prompt.includes(`<conversation-${question[1]}>`)) return null;
  const nonce = question[1];
  const users = [
    ...prompt.matchAll(new RegExp(`<user-${nonce}>\\n([\\s\\S]*?)\\n</user-${nonce}>`, 'g')),
  ];
  const previous = users.at(-1)?.[1]?.trim();
  const followUp = (question[2] ?? '').trim();
  return previous ? `${previous} ${followUp}` : followUp;
}

/**
 * A scripted language model that streams an extractive, cited answer built from the sources in
 * its prompt. Use it for demos, tests and local development without an API key. Asked to rewrite
 * a follow-up, it joins the follow-up to the question before it (see `mockStandaloneQuestion`).
 */
export function mockLanguageModel(options: MockLanguageModelOptions = {}): MockLanguageModelV4 {
  return new MockLanguageModel({
    provider: 'ondocs',
    modelId: 'mock-extractive',
    doGenerate: ({ prompt }) => {
      const asked = promptText(prompt);
      const text = mockStandaloneQuestion(asked) ?? extractiveAnswer(asked);
      return Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(text),
        warnings: [],
      });
    },
    doStream: ({ prompt }) => {
      const text = extractiveAnswer(promptText(prompt));
      const words = text.match(/\S+\s*/g) ?? [];
      return Promise.resolve({
        stream: simulateReadableStream({
          initialDelayInMs: options.initialDelayMs ?? 250,
          chunkDelayInMs: options.wordDelayMs ?? 18,
          chunks: [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'text-start' as const, id: 'answer' },
            ...words.map((delta) => ({ type: 'text-delta' as const, id: 'answer', delta })),
            { type: 'text-end' as const, id: 'answer' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: usage(text),
            },
          ],
        }),
      });
    },
  });
}
