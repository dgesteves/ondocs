// `ondocs eval` with an index embedded through a config module's model, which `ondocs dev`
// cannot load, or through its `embedding` and `dimensions`, and the ranks past the top three:
// hit@5, MRR and every page found, and the words of a refused question that no page has.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { customProvider } from 'ai';
import { MockEmbeddingModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex } from '../../src';
import { main } from '../../src/cli/main';
import { hashEmbedding } from '../../src/mock';
import { writeIndexFile } from '../../src/node';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ondocs-eval-command-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function runWith(env: Record<string, string | undefined>, args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(args, {
    cwd,
    env,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
const run = (...args: string[]) => runWith({}, args);

/**
 * A config module whose embedding model is a local one of its own, as a self-hosted or another
 * provider's would be: `modelId` names it, its vectors have `dimensions` numbers, and each text it
 * embeds is counted on `globalThis`.
 */
const config = (modelId: string, dimensions = 256) => `
import { hashEmbedding } from ${JSON.stringify(new URL('../../src/mock/index.ts', import.meta.url).href)};
export default {
  embeddingModel: {
    specificationVersion: 'v4',
    provider: 'local',
    modelId: ${JSON.stringify(modelId)},
    maxEmbeddingsPerCall: 64,
    supportsParallelCalls: true,
    async doEmbed({ values }) {
      globalThis.ondocsEvalEmbedded = (globalThis.ondocsEvalEmbedded ?? 0) + values.length;
      return { embeddings: values.map((value) => hashEmbedding(value, ${String(dimensions)})), warnings: [] };
    },
  },
};
`;

describe('ondocs eval -c', () => {
  beforeEach(async () => {
    await mkdir(join(cwd, 'content'));
    await writeFile(
      join(cwd, 'content/deploy.md'),
      '# Deploying\n\nShip the site to the edge with one command, and roll back from the dashboard.\n',
    );
    await writeFile(
      join(cwd, 'content/search.md'),
      '# Search\n\nThe search box ranks pages by keywords and by meaning.\n',
    );
    await writeFile(
      join(cwd, 'questions.yaml'),
      'questions:\n  - question: How do I deploy the site to the edge?\n    expect: /deploy\n',
    );
    await writeFile(join(cwd, 'ask.config.mjs'), config('nomic-embed-text'));
    await writeFile(join(cwd, 'other.config.mjs'), config('all-minilm'));
    await writeFile(join(cwd, 'smaller.config.mjs'), config('nomic-embed-text', 32));
    await writeFile(join(cwd, 'plain.config.mjs'), "export default { baseUrl: '/' };\n");
    await writeFile(join(cwd, 'spec.config.mjs'), "export default { embedding: 'mock' };\n");
    await writeFile(
      join(cwd, 'openai.config.mjs'),
      "export default { embedding: 'openai:text-embedding-3-small', dimensions: 256 };\n",
    );
    await writeFile(join(cwd, 'broken.config.mjs'), 'export default {;\n');
    const built = await run('index', 'content', '-c', 'ask.config.mjs', '--framework', 'none');
    expect(built.code).toBe(0);
  });

  it('embeds the questions with the config module’s model, as the index was built', async () => {
    const before = (globalThis as { ondocsEvalEmbedded?: number }).ondocsEvalEmbedded ?? 0;
    const result = await run('eval', 'questions.yaml', '-c', 'ask.config.mjs', '--json');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      retrieval: string;
      results: { rank: number | null; best: { similarity: number | null } }[];
    };
    expect(report.retrieval).toBe('hybrid');
    expect(report.results[0]?.rank).toBe(1);
    expect(report.results[0]?.best.similarity).toBeGreaterThan(0);
    const after = (globalThis as { ondocsEvalEmbedded?: number }).ondocsEvalEmbedded ?? 0;
    expect(after - before).toBe(1);
  });

  it('says to pass -c when the index’s model is not one it can load by name', async () => {
    const result = await run('eval', 'questions.yaml');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('nomic-embed-text, which ondocs dev cannot load');
    expect(result.stderr).toContain('Or pass -c with the config module that embeds with it');
  });

  it('refuses a config whose model is not the index’s, and a config that is not there', async () => {
    const other = await run('eval', 'questions.yaml', '--config', 'other.config.mjs');
    expect(other.code).toBe(2);
    expect(other.stderr).toContain(
      'The index was embedded with nomic-embed-text, but other.config.mjs embeds with all-minilm.',
    );
    // A model named with `embedding` is the config's too, as `ondocs index -c` reads it.
    const spec = await run('eval', 'questions.yaml', '-c', 'spec.config.mjs');
    expect(spec.code).toBe(2);
    expect(spec.stderr).toContain(
      'The index was embedded with nomic-embed-text, but spec.config.mjs embeds with mock-hash-512.',
    );
    const missing = await run('eval', 'questions.yaml', '-c', 'missing.mjs');
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Config file not found: missing.mjs');
  });

  it('says so when the config names no model', async () => {
    const result = await run('eval', 'questions.yaml', '-c', 'plain.config.mjs');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'plain.config.mjs sets neither embedding nor embeddingModel, so questions are embedded with the model the index records. The index was embedded with nomic-embed-text, which ondocs dev cannot load',
    );
    expect(result.stderr).toContain(
      'Or set the embedding or embeddingModel the index was built with in plain.config.mjs, or pass --keyword-only.',
    );
  });

  it('asks for the key, not a config, when the model needs a key', async () => {
    // An index of OpenAI's model, which ondocs dev loads with a key: a config module is no fix.
    await writeFile(join(cwd, 'named.config.mjs'), config('text-embedding-3-small'));
    const built = await run('index', 'content', '-c', 'named.config.mjs', '-o', 'openai.json');
    expect(built.code).toBe(0);
    const bare = await run('eval', 'questions.yaml', '--index', 'openai.json');
    expect(bare.code).toBe(2);
    expect(bare.stderr).toBe(
      '✗ The index was embedded with text-embedding-3-small, so questions must be too: set OPENAI_API_KEY or AI_GATEWAY_API_KEY. To try it without a key, rebuild the index with --embedding mock. Or pass --keyword-only.',
    );
    const plain = await run(
      'eval',
      'questions.yaml',
      '--index',
      'openai.json',
      '-c',
      'plain.config.mjs',
    );
    expect(plain.code).toBe(2);
    expect(plain.stderr).toContain('set OPENAI_API_KEY or AI_GATEWAY_API_KEY');
    expect(plain.stderr).not.toContain('Or set the embedding');
    expect(plain.stderr).toMatch(/Or pass --keyword-only\.$/);
    // A config whose `embedding` needs a key says which.
    const spec = await run(
      'eval',
      'questions.yaml',
      '--index',
      'openai.json',
      '-c',
      'openai.config.mjs',
    );
    expect(spec.code).toBe(2);
    expect(spec.stderr).toBe(
      "✗ openai.config.mjs's embedding: 'openai:text-embedding-3-small' needs OPENAI_API_KEY. Or pass --keyword-only.",
    );
  });

  describe('with a model named by the config’s embedding, at its dimensions', () => {
    // An AI Gateway id, which the AI SDK resolves through its default provider: here one whose
    // model embeds at the size its provider options ask for, else at 1024, as Cohere's does.
    let sizes: number[];
    beforeEach(async () => {
      sizes = [];
      globalThis.AI_SDK_DEFAULT_PROVIDER = customProvider({
        embeddingModels: {
          'cohere/embed-v4.0': new MockEmbeddingModelV4({
            provider: 'cohere',
            modelId: 'embed-v4.0',
            doEmbed: ({ values, providerOptions }) => {
              const size = Number(providerOptions?.cohere?.dimensions ?? 1024);
              sizes.push(size);
              return Promise.resolve({
                embeddings: values.map((value) => hashEmbedding(value, size)),
                warnings: [],
              });
            },
          }),
        },
      });
      await writeFile(
        join(cwd, 'gateway.config.mjs'),
        "export default { embedding: 'cohere/embed-v4.0', dimensions: 64 };\n",
      );
      const built = await run('index', 'content', '-c', 'gateway.config.mjs', '-o', 'gateway.json');
      expect(built.code).toBe(0);
      expect([...new Set(sizes)]).toEqual([64]);
      sizes = [];
    });
    afterEach(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
    });

    it('embeds the questions at the size ondocs index -c embedded the pages', async () => {
      const args = [
        'eval',
        'questions.yaml',
        '--index',
        'gateway.json',
        '-c',
        'gateway.config.mjs',
      ];
      const result = await run(...args, '--json');
      expect(result.code).toBe(0);
      const report = JSON.parse(result.stdout) as {
        retrieval: string;
        results: { rank: number }[];
      };
      expect(report).toMatchObject({ retrieval: 'hybrid', results: [{ rank: 1 }] });
      expect(sizes).toEqual([64]);
    });

    it('says which settings fix the size without the config, and they do', async () => {
      // The model the index records, at the model's own size, as ondocs dev embeds with it.
      const env = { AI_GATEWAY_API_KEY: 'test' };
      const bare = await runWith(env, ['eval', 'questions.yaml', '--index', 'gateway.json']);
      expect(bare.code).toBe(2);
      expect(bare.stderr).toBe(
        '✗ cohere/embed-v4.0 embeds questions in 1024 dimensions, but the index was embedded in 64. Rebuild the index, or pass -c with a config module that sets the model and size it was built with (embedding and dimensions, or embeddingModel and embeddingProviderOptions).',
      );
      await writeFile(
        join(cwd, 'unsized.config.mjs'),
        "export default { embedding: 'cohere/embed-v4.0' };\n",
      );
      const unsized = await run(
        'eval',
        'questions.yaml',
        '--index',
        'gateway.json',
        '-c',
        'unsized.config.mjs',
      );
      expect(unsized.code).toBe(2);
      expect(unsized.stderr).toBe(
        '✗ unsized.config.mjs embeds questions in 1024 dimensions, but the index was embedded in 64. Set the dimensions the index was built with in unsized.config.mjs, or rebuild the index with it.',
      );
    });
  });

  it('stops before scoring when the config’s vectors are not the index’s size', async () => {
    const result = await run('eval', 'questions.yaml', '-c', 'smaller.config.mjs');
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      '✗ smaller.config.mjs embeds questions in 32 dimensions, but the index was embedded in 256. Set the embeddingProviderOptions the index was built with in smaller.config.mjs, or rebuild the index with it.',
    );
  });

  it('searches by keywords alone with --keyword-only, without importing the config', async () => {
    for (const file of ['other.config.mjs', 'broken.config.mjs']) {
      const result = await run('eval', 'questions.yaml', '-c', file, '--keyword-only', '--json');
      expect(result.code).toBe(0);
      expect((JSON.parse(result.stdout) as { retrieval: string }).retrieval).toBe('keyword');
    }
  });
});

