import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockEmbeddingModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AskIndexError,
  INDEX_FORMAT,
  buildIndex,
  checkIndex,
  fromMarkdown,
  loadIndex,
  parseIndexFile,
  sameEmbeddingModel,
  serializeIndexFile,
  validateIndexFile,
} from '../src';
import { LARGE_INDEX_BYTES, largeIndexWarning, writeSiteIndex } from '../src/integration/build';
import { hashEmbedding } from '../src/mock';
import { corpus } from './helpers';

/** An embedding model that records how many texts it was asked to embed. */
function countingModel(modelId = 'counting', dims = 64) {
  const calls: string[][] = [];
  const model = new MockEmbeddingModelV4({
    modelId,
    maxEmbeddingsPerCall: 100,
    doEmbed: ({ values }) => {
      calls.push(values);
      return Promise.resolve({
        embeddings: values.map((v) => hashEmbedding(v, dims)),
        warnings: [],
      });
    },
  });
  return { model, calls, embedded: () => calls.flat().length };
}

describe('buildIndex', () => {
  it('produces a valid, deterministic index', async () => {
    const { model } = countingModel();
    const a = await buildIndex({ documents: corpus, embeddingModel: model });
    const b = await buildIndex({ documents: [...corpus].reverse(), embeddingModel: model });

    expect(a.index.format).toBe(INDEX_FORMAT);
    expect(a.index.embedding).toEqual({ model: 'counting', dimensions: 64 });
    expect(a.stats).toMatchObject({ documents: 4, embedded: a.stats.chunks, reused: 0 });
    expect(serializeIndexFile(a.index)).toBe(serializeIndexFile(b.index));
    expect(validateIndexFile(JSON.parse(serializeIndexFile(a.index)))).toEqual(a.index);
  });

  it('serializes one chunk per line so diffs stay small', async () => {
    const { model } = countingModel();
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    const lines = serializeIndexFile(index).split('\n');
    const chunkLines = lines.filter(
      (line) => line.trimStart().startsWith('{"id":"') && line.includes('"vector"'),
    );
    expect(chunkLines).toHaveLength(index.chunks.length);
  });

  it('re-embeds only chunks whose text changed', async () => {
    const first = countingModel();
    const { index: previous } = await buildIndex({
      documents: corpus,
      embeddingModel: first.model,
    });

    const edited = corpus.map((d) =>
      d.id === 'pricing.md' ? { ...d, content: `${d.content} Self-hosting is free too.` } : d,
    );
    const second = countingModel();
    const { index, stats } = await buildIndex({
      documents: edited,
      embeddingModel: second.model,
      previous,
    });
    expect(second.embedded()).toBe(1);
    expect(stats).toMatchObject({ embedded: 1, reused: previous.chunks.length - 1 });
    expect(index.contentHash).not.toBe(previous.contentHash);

    // A different model shares nothing.
    const third = countingModel('other-model');
    await buildIndex({ documents: edited, embeddingModel: third.model, previous: index });
    expect(third.embedded()).toBe(index.chunks.length);
  });

  it('re-embeds everything when provider options such as dimensions change', async () => {
    const first = countingModel('m');
    const { index: previous } = await buildIndex({
      documents: corpus,
      embeddingModel: first.model,
      embeddingProviderOptions: { openai: { dimensions: 64, user: 'docs' } },
    });
    expect(previous.embedding?.settings).toMatch(/^[0-9a-f]{16}$/);

    // Same options, keys in a different order: everything is reused.
    const same = countingModel('m');
    await buildIndex({
      documents: corpus,
      embeddingModel: same.model,
      embeddingProviderOptions: { openai: { user: 'docs', dimensions: 64 } },
      previous,
    });
    expect(same.embedded()).toBe(0);

    // Different options: nothing is reused, even though model and text are unchanged.
    const changed = countingModel('m');
    const { index, stats } = await buildIndex({
      documents: corpus,
      embeddingModel: changed.model,
      embeddingProviderOptions: { openai: { dimensions: 32 } },
      previous,
    });
    expect(stats.reused).toBe(0);
    expect(changed.embedded()).toBe(index.chunks.length);
    expect(index.embedding?.settings).not.toBe(previous.embedding?.settings);

    const check = await checkIndex({
      documents: corpus,
      index,
      embeddingProviderOptions: { openai: { dimensions: 64 } },
    });
    expect(check.problems).toEqual([
      'Index was embedded with different provider options (e.g. dimensions).',
    ]);
  });

  it('matches gateway ids to bare ids, but not across providers', () => {
    expect(sameEmbeddingModel('openai/text-embedding-3-small', 'text-embedding-3-small')).toBe(
      true,
    );
    expect(sameEmbeddingModel('orgA/bge-base', 'orgB/bge-base')).toBe(false);
  });

  it('embeds the heading path with the text, so context reaches the vector', async () => {
    const { model, calls } = countingModel();
    await buildIndex({ documents: corpus, embeddingModel: model });
    expect(calls.flat()).toContain(
      'Rate limiting › Upstash\n\nPass upstashRateLimit with a configured Ratelimit instance for a limit shared across regions.',
    );
  });

  it('rejects duplicate ids and inconsistent dimensions', async () => {
    await expect(buildIndex({ documents: [corpus[0]!, corpus[0]!] })).rejects.toThrow(/Duplicate/);
    let n = 0;
    const flaky = new MockEmbeddingModelV4({
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map(() => Array.from({ length: 4 + (n++ % 2) }, () => 1)),
          warnings: [],
        }),
    });
    await expect(buildIndex({ documents: corpus, embeddingModel: flaky })).rejects.toThrow(
      /dimensions/,
    );
  });
});

