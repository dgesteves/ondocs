// What the docs say about ondocs itself: what it is, who it is for, how it compares, and the
// numbers they quote. Each claim checked here is one that was out of date or said more than was
// measured, so a page that drifts back fails here. The eval counts are checked against what
// `ondocs eval` scores on docusaurus.io's docs, the corpus test/corpus.test.ts searches: CI
// fetches it, and locally `node scripts/corpus.mjs` does, or that part is skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildIndex, parseFrontmatter } from '../src';
import { main } from '../src/cli/main';
import { loadDirectory, writeIndexFile } from '../src/node';

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
