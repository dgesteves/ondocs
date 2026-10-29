// The quality loop: `ondocs eval` scoring retrieval against known answers, and the handler's
// feedback and low-confidence signals, the raw material of an "unanswered questions" report, and
// what the default instructions ask of an answer.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { main } from '../src/cli/main';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { writeIndexFile } from '../src/node';
import { createAskHandler, memoryRateLimit, type AskHandlerOptions } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();

describe('ondocs eval', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ondocs-eval-'));
    const { index } = await buildIndex({ documents: corpus, embeddingModel });
    await writeIndexFile(join(cwd, 'ask-index.json'), index);
    const { index: keywords } = await buildIndex({ documents: corpus });
    await mkdir(join(cwd, 'build'));
    await writeIndexFile(join(cwd, 'build/keywords.json'), keywords);
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function run(yaml: string, ...args: string[]) {
    await writeFile(join(cwd, 'questions.yaml'), yaml);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await main(['eval', 'questions.yaml', ...args], {
      cwd,
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }

  const QUESTIONS = `questions:
  - question: How do I rate limit with Upstash?
    expect: /docs/rate-limits/
  - question: Why is each vector stored as int8?
    expect: /docs/quantization#why-int8
  - question: Which Node.js version do I need?
    expect: [/docs/install, /docs/requirements]
  - question: What does the pricing page cost in euros per seat?
    expect: /docs/install
  - question: Who won the 1998 World Cup final?
    unanswerable: true
`;

  it('scores hit@1, hit@3 and refusals, question by question, embedding as the index was', async () => {
    const result = await run(QUESTIONS, '--json');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      retrieval: string;
      results: { question: string; rank: number | null; refused: boolean; found: string[] }[];
      scores: Record<string, { value: number | null; count: number; of: number }>;
    };
    expect(report.retrieval).toBe('hybrid');
    // The pricing question names the wrong page, and is refused: a miss, and a wrong refusal.
    expect(report.results.map((r) => [r.rank, r.refused])).toEqual([
      [1, false],
      [2, false],
      [1, false],
      [null, true],
      [null, true],
    ]);
    // A section is matched as a section: the int8 one comes second, after the page's top.
    expect(report.results[1]?.found.slice(0, 2)).toEqual([
      '/docs/quantization',
      '/docs/quantization#why-int8',
    ]);
    expect(report.scores['hit@1']).toEqual({ value: 0.5, count: 2, of: 4, pass: true });
    expect(report.scores['hit@3']).toEqual({ value: 0.75, count: 3, of: 4, pass: true });
    expect(report.scores.refusalRecall).toMatchObject({ value: 1, count: 1, of: 1 });
    expect(report.scores.refusalPrecision).toMatchObject({ value: 0.5, count: 1, of: 2 });
  });

  it('prints each question and the scores, and fails under a threshold, for CI', async () => {
    const result = await run(`thresholds: { hit@1: 0.9, refusalRecall: 1 }\n${QUESTIONS}`);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'ondocs eval: 5 questions against ask-index.json (9 chunks, hybrid search)',
    );
    expect(result.stdout).toMatch(/✓ 1 +How do I rate limit with Upstash\?/);
    expect(result.stdout).toMatch(/✓ refused +Who won the 1998 World Cup final\?/);
    expect(result.stdout).toMatch(/hit@1 +0\.50 +\(2\/4\) +threshold 0\.9 ✗/);
    expect(result.stdout).toMatch(/refusal recall +1\.00 +\(1\/1\) +threshold 1 ✓/);
    expect(result.stderr).toBe('✗ hit@1 is 0.50, under its threshold of 0.9.');
    // A flag overrides the file's threshold.
    expect(
      (await run(`thresholds: { hit@1: 0.9 }\n${QUESTIONS}`, '--min-hit-at-1', '0.5')).code,
    ).toBe(0);
  });

  it('searches by keywords with --keyword-only, or for a keyword-only index', async () => {
    const keywordOnly = await run(QUESTIONS, '--keyword-only', '--json');
    expect((JSON.parse(keywordOnly.stdout) as { retrieval: string }).retrieval).toBe('keyword');
    const fromFile = await run(`index: build/keywords.json\n${QUESTIONS}`, '--json');
    expect(JSON.parse(fromFile.stdout) as { index: string; retrieval: string }).toMatchObject({
      index: join('build', 'keywords.json'),
      retrieval: 'keyword',
    });
  });

  it('takes the handler’s retrieval settings from the file', async () => {
    const strict = await run(
      `retrieval: { minKeywordCoverage: 1, minSimilarity: 0.99 }\n${QUESTIONS}`,
      '--json',
    );
    const report = JSON.parse(strict.stdout) as { results: { refused: boolean }[] };
    expect(report.results.filter((r) => r.refused).length).toBeGreaterThan(1);
  });

  it('says what is wrong with the file, the index or a flag', async () => {
    const noExpect = await run('questions:\n  - question: How?\n');
    expect(noExpect.code).toBe(2);
    expect(noExpect.stderr).toContain(
      'Each question needs `expect` (a URL or a list) or `unanswerable: true`.',
    );
    const noIndex = await run(QUESTIONS, '--index', 'missing.json');
    expect(noIndex.code).toBe(2);
    expect(noIndex.stderr).toContain('No index at missing.json');
    expect((await run(QUESTIONS, '--min-hit-at-3', '2')).stderr).toContain(
      '--min-hit-at-3 must be a number from 0 to 1',
    );
    const missing = await main(['eval', 'none.yaml'], {
      cwd,
      env: {},
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(missing).toBe(2);
  });

  it('reads the sample file of docusaurus.io’s questions', async () => {
    const result = await main(
      [
        'eval',
        join(import.meta.dirname, 'eval/docusaurus.io.yaml'),
        '--index',
        'ask-index.json',
        '--json',
      ],
      {
        cwd,
        env: {},
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );
    // This repo's tiny corpus is not docusaurus.io: the file parses, and the scores fail.
    expect(result).toBe(1);
  });
});

/** A model that answers with the given text, citing or not. */
function answering(text: string) {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            { type: 'text-delta' as const, id: 't', delta: text },
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });
}