describe('document URLs', () => {
  const page = (url: string) => ({ id: 'page.md', url, title: 'Page', content: 'Text.' });

  it.each([
    'javascript:alert(document.cookie)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'mailto:a@example.com',
    '//evil.example/docs',
    '/\\evil.example',
    'javascript :alert(1)',
    'https://',
    '',
    // A `.` or `..` segment, as written or percent-encoded: read as a file path, as the .md copy
    // of the page is written, it leads out of the folder.
    '/../../AGENTS',
    '/%2e%2e/%2e%2e/escaped/pwned',
    '/docs/%2E%2E/%2e./README',
    '/docs/./page',
    '/%5c..%5cAGENTS',
    '../page',
    './page',
    'docs/..',
    'https://example.com/docs/../../a',
    '/../a?x=1#y',
  ])('refuses to index a page at %j', async (url) => {
    await expect(buildIndex({ documents: [page(url)], embeddingModel: null })).rejects.toThrow(
      /Document "page\.md" has the URL .*which a citation cannot link to/,
    );
  });

  it('refuses a frontmatter url that would run script, naming the page', async () => {
    const doc = fromMarkdown('---\ntitle: Evil\nurl: "javascript:alert(1)"\n---\n\nInstall.', {
      id: 'evil.md',
      url: '/evil',
    });
    await expect(buildIndex({ documents: [doc!], embeddingModel: null })).rejects.toThrow(
      'Document "evil.md" has the URL "javascript:alert(1)"',
    );
  });

  it.each([
    '/docs/page',
    'docs/page',
    'page.html?x=1#y',
    'https://example.com/docs/a',
    '/docs/.well-known/a',
    '/docs/v1..v2/...',
    '/docs/a?next=../b#../c',
    '/docs/%252e%252e/a',
  ])('indexes a page at %j', async (url) => {
    const { index } = await buildIndex({ documents: [page(url)], embeddingModel: null });
    expect(index.documents[0]?.url).toBe(url);
  });
});

describe('index file validation', () => {
  it('names the offending field', async () => {
    const { index } = await buildIndex({ documents: corpus });
    expect(() => validateIndexFile({ ...index, format: 'other@9' })).toThrow(
      /Unsupported index format/,
    );
    expect(() =>
      validateIndexFile({ ...index, chunks: [{ ...index.chunks[0], doc: 99 }] }),
    ).toThrow(/chunks\[0\]\.doc/);
    expect(() => validateIndexFile({ ...index, embedding: { model: 'm', dimensions: 8 } })).toThrow(
      /chunks\[0\]\.vector/,
    );
    expect(() => parseIndexFile('{nope')).toThrow(AskIndexError);
  });

  it('reports malformed vectors and fields as AskIndexError', async () => {
    const { model } = countingModel('m', 16);
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    const broken = {
      ...index,
      chunks: index.chunks.map((c, i) => (i === 0 ? { ...c, vector: '%%%' } : c)),
    };
    expect(() => loadIndex(broken)).toThrow(AskIndexError);
    expect(() => loadIndex(broken)).toThrow(/chunks\[0\]\.vector/);
    const noHash = { ...index, chunks: [{ ...index.chunks[0], hash: undefined }] };
    expect(() => validateIndexFile(noHash)).toThrow(/chunks\[0\]\.hash/);
  });

  it('checks vector lengths on load', async () => {
    const { model } = countingModel('m', 16);
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    expect(() => loadIndex({ ...index, embedding: { model: 'm', dimensions: 32 } })).toThrow(
      /16 dimensions/,
    );
  });
});

