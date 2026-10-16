// What the docs say about ondocs itself: what it is, who it is for, how it compares, and the
// numbers they quote. Each claim checked here is one that was out of date or said more than was
// measured, so a page that drifts back fails here. The eval counts are checked against what
// `ondocs eval` scores on docusaurus.io's docs, the corpus test/corpus.test.ts searches: CI
// fetches it, and locally `node scripts/corpus.mjs` does, or that part is skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  buildIndex,
  chunkDocument,
  DEFAULT_CHUNKING,
  loadIndex,
  parseFrontmatter,
  retrieve,
  tokenize,
} from '../src';
import { main } from '../src/cli/main';
import { MOCK_MIN_SIMILARITY, hashEmbedding, mockEmbeddingModel } from '../src/mock';
import { loadDirectory, writeIndexFile } from '../src/node';
import { searchSections } from '../src/server/mcp-tools';
import { QUESTIONS, SITES, type SiteLanguage } from './cjk-sites';

const root = join(import.meta.dirname, '..');
const DOCS = join(root, 'examples/nextjs/content/docs');

/** A docs page's frontmatter and body. */
const doc = (slug: string) => {
  const { data, body } = parseFrontmatter(readFileSync(join(DOCS, `${slug}.md`), 'utf8'));
  const description = typeof data.description === 'string' ? data.description : '';
  return { description, body: body.trim() };
};

/** The text under a `## ` heading of `body`, up to the next `## ` heading. */
const section = (body: string, heading: string) => {
  const start = body.split('\n').indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`no "## ${heading}" section`);
  const rest = body
    .split('\n')
    .slice(start + 1)
    .join('\n');
  const end = rest.search(/^## /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
};

/** The first paragraph of a page or section. */
const firstParagraph = (text: string) => text.split(/\n\s*\n/)[0] ?? '';

/** A Markdown table's row whose first cell is `label`, as its other cells. */
const row = (body: string, label: string) =>
  body
    .split('\n')
    .find((line) => line.startsWith(`| ${label} `))
    ?.split('|')
    .slice(2, -1)
    .map((cell) => cell.trim());

const PITCH = 'open-source Ask AI for your docs, with an MCP server for agents';

describe('what the docs say ondocs is', () => {
  it('leads with open-source Ask AI, with an MCP server for agents', () => {
    const introduction = doc('introduction');
    expect(introduction.description).toContain(PITCH);
    expect(firstParagraph(introduction.body)).toMatch(new RegExp(`^ondocs is ${PITCH}\\.`));
    expect(firstParagraph(section(doc('faq').body, 'What is ondocs?'))).toMatch(
      new RegExp(`^ondocs is ${PITCH}`),
    );
  });

  it('says who it is for, as the introduction’s description promises', () => {
    const { description, body } = doc('introduction');
    expect(description).toMatch(/Who it is for/);
    const audience = section(body, 'Who it is for');
    expect(audience).toMatch(/developer docs/);
    expect(audience).toMatch(/Starlight/);
  });

  it('names Starlight first, in the pitch and in the setup lists', () => {
    const introduction = doc('introduction').body;
    const lead = firstParagraph(introduction);
    expect(lead.indexOf('Starlight')).toBeGreaterThan(-1);
    expect(lead.indexOf('Starlight')).toBeLessThan(lead.indexOf('Docusaurus'));
    const fits = section(introduction, 'When it fits');
    expect(fits.indexOf('Starlight')).toBeLessThan(fits.indexOf('Docusaurus'));
    const setups = section(doc('getting-started').body, 'Pick your setup')
      .split('\n')
      .filter((line) => line.startsWith('- '));
    expect(setups[0]).toMatch(/^- \*\*Starlight/);
  });

  it('says what a model key is for: Ask needs one, Workers AI no key, MCP and llms.txt no model', () => {
    const needs = section(doc('introduction').body, 'What you need');
    expect(needs).toMatch(/For the Ask box/);
    expect(needs).toMatch(/Workers AI[^.]*no API key/);
    expect(needs).toMatch(/MCP server and llms\.txt need no model/);
  });

  it('names the AI SDK major version the package needs', () => {
    const { peerDependencies } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>;
    };
    const major = /^\^(\d+)\./.exec(peerDependencies.ai ?? '')?.[1];
    expect(major).toBeDefined();
    expect(section(doc('getting-started').body, 'Install')).toContain(`AI SDK ${String(major)}`);
  });
});

