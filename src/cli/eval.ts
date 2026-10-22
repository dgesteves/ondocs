// `ondocs eval`: scores retrieval against questions with known answers, for CI. It runs what
// the endpoint runs before the model (embedding, hybrid retrieval and the relevance gate), so it
// costs one embedding call per question at most, and no model call. Node.js only.
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { embed, type EmbeddingModel } from 'ai';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { embeddingModelId, sameEmbeddingModel, type EmbeddingProviderOptions } from '../build';
import { MOCK_MIN_SIMILARITY } from '../mock';
import { readIndexFile } from '../node';
import { embeddingFromSpec, EmbeddingSpecError } from '../node/embedding';
import { loadIndex, retrieve, type LoadedIndex, type RetrievalOptions } from '../search/retrieve';
import { tokenize } from '../text/tokenize';
import { loadConfigModule } from './config';
import { devModels, DevError, INDEX_FILES, UnknownEmbeddingModelError } from './dev';
import type { CliIO } from './main';

export const EVAL_USAGE = `Usage: ondocs eval <questions.yaml> [options]

Scores retrieval against questions whose answers you know: for each question, whether the pages
it names come first (hit@1), in the top three (hit@3) or five (hit@5), and how high on average
(MRR), and for questions marked unanswerable, whether the relevance gate refuses them (refusal
precision and recall). It runs what the endpoint runs before the model, embedding each question
as the index was, so it calls no language model. It exits 1 when a score is under its threshold,
for CI.

  questions:
    - question: How do I deploy to GitHub Pages?
      expect: /docs/deployment/github-pages      # or a list; "#anchor" to name a section
    - question: What is the capital of France?
      unanswerable: true
  thresholds: { hit@3: 0.8, refusalRecall: 1 }  # optional
  index: build/ask-index.json                    # optional
  retrieval: { minSimilarity: 0.3 }              # optional, as the handler's \`retrieval\`

Options:
      --index <file>                 The index (default: the file's \`index\`, else ask-index.json,
                                     build/ask-index.json, dist/ask-index.json, dist/client/ask-index.json,
                                     or .vitepress/dist/ask-index.json, at the root or in docs/)
      --min-hit-at-1 <n>             Thresholds from 0 to 1, over the file's
      --min-hit-at-3 <n>
      --min-hit-at-5 <n>
      --min-mrr <n>
      --min-refusal-precision <n>
      --min-refusal-recall <n>
  -c, --config <file>                The config module the index was built with (ondocs index -c):
                                     questions are embedded with its embedding (at its dimensions)
                                     or embeddingModel
      --keyword-only                 Search by keywords only, embedding nothing
      --json                         Print the report as JSON
  -h, --help                         Show this help

Questions are embedded with the config's model, else with the model the index records:
the mock model offline, OpenAI or AI Gateway with OPENAI_API_KEY or AI_GATEWAY_API_KEY, Workers
AI with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. .env and .env.local in the working
directory are loaded first.`;

const unit = z.number().min(0).max(1);

const fileSchema = z.object({
  index: z.string().optional(),
  retrieval: z
    .object({
      topK: z.number().int().positive(),
      candidates: z.number().int().positive(),
      rrfK: z.number().positive(),
      minSimilarity: z.number(),
      minKeywordCoverage: z.number(),
    })
    .partial()
    .strict()
    .optional(),
  thresholds: z
    .object({
      'hit@1': unit,
      'hit@3': unit,
      'hit@5': unit,
      mrr: unit,
      refusalPrecision: unit,
      refusalRecall: unit,
    })
    .partial()
    .strict()
    .optional(),
  questions: z
    .array(
      z.union([
        z
          .object({
            question: z.string().min(1),
            expect: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
          })
          .strict(),
        z.object({ question: z.string().min(1), unanswerable: z.literal(true) }).strict(),
      ]),
    )
    .min(1),
});

type EvalFile = z.infer<typeof fileSchema>;
type Thresholds = NonNullable<EvalFile['thresholds']>;
type Metric = keyof Thresholds;