describe('checkIndex', () => {
  it('passes for unchanged content without calling any model', async () => {
    const { model, calls } = countingModel();
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    const before = calls.length;
    const result = await checkIndex({ documents: corpus, index, embeddingModel: model });
    expect(result).toEqual({ upToDate: true, problems: [], added: [], removed: [], changed: [] });
    expect(calls.length).toBe(before);
  });

  it('lists added, changed and removed chunks', async () => {
    const { index } = await buildIndex({ documents: corpus });
    const edited = [
      ...corpus.filter((d) => d.id !== 'pricing.md'),
      { id: 'faq.md', url: '/faq', title: 'FAQ', content: 'Questions.' },
    ].map((d) => (d.id === 'install.md' ? { ...d, content: d.content.replace('22', '24') } : d));
    const result = await checkIndex({ documents: edited, index });
    expect(result.upToDate).toBe(false);
    expect(result.added).toEqual(['faq.md#0']);
    expect(result.removed).toEqual(['pricing.md#0']);
    expect(result.changed).toEqual(['install.md#1']);
  });

  it('fails on chunking, model or dimension drift', async () => {
    const { model } = countingModel('m', 16);
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    expect(
      (await checkIndex({ documents: corpus, index, chunking: { maxChars: 300 } })).upToDate,
    ).toBe(false);
    const otherModel = await checkIndex({ documents: corpus, index, embeddingModel: 'other' });
    expect(otherModel.problems).toEqual(['Index was embedded with "m", expected "other".']);
    // Gateway-style ids match bare ids.
    expect(
      (await checkIndex({ documents: corpus, index, embeddingModel: 'acme/m' })).upToDate,
    ).toBe(true);
    const dims = await checkIndex({ documents: corpus, index, embeddingDimensions: 32 });
    expect(dims.problems).toEqual(['Index vectors have 16 dimensions, expected 32.']);
  });
});

describe('large indexes', () => {
  const MiB = 1024 * 1024;
  const cli = {
    dimensions: '--dimensions 512',
    keywordOnly: '--embedding none',
    exclude: '--ignore <glob>',
  };

  it('warns only over 20 MiB', () => {
    expect(LARGE_INDEX_BYTES).toBe(20 * MiB);
    expect(largeIndexWarning('ask-index.json', 20 * MiB, null, cli)).toBeUndefined();
    expect(largeIndexWarning('ask-index.json', 20 * MiB + 1, null, cli)).toMatch(
      /^ask-index\.json is 20\.0 MiB\. Cloudflare Pages and Workers refuse a static asset over 25 MiB/,
    );
  });

  it('names only the ways to make it smaller that the index does not take already', () => {
    const at = (dimensions: number | null) =>
      largeIndexWarning(
        'ask-index.json',
        32.7 * MiB,
        dimensions === null ? null : { model: 'text-embedding-3-small', dimensions },
        cli,
      );
    expect(at(1536)).toContain(
      'To make it smaller, build it at 512 dimensions (--dimensions 512), build it keyword-only ' +
        '(--embedding none) or leave pages out (--ignore <glob>). See https://ondocs.vercel.app/docs/limits#index-size',
    );
    expect(at(512)).toContain(
      'To make it smaller, build it keyword-only (--embedding none) or leave pages out (--ignore <glob>).',
    );
    expect(at(null)).toContain('To make it smaller, leave pages out (--ignore <glob>).');
  });

  it('links a section the limits page has', async () => {
    const page = await readFile(
      join(import.meta.dirname, '../examples/nextjs/content/docs/limits.md'),
      'utf8',
    );
    expect(page).toMatch(/^## Index size$/m);
    expect(page).toContain('25 MiB');
  });

  describe('from writeSiteIndex', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'ondocs-large-index-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    /** A model that gives every text the same vector, to build a large index quickly. */
    const sameVector = (dims: number) => {
      const vector = Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0));
      return new MockEmbeddingModelV4({
        modelId: 'same-vector',
        maxEmbeddingsPerCall: 100,
        doEmbed: ({ values }) =>
          Promise.resolve({ embeddings: values.map(() => vector), warnings: [] }),
      });
    };
    /** `count` pages of about 1 MB, one chunk each. */
    const pages = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `p${String(i)}.md`,
        url: `/p${String(i)}`,
        title: `Page ${String(i)}`,
        content: 'Deploy the site and the endpoint reads the index. '.repeat(21_000),
      }));
    const write = async (count: number, dims: number) => {
      const log = { info: vi.fn(), warn: vi.fn() };
      await writeSiteIndex({
        documents: pages(count),
        embeddingModel: sameVector(dims),
        options: { chunking: { maxChars: 2_000_000, overlap: 0 } },
        file: join(dir, 'dist/ask-index.json'),
        cache: { path: join(dir, 'cache/ask-index.json') },
        name: 'dist/ask-index.json',
        log,
      });
      return log.warn.mock.calls.map(([message]) => String(message));
    };

    it('warns over 20 MiB, naming the plugin options that make it smaller', async () => {
      const [warning, ...more] = await write(21, 1536);
      expect(more).toEqual([]);
      expect(warning).toMatch(/^dist\/ask-index\.json is 2\d\.\d MiB\. /);
      expect(warning).toContain(
        "To make it smaller, build it at 512 dimensions (dimensions: 512), build it keyword-only (embedding: 'none') or leave pages out (exclude).",
      );
      // The plugins write one index per locale already.
      expect(warning).not.toContain('locale');
    });

    it('says nothing about a smaller index', async () => {
      expect(await write(10, 1536)).toEqual([]);
    });
  });
});