const { index } = await buildIndex({ documents: corpus, embeddingModel });

function handlerWith(overrides: Partial<AskHandlerOptions> = {}) {
  const onFinish = vi.fn();
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    onFinish,
    onError: () => undefined,
    ...overrides,
  });
  return { handler, onFinish };
}

const post = (body: unknown) =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });

const RATING = {
  feedback: {
    rating: 'down',
    comment: '  It did not say which plan.  ',
    id: 'answer-1',
    question: 'What does it cost?',
    answer: 'It is free [1].',
    sources: ['/pricing'],
  },
};

describe('feedback', () => {
  it('is offered in the stream only when the endpoint takes it, with the answer’s id', async () => {
    const onFeedback = vi.fn();
    const { handler, onFinish } = handlerWith({ onFeedback });
    const stream = await (await handler(post({ question: 'What does it cost?' }))).text();
    const start = JSON.parse(stream.split('\n')[0]?.replace(/^data: /, '') ?? '{}') as {
      messageId: string;
      messageMetadata: { feedback?: boolean };
    };
    expect(start.messageMetadata.feedback).toBe(true);
    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalled();
    });
    expect((onFinish.mock.calls[0]?.[0] as { id: string }).id).toBe(start.messageId);

    const without = handlerWith();
    const plain = await (await without.handler(post({ question: 'What does it cost?' }))).text();
    expect(plain).not.toContain('"feedback"');
  });

  it('is handed to onFeedback, and kept nowhere else', async () => {
    const onFeedback = vi.fn();
    const { handler } = handlerWith({ onFeedback });
    const response = await handler(post(RATING));
    expect(response.status).toBe(204);
    expect(onFeedback).toHaveBeenCalledWith({
      rating: 'down',
      comment: 'It did not say which plan.',
      id: 'answer-1',
      question: 'What does it cost?',
      answer: 'It is free [1].',
      sources: ['/pricing'],
    });
  });

  it('is turned away without onFeedback, when malformed, and when onFeedback fails', async () => {
    expect((await handlerWith().handler(post(RATING))).status).toBe(400);
    const { handler } = handlerWith({ onFeedback: vi.fn() });
    expect(
      (await handler(post({ feedback: { rating: 'meh', question: 'x', answer: '' } }))).status,
    ).toBe(400);
    expect(
      (await handler(post({ feedback: { ...RATING.feedback, comment: 'x'.repeat(1001) } }))).status,
    ).toBe(400);
    const failing = handlerWith({
      onFeedback: () => {
        throw new Error('webhook down');
      },
    });
    expect((await failing.handler(post(RATING))).status).toBe(503);
  });

  it('counts against the rate limit, as questions do', async () => {
    const { handler } = handlerWith({
      onFeedback: vi.fn(),
      rateLimit: memoryRateLimit({ limit: 1, windowMs: 60_000 }),
    });
    expect((await handler(post(RATING))).status).toBe(204);
    expect((await handler(post(RATING))).status).toBe(429);
  });
});