/** One question's outcome. */
export interface EvalResult {
  question: string;
  /** The pages or sections that answer it; empty for an unanswerable question. */
  expect: string[];
  unanswerable: boolean;
  /** Whether the relevance gate refused it, so the endpoint would answer "I don't know". */
  refused: boolean;
  /** Where the first expected page came, from 1, among the distinct pages found; null if not found. */
  rank: number | null;
  /**
   * The distinct pages (or sections, where `expect` names one) found, in order: all of them, so
   * the page `rank` counts is among them (six at most, at the default `topK`).
   */
  found: string[];
  best: { similarity: number | null; keywordCoverage: number };
  /**
   * The question's words that no chunk of the index contains, as the search splits them. For a
   * refused question they say whether the docs lack its words (embeddings match meaning without
   * them) or have them too thinly (a lower `minKeywordCoverage` lets it through).
   */
  absent: string[];
}

export interface EvalReport {
  index: string;
  chunks: number;
  retrieval: 'hybrid' | 'keyword';
  results: EvalResult[];
  /**
   * Each score, its counts, and its threshold when one is set; `null` when nothing counts toward
   * it. For `mrr`, the mean of 1/rank over the answerable questions (0 when the page is not
   * found), `count` is the sum of those reciprocal ranks.
   */
  scores: Record<
    Metric,
    { value: number | null; count: number; of: number; threshold?: number; pass: boolean }
  >;
  pass: boolean;
}

class EvalError extends Error {}

/** `/docs/a/` and `/docs/a` are the same page; a URL with `#` names a section. */
const normalize = (url: string): string => {
  const [path = '', anchor] = url.split('#');
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return anchor === undefined ? clean : `${clean}#${anchor}`;
};
const pageOf = (url: string): string => normalize(url).split('#')[0] ?? '';

/**
 * The words of `question` that no chunk contains. BM25 gives a word on no chunk the highest IDF,
 * the same as the empty string's, which is never a word.
 */
function absentWords(index: LoadedIndex, question: string): string[] {
  const unseen = index.bm25.idf('');
  return [...new Set(tokenize(question))].filter((term) => index.bm25.idf(term) === unseen);
}

/** Runs the questions against `index` and scores them. */
export async function evaluate(
  file: EvalFile,
  index: LoadedIndex,
  embedQuestion: ((question: string) => Promise<number[]>) | null,
  retrieval: RetrievalOptions,
  thresholds: Thresholds,
  label: string,
): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const entry of file.questions) {
    const vector = embedQuestion ? await embedQuestion(entry.question) : null;
    const result = retrieve(index, { text: entry.question, vector }, retrieval);
    const expect =
      'expect' in entry
        ? (Array.isArray(entry.expect) ? entry.expect : [entry.expect]).map(normalize)
        : [];
    const sections = expect.some((url) => url.includes('#'));
    const found: string[] = [];
    for (const hit of result.hits) {
      const key = sections ? normalize(hit.chunk.url) : pageOf(hit.chunk.url);
      if (!found.includes(key)) found.push(key);
    }
    const position = found.findIndex((url) =>
      expect.some((wanted) => (wanted.includes('#') ? url === wanted : pageOf(url) === wanted)),
    );
    results.push({
      question: entry.question,
      expect,
      unanswerable: !('expect' in entry),
      refused: !result.answerable,
      rank: position === -1 ? null : position + 1,
      found,
      best: result.best,
      absent: absentWords(index, entry.question),
    });
  }

  const answerable = results.filter((result) => !result.unanswerable);
  const unanswerable = results.filter((result) => result.unanswerable);
  const refused = results.filter((result) => result.refused);
  const rightlyRefused = refused.filter((result) => result.unanswerable);
  const hitAt = (k: number) =>
    answerable.filter((result) => result.rank !== null && result.rank <= k).length;
  const score = (metric: Metric, count: number, of: number) => {
    const value = of === 0 ? null : count / of;
    const threshold = thresholds[metric];
    // A score with nothing to count (no refusals, no unanswerable questions) cannot fail.
    const pass = threshold === undefined || value === null || value >= threshold - 1e-9;
    return { value, count, of, ...(threshold === undefined ? {} : { threshold }), pass };
  };
  const scores = {
    'hit@1': score('hit@1', hitAt(1), answerable.length),
    'hit@3': score('hit@3', hitAt(3), answerable.length),
    'hit@5': score('hit@5', hitAt(5), answerable.length),
    mrr: score(
      'mrr',
      answerable.reduce((sum, result) => sum + (result.rank === null ? 0 : 1 / result.rank), 0),
      answerable.length,
    ),
    refusalPrecision: score('refusalPrecision', rightlyRefused.length, refused.length),
    refusalRecall: score('refusalRecall', rightlyRefused.length, unanswerable.length),
  };
  return {
    index: label,
    chunks: index.chunks.length,
    retrieval: embedQuestion ? 'hybrid' : 'keyword',
    results,
    scores,
    pass: Object.values(scores).every((entry) => entry.pass),
  };
}