describe('ondocs eval past the top three', () => {
  // Six pages of the same length, the first with "zebra" six times and each next one once less,
  // so a search for it ranks them in order.
  beforeEach(async () => {
    const documents = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `p${String(n)}.md`,
      url: `/docs/p${String(n)}`,
      title: `Page ${String(n)}`,
      content: `${'zebra '.repeat(7 - n)}${'lorem '.repeat(n + 3)}`.trim(),
    }));
    const { index } = await buildIndex({ documents });
    await writeIndexFile(join(cwd, 'ask-index.json'), index);
    await writeFile(
      join(cwd, 'questions.yaml'),
      `questions:
  - question: zebra
    expect: /docs/p1
  - question: zebra
    expect: /docs/p4
  - question: zebra
    expect: /docs/elsewhere
  - question: quokka habitat
    expect: /docs/p1
  - question: Where do quokkas live?
    unanswerable: true
`,
    );
  });

  it('scores hit@5 and MRR, with thresholds of their own', async () => {
    const json = await run('eval', 'questions.yaml', '--json');
    const report = JSON.parse(json.stdout) as {
      scores: Record<string, { value: number; count: number; of: number }>;
      results: { rank: number | null; found: string[]; absent: string[] }[];
    };
    expect(report.results.map((result) => result.rank)).toEqual([1, 4, null, null, null]);
    expect(report.scores['hit@3']).toMatchObject({ count: 1, of: 4 });
    expect(report.scores['hit@5']).toMatchObject({ count: 2, of: 4, value: 0.5 });
    // (1/1 + 1/4) over the four answerable questions; one not found and one refused add 0.
    expect(report.scores.mrr).toMatchObject({ count: 1.25, of: 4, value: 0.3125 });
    expect(report.results[1]?.found).toEqual([
      '/docs/p1',
      '/docs/p2',
      '/docs/p3',
      '/docs/p4',
      '/docs/p5',
      '/docs/p6',
    ]);

    const text = await run('eval', 'questions.yaml', '--min-hit-at-5', '0.6', '--min-mrr', '0.3');
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('  hit@5              0.50  (2/4)  threshold 0.6 ✗');
    expect(text.stdout).toContain('  MRR                0.31  (1.25/4)  threshold 0.3 ✓');
    expect(text.stderr).toBe('✗ hit@5 is 0.50, under its threshold of 0.6.');

    await writeFile(
      join(cwd, 'thresholds.yaml'),
      'thresholds: { hit@5: 0.5, mrr: 0.31 }\nquestions:\n  - question: zebra\n    expect: /docs/p4\n',
    );
    const fromFile = await run('eval', 'thresholds.yaml', '--json');
    expect(fromFile.code).toBe(1);
    expect(JSON.parse(fromFile.stdout)).toMatchObject({
      scores: { 'hit@5': { value: 1, pass: true }, mrr: { value: 0.25, pass: false } },
    });
  });

  it('prints every page found, and the words of a refused question no page has', async () => {
    const { stdout } = await run('eval', 'questions.yaml');
    // Ranked fourth, which counts toward hit@5 and MRR, and not found at all.
    for (const mark of ['4', '-']) {
      expect(stdout).toMatch(
        new RegExp(
          `✗ ${mark}\\s+zebra\\s+cov 1\\.00 {2}→ /docs/p1, /docs/p2, /docs/p3, /docs/p4, /docs/p5, /docs/p6$`,
          'm',
        ),
      );
    }
    // Sixth, at the default topK of six chunks: it counts toward MRR, and the list shows it.
    await writeFile(
      join(cwd, 'sixth.yaml'),
      'questions:\n  - question: zebra\n    expect: /docs/p6\n',
    );
    const sixth = await run('eval', 'sixth.yaml');
    expect(sixth.stdout).toMatch(/✗ 6\s+zebra\s+cov 1\.00 {2}→ \/docs\/p1, .*, \/docs\/p6$/m);
    expect(sixth.stdout).toContain('  MRR                0.17  (0.17/1)');
    expect(stdout).toMatch(
      /✗ refused\s+quokka habitat\s+cov 0\.00 {2}expected \/docs\/p1; not in the docs: quokka, habitat/,
    );
    const json = JSON.parse((await run('eval', 'questions.yaml', '--json')).stdout) as {
      results: { absent: string[] }[];
    };
    expect(json.results.map((result) => result.absent)).toEqual([
      [],
      [],
      [],
      ['quokka', 'habitat'],
      ['quokka', 'live'],
    ]);
  });
});