describe('how the docs compare it', () => {
  it('does not say Algolia’s Ask AI answers with Algolia’s model and key', () => {
    // Algolia's Ask AI takes your own LLM provider and key; it still indexes on Algolia's platform.
    const answer = section(
      doc('faq').body,
      'How is it different from Kapa, Inkeep or Algolia Ask AI?',
    );
    expect(answer).toMatch(/Algolia's Ask AI[^.]*your own[^.]*key/);
  });

  it('answers why a site would serve its own MCP server when Context7 indexes docs', () => {
    const faq = doc('faq').body;
    const heading = /^## (.*Context7.*)$/m.exec(faq)?.[1];
    expect(heading).toMatch(/DocSearch MCP/);
    const answer = section(faq, String(heading));
    expect(answer).toContain('](/docs/mcp');
    expect(section(doc('introduction').body, 'How it compares')).toMatch(/MCP/);
  });
});

describe('the docs’ numbers', () => {
  it('say "chosen", not "calibrated", of a similarity threshold no eval has measured', () => {
    const pages = readdirSync(DOCS).filter((file) => file.endsWith('.md'));
    const calibrated = pages.filter((file) =>
      /calibrat/i.test(readFileSync(join(DOCS, file), 'utf8')),
    );
    expect(calibrated).toEqual([]);
    expect(section(doc('limits').body, 'Tuning per embedding model')).toMatch(/chosen for OpenAI/);
  });

  it('do not promise that a question the docs do not cover never reaches the model', () => {
    // A general programming question can share enough words with the docs to clear the gate.
    const faq = doc('faq').body;
    const cost = section(faq, 'How much does it cost to run?');
    expect(cost).not.toMatch(/A question the docs can't answer costs the embedding call only/);
    for (const text of [
      cost,
      section(faq, "What happens when the docs don't cover a question?"),
      section(doc('introduction').body, 'How it works'),
      section(doc('workers-ai').body, 'Keywords, or meaning too'),
    ]) {
      expect(text).toMatch(/reach(es)? the model/);
    }
  });

  it('scope the agent-search counts to the queries the project wrote, and link them', () => {
    const paragraph = section(doc('mcp').body, 'Keyword-only or hybrid search')
      .split(/\n\s*\n/)
      .find((text) => text.includes('top three'));
    expect(paragraph).toBeDefined();
    expect(paragraph).toMatch(/written for this test/);
    expect(paragraph).toMatch(/best case/);
    expect(paragraph).toContain('test/corpus.test.ts');
    expect(paragraph).not.toMatch(/Agents write good search queries/);
  });
});

describe('what the docs say about Chinese, Japanese and Korean', () => {
  // Keyword search splits words at spaces and punctuation, so a run of Chinese or Japanese is one
  // term, and a Korean word keeps its particle or ending: a question matches a page only where
  // both have the same run. The docs said keyword matching was only "weaker" in other languages.
  // These are the counts the limits page quotes, on the same small site in each language.

  /** Of the questions, how many each keyword path answers with the right page first. */
  const measure = async (language: SiteLanguage) => {
    const documents = SITES[language];
    const keywordOnly = loadIndex((await buildIndex({ documents })).index);
    const mock = loadIndex(
      (await buildIndex({ documents, embeddingModel: mockEmbeddingModel() })).index,
    );
    const page = (url: string | undefined) =>
      documents.find((document) => document.url === url?.split('#')[0])?.id;
    const counts = { keywordOnly: 0, mock: 0, mcp: 0 };
    for (const [question, id] of QUESTIONS[language]) {
      if (page(retrieve(keywordOnly, { text: question }).hits[0]?.chunk.url) === id) {
        counts.keywordOnly += 1;
      }
      // As `ondocs dev` and the Astro route answer from a `-e mock` index.
      const vector = hashEmbedding(question, 512);
      const answer = retrieve(
        mock,
        { text: question, vector },
        { minSimilarity: MOCK_MIN_SIMILARITY },
      );
      if (page(answer.hits[0]?.chunk.url) === id) counts.mock += 1;
      if (page(searchSections(keywordOnly, question, null, {})[0]?.id) === id) counts.mcp += 1;
    }
    return counts;
  };

  it('quote what keyword search finds in them, against the same site in English', async () => {
    const asked = QUESTIONS.zh.length;
    const [zh, ja, ko, en] = await Promise.all((['zh', 'ja', 'ko', 'en'] as const).map(measure));
    const cells = (key: 'keywordOnly' | 'mock' | 'mcp') =>
      [zh, ja, ko, en].map((counts) => `${String(counts?.[key])} of ${String(asked)}`);
    const language = section(doc('limits').body, 'Language');
    expect(row(language, 'Ask endpoint, `-e none` index')).toEqual(cells('keywordOnly'));
    expect(row(language, 'Ask endpoint, `-e mock` index')).toEqual(cells('mock'));
    expect(row(language, 'MCP search without `embeddingModel`')).toEqual(cells('mcp'));
    expect(language).toContain(`asked ${String(asked)} questions its pages answer`);
    expect(language).toContain('test/docs-claims.test.ts');
    expect(language).not.toMatch(/Other languages still work/);
  });

  it('explain why, with examples that tokenize and search as they say', async () => {
    expect(tokenize('怎么安装插件？')).toEqual(['怎么安装插件']);
    const zh = loadIndex((await buildIndex({ documents: SITES.zh })).index);
    expect(searchSections(zh, '环境变量', null, {}).map((result) => result.id)).toEqual([
      '/zh/docs/config#环境变量',
    ]);
    // The Korean install page says 설치합니다; the question's form of the word finds nothing.
    const ko = loadIndex((await buildIndex({ documents: SITES.ko })).index);
    expect(tokenize('설치하나요')).toHaveLength(1);
    expect(searchSections(ko, '설치하나요', null, {})).toEqual([]);
    expect(searchSections(ko, '설치합니다', null, {})[0]?.id).toMatch(/^\/ko\/docs\/install#/);

    const language = section(doc('limits').body, 'Language');
    expect(language).toContain('`怎么安装插件？` is the single word `怎么安装插件`');
    expect(language).toContain(
      'The query `环境变量` finds the section headed 环境变量, not the page that says 部署时需要设置环境变量',
    );
    expect(language).toContain('`설치하나요` in a question does not match `설치합니다` on a page');
  });

  it('say that an embedding model lets a question through with no word in common', async () => {
    // A stand-in for a multilingual model: the question and the install page share a meaning.
    const embeddingModel = new MockEmbeddingModelV4({
      provider: 'test',
      modelId: 'multilingual',
      maxEmbeddingsPerCall: 2048,
      supportsParallelCalls: true,
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map((value) => (value.includes('安装') ? [1, 0] : [0, 1])),
          usage: { tokens: 0 },
          warnings: [],
        }),
    });
    const loaded = loadIndex((await buildIndex({ documents: SITES.zh, embeddingModel })).index);
    const vector = [1, 0];
    const result = retrieve(loaded, { text: '怎么安装插件？', vector });
    expect(result.best.keywordCoverage).toBe(0);
    expect(result.hits[0]?.chunk.url).toMatch(/^\/zh\/docs\/install#/);
    expect(searchSections(loaded, '怎么安装插件？', vector, {})[0]?.id).toMatch(
      /^\/zh\/docs\/install#/,
    );

    const language = section(doc('limits').body, 'Language');
    expect(language).toMatch(/pass it as `embeddingModel` to `createMcpHandler`/);
    expect(language).toMatch(/on similarity alone, with no word in common/);
    const faq = section(doc('faq').body, "Does it work for docs that aren't in English?");
    expect(faq).toMatch(/Chinese, Japanese and Korean/);
    expect(faq).toContain('`embeddingModel`');
    expect(faq).toContain('](/docs/limits#language)');
    expect(faq).not.toMatch(/so it is weaker in other languages\. The plugins/);
  });

  it('say that a long paragraph in them is cut mid-sentence, with no overlap', () => {
    const paragraph = Array.from(
      { length: 60 },
      (_, i) => `第${String(i)}步：使用包管理器安装插件，然后重新启动开发服务器以加载新的配置。`,
    ).join('');
    const chunks = chunkDocument({
      id: 'long',
      url: '/zh/long',
      title: '长段落',
      content: paragraph,
    });
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.text.length).toBe(DEFAULT_CHUNKING.maxChars);
    expect(chunks[0]?.text.endsWith('。')).toBe(false);
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(paragraph);
    const language = section(doc('limits').body, 'Language');
    expect(language).toContain(
      `is cut at ${DEFAULT_CHUNKING.maxChars.toLocaleString('en-US')} characters, mid-sentence, with no overlap`,
    );
    expect(language).toContain('`。` does not count as the end of a sentence');
  });
});

describe('the website’s own eval', () => {
  // CI scores these pages with examples/nextjs/ask-eval.yaml, and the deploy recipes ask an index
  // of them one of its off-topic questions. A page that quotes such a question (as an example of
  // one the gate stops) gives it the keyword coverage to clear the gate, and both fail.
  it('refuses the off-topic questions it asks of these pages, on the index the build writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ondocs-docs-claims-'));
    try {
      const io = { cwd: dir, env: {}, stdout: () => undefined, stderr: () => undefined };
      // As `pnpm index` builds it without a key: the mock model, and the framework detected.
      const built = await main(
        ['index', DOCS, '-o', 'ask-index.json', '--base-url', '/docs', '-e', 'mock', '-q'],
        io,
      );
      expect(built).toBe(0);
      const out: string[] = [];
      const code = await main(
        [
          'eval',
          join(root, 'examples/nextjs/ask-eval.yaml'),
          '--index',
          'ask-index.json',
          '--json',
        ],
        { ...io, stdout: (line) => out.push(line) },
      );
      const { results } = JSON.parse(out.join('\n')) as {
        results: { question: string; unanswerable: boolean; refused: boolean }[];
      };
      const answered = results.filter((result) => result.unanswerable && !result.refused);
      expect(answered.map((result) => result.question)).toEqual([]);
      expect(results.some((result) => result.unanswerable)).toBe(true);
      expect(code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const corpus = join(
  process.env.ONDOCS_CORPUS ?? join(import.meta.dirname, '..', '.corpus'),
  'docusaurus',
);
const present = existsSync(join(corpus, 'website/docs'));

describe.skipIf(!present)('the eval counts the docs quote, keyword-only', () => {
  /**
   * `ondocs eval` of the sample eval file on a keyword-only index of docusaurus.io's docs: what it
   * prints, and the same report with `--json`.
   */
  const run = async () => {
    const documents = await loadDirectory(join(corpus, 'website/docs'), {
      baseUrl: '/docs',
      framework: 'docusaurus',
    });
    const { index } = await buildIndex({ documents });
    const dir = await mkdtemp(join(tmpdir(), 'ondocs-docs-claims-'));
    try {
      await writeIndexFile(join(dir, 'ask-index.json'), index);
      const evaluate = async (...flags: string[]) => {
        const out: string[] = [];
        await main(
          [
            'eval',
            join(import.meta.dirname, 'eval/docusaurus.io.yaml'),
            '--index',
            'ask-index.json',
            ...flags,
          ],
          { cwd: dir, env: {}, stdout: (line) => out.push(line), stderr: () => undefined },
        );
        return out.join('\n');
      };
      return { text: await evaluate(), json: await evaluate('--json') };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('match the tables and the sample output on the Workers AI and answer quality pages', async () => {
    const { text, json } = await run();
    const { scores } = JSON.parse(json) as {
      scores: Record<string, { count: number; of: number }>;
    };
    const score = (name: string) => scores[name] ?? { count: -1, of: -1 };
    const hit1 = score('hit@1');
    const hit3 = score('hit@3');
    const precision = score('refusalPrecision');
    const recall = score('refusalRecall');
    const cells = [
      `${String(hit1.count)} of ${String(hit1.of)}`,
      `${String(hit3.count)} of ${String(hit3.of)}`,
      `${String(recall.of - recall.count)} of ${String(recall.of)}`,
    ];
    const refusedAnswerable = `${String(precision.of - precision.count)} of ${String(hit1.of)}`;
    const offTopicRefused =
      recall.count === recall.of
        ? `all ${String(recall.of)}`
        : `${String(recall.count)} of ${String(recall.of)}`;

    expect(row(doc('workers-ai').body, 'Keywords only')).toEqual(cells);
    const quality = doc('quality').body;
    expect(row(quality, 'Keywords only')).toEqual([...cells, refusedAnswerable]);
    expect(quality).toContain(
      `keyword search scores hit@1 ${cells[0] ?? ''}, hit@3 ${cells[1] ?? ''}, and refuses ${offTopicRefused} off-topic questions and ${String(precision.of - precision.count)} it should answer`,
    );

    // The sample output, shortened: every line of it is a line the command prints.
    const printed = new Set(text.split('\n').map((line) => line.trimEnd()));
    const sample = /```console\n\$ npx ondocs eval docusaurus\.io\.yaml[^\n]*\n([\s\S]*?)```/.exec(
      quality,
    )?.[1];
    expect(sample).toBeDefined();
    const lines = String(sample)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== '');
    expect(lines.filter((line) => !printed.has(line))).toEqual([]);
  });
});