function numberFlag(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new EvalError(`--${name} must be a number from 0 to 1 (got ${value}).`);
  }
  return parsed;
}

const LABELS: Record<Metric, string> = {
  'hit@1': 'hit@1',
  'hit@3': 'hit@3',
  'hit@5': 'hit@5',
  mrr: 'MRR',
  refusalPrecision: 'refusal precision',
  refusalRecall: 'refusal recall',
};

function printReport(report: EvalReport, io: CliIO): void {
  io.stdout(
    `ondocs eval: ${String(report.results.length)} questions against ${report.index} (${String(report.chunks)} chunks, ${report.retrieval === 'hybrid' ? 'hybrid' : 'keyword-only'} search)`,
  );
  io.stdout('');
  const width = Math.min(64, Math.max(...report.results.map((result) => result.question.length)));
  for (const result of report.results) {
    const question =
      result.question.length > width ? `${result.question.slice(0, width - 1)}…` : result.question;
    let mark: string;
    let detail: string;
    if (result.unanswerable) {
      mark = result.refused ? '✓ refused ' : '✗ answered';
      detail = result.refused ? '' : `→ ${result.found.join(', ')}`;
    } else if (result.refused) {
      mark = '✗ refused ';
      detail = `expected ${result.expect.join(' or ')}`;
      if (result.absent.length > 0) detail += `; not in the docs: ${result.absent.join(', ')}`;
    } else {
      // A page ranked below third still counts toward MRR, and to fifth toward hit@5, so its
      // rank shows, with every page found.
      const rank = result.rank === null ? '-' : String(result.rank);
      mark = `${result.rank !== null && result.rank <= 3 ? '✓' : '✗'} ${rank}`.padEnd(10);
      detail = result.rank === 1 ? '' : `→ ${result.found.join(', ')}`;
    }
    const signals = `cov ${result.best.keywordCoverage.toFixed(2)}${result.best.similarity === null ? '' : `, sim ${result.best.similarity.toFixed(2)}`}`;
    io.stdout(`  ${mark}  ${question.padEnd(width)}  ${signals}${detail ? `  ${detail}` : ''}`);
  }
  io.stdout('');
  for (const [metric, entry] of Object.entries(report.scores) as [
    Metric,
    EvalReport['scores'][Metric],
  ][]) {
    const value = entry.value === null ? 'n/a ' : entry.value.toFixed(2);
    const count = metric === 'mrr' ? entry.count.toFixed(2) : String(entry.count);
    const against =
      entry.threshold === undefined
        ? ''
        : `  threshold ${String(entry.threshold)} ${entry.pass ? '✓' : '✗'}`;
    io.stdout(`  ${LABELS[metric].padEnd(18)} ${value}  (${count}/${String(entry.of)})${against}`);
  }
}

