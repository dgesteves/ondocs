// What an endpoint says about an index file it cannot use: one that is not JSON, from another
// format, or with a field of the wrong shape. Each error names the field, so a hand-edited or
// truncated ask-index.json points at its own mistake. The answer cache's own guards are here too:
// a stored answer that is not one, and a size that is not a size. Coverage showed none of these
// paths run anywhere else.
import { describe, expect, it } from 'vitest';

import { AskIndexError, INDEX_FORMAT, parseIndexFile, validateIndexFile } from '../src';
import { memoryAnswerCache } from '../src/server';
import { parseCachedAnswer } from '../src/server/cache';

/** A well-formed index with one page and one chunk, with `change` applied. */
function index(change: (value: Record<string, unknown>) => void = () => undefined, vector = false) {
  const value: Record<string, unknown> = {
    format: INDEX_FORMAT,
    contentHash: 'abc',
    chunking: { maxChars: 1200, overlap: 0 },
    embedding: vector ? { model: 'mock', dimensions: 4 } : null,
    documents: [{ id: 'a.md', url: '/a', title: 'A' }],
    chunks: [
      {
        id: 'a.md#0',
        doc: 0,
        heading: '',
        text: 'Some text.',
        hash: '0123456789abcdef',
        ...(vector ? { vector: 'AAAAAA==' } : {}),
      },
    ],
  };
  change(value);
  return value;
}

const chunk = (value: Record<string, unknown>) => (value.chunks as Record<string, unknown>[])[0]!;

describe('an index file the endpoint cannot use', () => {
  it('reads a well-formed one, keyword-only or embedded', () => {
    expect(validateIndexFile(index()).documents).toHaveLength(1);
    expect(validateIndexFile(index(undefined, true)).embedding?.dimensions).toBe(4);
  });

  it('says when it is not JSON', () => {
    expect(() => parseIndexFile('{"format": ')).toThrow(AskIndexError);
    expect(() => parseIndexFile('{"format": ')).toThrow(/^Index is not valid JSON: /);
  });

  it('asks for a rebuild when it is from another format', () => {
    expect(() => validateIndexFile(index((value) => (value.format = 'other@2')))).toThrow(
      'Unsupported index format "other@2"; expected "ask-my-site/index@1". Rebuild it with this version of ondocs.',
    );
  });

  it.each<[string, (value: Record<string, unknown>) => void, string, boolean?]>([
    ['not an object', () => undefined, '`index` must be an object'],
    ['contentHash', (value) => (value.contentHash = 1), '`contentHash` must be a string'],
    [
      'chunking',
      (value) => (value.chunking = { maxChars: '1200', overlap: 0 }),
      '`chunking` must be an object with numeric maxChars and overlap',
    ],
    [
      'embedding',
      (value) => (value.embedding = { dimensions: 4 }),
      '`embedding` must be null or { model, dimensions }',
    ],
    [
      'embedding.dimensions',
      (value) => (value.embedding = { model: 'mock', dimensions: 0 }),
      '`embedding.dimensions` must be a positive integer',
      true,
    ],
    [
      'embedding.settings',
      (value) => (value.embedding = { model: 'mock', dimensions: 4, settings: 1 }),
      '`embedding.settings` must be a string',
      true,
    ],
    ['documents', (value) => (value.documents = {}), '`documents` must be an array'],
    [
      'a document',
      (value) => (value.documents = [{ id: 'a.md' }]),
      '`documents[0]` must be an object with string id, url and title',
    ],
    [
      'a document’s title',
      (value) => (value.documents = [{ id: 'a.md', url: '/a' }]),
      '`documents[0].title` must be a string',
    ],
    ['chunks', (value) => (value.chunks = 'none'), '`chunks` must be an array'],
    ['a chunk', (value) => (value.chunks = [null]), '`chunks[0]` must be an object'],
    [
      'a chunk’s text',
      (value) => delete chunk(value).text,
      '`chunks[0]` must be an object with string id and text',
    ],
    [
      'a chunk’s document',
      (value) => (chunk(value).doc = 1),
      '`chunks[0].doc` must be the index of an entry in documents',
    ],
    [
      'a chunk’s heading',
      (value) => delete chunk(value).heading,
      '`chunks[0].heading` must be a string',
    ],
    ['a chunk’s hash', (value) => delete chunk(value).hash, '`chunks[0].hash` must be a string'],
    [
      'a chunk’s anchor',
      (value) => (chunk(value).anchor = 1),
      '`chunks[0].anchor` must be a string when present',
    ],
    [
      'a chunk’s vector',
      (value) => delete chunk(value).vector,
      '`chunks[0].vector` must be a base64 string, because the index declares an embedding model',
      true,
    ],
  ])('names the field that is wrong: %s', (name, change, message, vector) => {
    const value = name === 'not an object' ? [] : index(change, vector);
    expect(() => validateIndexFile(value)).toThrow(AskIndexError);
    expect(() => validateIndexFile(value)).toThrow(`Invalid ondocs index: ${message}.`);
  });
});

describe('the answer cache', () => {
  it('reads a stored value that is not an answer as no answer', () => {
    expect(parseCachedAnswer('{"text": ')).toBeNull();
    expect(parseCachedAnswer('{"text": "Hi"}')).toBeNull();
    expect(parseCachedAnswer(null)).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects %s answers as its size', (maxEntries) => {
    expect(() => memoryAnswerCache({ maxEntries })).toThrow(
      `memoryAnswerCache: maxEntries must be a positive integer (got ${String(maxEntries)}).`,
    );
  });
});