describe('lowConfidence', () => {
  const ask = async (model: MockLanguageModelV4 | null, question: string) => {
    const { handler, onFinish } = handlerWith(model ? { model } : {});
    await (await handler(post({ question }))).text();
    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalled();
    });
    return onFinish.mock.calls[0]?.[0] as { refused: boolean; lowConfidence: boolean };
  };

  it('marks an answer that cites none of its sources', async () => {
    expect(
      await ask(answering('The sources do not say.'), 'How is an int8 vector scaled?'),
    ).toMatchObject({
      refused: false,
      lowConfidence: true,
    });
    expect(
      await ask(answering('It is scaled to 127 [1].'), 'How is an int8 vector scaled?'),
    ).toMatchObject({
      refused: false,
      lowConfidence: false,
    });
    // A citation to a source it was not given does not count.
    expect(
      await ask(answering('It is scaled to 127 [9].'), 'How is an int8 vector scaled?'),
    ).toMatchObject({
      lowConfidence: true,
    });
  });

  it('is false for a refusal, which says so itself', async () => {
    expect(await ask(null, 'Who won the 1998 World Cup final?')).toMatchObject({
      refused: true,
      lowConfidence: false,
    });
  });
});

describe('the answer prompt', () => {
  // Seven questions asked of the live sites in October 2026 (blind labels by an AI reviewer): all
  // grounded and cited, and three left out the command, option or name the reader came for,
  // under a rule that asked only for brevity.
  const rules = async () => {
    const model = answering('Use `upstashRateLimit()` [1].');
    const { handler } = handlerWith({ model });
    await (await handler(post({ question: 'How do I rate limit with Upstash?' }))).text();
    const system = model.doStreamCalls[0]?.prompt.find((message) => message.role === 'system');
    return typeof system?.content === 'string' ? system.content : '';
  };

  it('asks a how-to answer for the exact command, option or config line, as code', async () => {
    // In the brevity rule itself, so that being short never reads as leaving the step out.
    const concise = /^4\. Be concise:.*$/m.exec(await rules())?.[0] ?? '';
    expect(concise).toContain(
      'For a how-to question, when the sources give the command, option or config line, quote it exactly, as code',
    );
    expect(concise).toContain('concise never means leaving out the step');
    // One answer never named the lint rule it was about; another gave AI SDK 7's option and left
    // out AI SDK 6's, which the same page gives.
    expect(concise).toContain('name the component, rule or function they say it uses');
    // Only what the sources show, and every setup only when the question names none.
    expect(concise).toContain('Never write a command, option or name the sources do not show.');
    expect(concise).toContain(
      'If the question does not say which version or setup and the sources give the step for several, give each.',
    );
  });

  it('keeps five numbered rules, so `(defaults) => defaults + "\\n6. …"` still reads in order', async () => {
    expect((await rules()).match(/^\d+\. /gm)).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ']);
  });
});