/** Runs `ondocs eval`. Returns the exit code: 0 at or over every threshold, 1 under one, 2 usage. */
export async function evalCommand(args: string[], io: CliIO): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        index: { type: 'string' },
        'min-hit-at-1': { type: 'string' },
        'min-hit-at-3': { type: 'string' },
        'min-hit-at-5': { type: 'string' },
        'min-mrr': { type: 'string' },
        'min-refusal-precision': { type: 'string' },
        'min-refusal-recall': { type: 'string' },
        config: { type: 'string', short: 'c' },
        'keyword-only': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${EVAL_USAGE}`);
    return 2;
  }
  if (values.help) {
    io.stdout(EVAL_USAGE);
    return 0;
  }
  const [path, extra] = positionals;
  if (!path || extra) {
    io.stderr(EVAL_USAGE);
    return 2;
  }
  try {
    const source = resolve(io.cwd, path);
    let raw: unknown;
    try {
      raw = parseYaml(await readFile(source, 'utf8'));
    } catch (error) {
      throw new EvalError(`Could not read ${path}: ${(error as Error).message}`);
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new EvalError(
        `${path}: ${issue ? `${issue.path.join('.') || 'the file'}: ${issue.message}` : 'invalid'}. Each question needs \`expect\` (a URL or a list) or \`unanswerable: true\`.`,
      );
    }
    const file = parsed.data;
    const thresholds: Thresholds = { ...file.thresholds };
    const flags: [Metric, string][] = [
      ['hit@1', 'min-hit-at-1'],
      ['hit@3', 'min-hit-at-3'],
      ['hit@5', 'min-hit-at-5'],
      ['mrr', 'min-mrr'],
      ['refusalPrecision', 'min-refusal-precision'],
      ['refusalRecall', 'min-refusal-recall'],
    ];
    for (const [metric, flag] of flags) {
      const value = numberFlag(flag, values[flag] as string | undefined);
      if (value !== undefined) thresholds[metric] = value;
    }

    // The index: --index, the file's own (relative to the file), else where the builds write it.
    const candidates =
      typeof values.index === 'string'
        ? [resolve(io.cwd, values.index)]
        : file.index
          ? [resolve(source, '..', file.index)]
          : INDEX_FILES.map((name) => resolve(io.cwd, name));
    let indexFile = null;
    let indexPath = '';
    for (const candidate of candidates) {
      indexFile = await readIndexFile(candidate);
      if (indexFile) {
        indexPath = candidate;
        break;
      }
    }
    if (!indexFile) {
      throw new EvalError(
        `No index at ${candidates.map((candidate) => relative(io.cwd, candidate) || candidate).join(', ')}. Build one, or pass --index.`,
      );
    }
    const index = loadIndex(indexFile);

    let embedQuestion: ((question: string) => Promise<number[]>) | null = null;
    let retrieval: RetrievalOptions = {};
    if (!values['keyword-only'] && indexFile.embedding) {
      const { embedding } = indexFile;
      // The config is read only to embed questions: a keyword-only run never imports it.
      const configPath = typeof values.config === 'string' ? values.config : undefined;
      const config = configPath
        ? await loadConfigModule(configPath, io.cwd, (message) => new EvalError(message))
        : {};
      let embeddingModel: EmbeddingModel | undefined;
      let embeddingProviderOptions: EmbeddingProviderOptions | undefined;
      // What to change when the questions' vectors are not the index's size.
      let resize: string;
      /** Stops unless `id`, the config's model, is the one the index records. */
      const sameModel = (id: string) => {
        if (!sameEmbeddingModel(embedding.model, id)) {
          throw new EvalError(
            `The index was embedded with ${embedding.model}, but ${String(configPath)} embeds with ${id}. Pass the config the index was built with, or rebuild the index with this one.`,
          );
        }
      };
      if (config.embedding !== undefined) {
        // The config's model as `ondocs index -c` reads it, which puts `embedding` first: the
        // spec, at the config's `dimensions`.
        const name = `${String(configPath)}'s embedding: '${config.embedding}'`;
        let choice;
        try {
          choice = await embeddingFromSpec(config.embedding, {
            ...(config.dimensions ? { dimensions: config.dimensions } : {}),
            env: io.env,
            name,
          });
        } catch (error) {
          if (error instanceof EmbeddingSpecError) {
            throw new EvalError(`${error.message} Or pass --keyword-only.`);
          }
          throw error;
        }
        if (!choice.model) {
          throw new EvalError(
            `The index was embedded with ${embedding.model}, but ${name} builds a keyword-only index. Pass the config the index was built with, or --keyword-only.`,
          );
        }
        const id = embeddingModelId(choice.model);
        sameModel(id);
        embeddingModel = choice.model;
        embeddingProviderOptions = choice.providerOptions;
        // As `ondocs dev` serves an index the mock model embedded.
        if (/^mock-hash-\d+$/.test(id)) retrieval = { minSimilarity: MOCK_MIN_SIMILARITY };
        resize = `Set the dimensions the index was built with in ${String(configPath)}, or rebuild the index with it.`;
      } else if (config.embeddingModel) {
        // The config's AI SDK model, as `ondocs index -c` embedded the pages with it: any
        // provider, with no key here unless that provider needs one.
        sameModel(embeddingModelId(config.embeddingModel));
        embeddingModel = config.embeddingModel;
        embeddingProviderOptions = config.embeddingProviderOptions;
        resize = `Set the embeddingProviderOptions the index was built with in ${String(configPath)}, or rebuild the index with it.`;
      } else {
        let models;
        try {
          models = await devModels(indexFile, io.env);
        } catch (error) {
          if (!(error instanceof DevError)) throw error;
          // A model ondocs dev loads by its id needs its key, which no config module gives; any
          // other needs the config module that embeds with it.
          const lead = configPath
            ? `${configPath} sets neither embedding nor embeddingModel, so questions are embedded with the model the index records. `
            : '';
          const fix = !(error instanceof UnknownEmbeddingModelError)
            ? 'Or pass --keyword-only.'
            : configPath
              ? `Or set the embedding or embeddingModel the index was built with in ${configPath}, or pass --keyword-only.`
              : 'Or pass -c with the config module that embeds with it, or --keyword-only.';
          throw new EvalError(`${lead}${error.message} ${fix}`);
        }
        retrieval = models.retrieval ?? {};
        ({ embeddingModel, embeddingProviderOptions } = models);
        const sizes = '(embedding and dimensions, or embeddingModel and embeddingProviderOptions)';
        resize = configPath
          ? `Set the model and size the index was built with in ${configPath} ${sizes}, or rebuild the index.`
          : `Rebuild the index, or pass -c with a config module that sets the model and size it was built with ${sizes}.`;
      }
      if (embeddingModel) {
        const model = embeddingModel;
        embedQuestion = async (question) => {
          const vector = (
            await embed({
              model,
              value: question,
              maxRetries: 2,
              ...(embeddingProviderOptions ? { providerOptions: embeddingProviderOptions } : {}),
            })
          ).embedding;
          // Options that change the size (`dimensions`) make vectors the index cannot compare.
          if (vector.length !== embedding.dimensions) {
            throw new EvalError(
              `${configPath ?? embedding.model} embeds questions in ${String(vector.length)} dimensions, but the index was embedded in ${String(embedding.dimensions)}. ${resize}`,
            );
          }
          return vector;
        };
      }
    }
    retrieval = { ...retrieval, ...file.retrieval };

    // Inside the working directory, the path prints relative; anything else prints absolute.
    const relativePath = relative(io.cwd, indexPath);
    const label = relativePath && !relativePath.startsWith('..') ? relativePath : indexPath;
    const report = await evaluate(file, index, embedQuestion, retrieval, thresholds, label);
    if (values.json) io.stdout(JSON.stringify(report, null, 2));
    else printReport(report, io);
    if (!report.pass) {
      for (const [metric, entry] of Object.entries(report.scores) as [
        Metric,
        EvalReport['scores'][Metric],
      ][]) {
        if (!entry.pass) {
          io.stderr(
            `✗ ${LABELS[metric]} is ${String(entry.value?.toFixed(2))}, under its threshold of ${String(entry.threshold)}.`,
          );
        }
      }
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof EvalError) {
      io.stderr(`✗ ${error.message}`);
      return 2;
    }
    io.stderr(`✗ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
