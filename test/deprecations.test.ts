// The options renamed in 0.9, one name per concept: each old name still works, does what its new
// name does, and says once what it is called now. The dialog's are in deprecations-dialog.test.tsx.
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { main } from '../src/cli/main';
import { REMOVED_IN, resetDeprecationWarnings, warnDeprecated } from '../src/deprecation';
import ondocs from '../src/docusaurus';
import { launcherScript, type LauncherDialogOptions } from '../src/integration';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import { createAskHandler, type AnswerCacheStore, type AskHandlerOptions } from '../src/server';
import { corpus } from './helpers';

beforeEach(() => {
  resetDeprecationWarnings();
});

/** The warning an old name gives, as `warnDeprecated` words it. */
const warning = (old: string, current: string): string =>
  `[ondocs] ${old} is now ${current}. The old name still works until ${REMOVED_IN}.`;

describe('warnDeprecated', () => {
  it('says once per old name what it is called now', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnDeprecated('buttonLabel', 'launcher');
    warnDeprecated('buttonLabel', 'launcher');
    warnDeprecated('maxContextChars', 'retrieval.maxContextChars');
    expect(warn.mock.calls).toEqual([
      [warning('buttonLabel', 'launcher')],
      [warning('maxContextChars', 'retrieval.maxContextChars')],
    ]);
    expect(REMOVED_IN).toBe('0.10');
  });
});

describe('createAskHandler: maxContextChars is now retrieval.maxContextChars', () => {
  const embeddingModel = mockEmbeddingModel();
  const indexed = buildIndex({ documents: corpus, embeddingModel });

  function model() {
    return new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: 't' },
              { type: 'text-delta' as const, id: 't', delta: 'Stored as int8 [1].' },
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

  /** What one question sends the model, and the cache key it is kept under. */
  async function ask(options: Partial<AskHandlerOptions>) {
    const keys: string[] = [];
    const store: AnswerCacheStore = {
      get: (key) => (keys.push(key), null),
      set: () => undefined,
    };
    const language = model();
    const handler = createAskHandler({
      index: (await indexed).index,
      model: language,
      embeddingModel,
      rateLimit: false,
      answerCache: { store },
      ...options,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY, ...options.retrieval },
    });
    const response = await handler(
      new Request('http://localhost/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'How are int8 vectors stored?' }),
      }),
    );
    const stream = await response.text();
    const sources = [...stream.matchAll(/"type":"source-url"/g)].length;
    // Without the delimiters' random suffix, which changes with every question.
    const prompt = JSON.stringify(language.doStreamCalls[0]?.prompt).replace(/-[\da-f]{16}\b/g, '');
    return { sources, prompt, key: keys[0] };
  }

  it('sends the model as much source text with the old name as with the new, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const roomy = await ask({});
    const tight = await ask({ retrieval: { maxContextChars: 50 } });
    expect(warn).not.toHaveBeenCalled();
    // A tight budget leaves sources out.
    expect(tight.sources).toBeLessThan(roomy.sources);
    expect(tight.sources).toBe(1);

    // The name before 0.9, twice: it warns once.
    const old = await ask({ maxContextChars: 50 });
    await ask({ maxContextChars: 50 });
    expect([old.sources, old.prompt]).toEqual([tight.sources, tight.prompt]);
    expect(warn.mock.calls).toEqual([[warning('maxContextChars', 'retrieval.maxContextChars')]]);
  });

  it('keeps the answer cache’s keys, so moving the option starts no fresh cache', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const old = await ask({ maxContextChars: 50 });
    const moved = await ask({ retrieval: { maxContextChars: 50 } });
    expect(moved.key).toBe(old.key);
    // With other retrieval settings, too.
    const oldTuned = await ask({
      maxContextChars: 50,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY, topK: 4 },
    });
    const movedTuned = await ask({
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY, topK: 4, maxContextChars: 50 },
    });
    expect(movedTuned.key).toBe(oldTuned.key);
    expect(movedTuned.key).not.toBe(moved.key);
    // The new name wins over the old one.
    const both = await ask({
      maxContextChars: 8000,
      retrieval: { maxContextChars: 50 },
    });
    expect(both.sources).toBe(1);
  });
});

describe('the plugins’ dialog: buttonLabel is now launcher', () => {
  it('mounts the same launcher from launcherScript, in each locale, and warns once for each', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const script = (dialog: LauncherDialogOptions) =>
      launcherScript({ endpoint: '/api/ask', dialog, title: 'Ask Acme', locales: ['fr'] });
    const current = script({ launcher: 'Ask', locales: { fr: { launcher: false } } });
    expect(warn).not.toHaveBeenCalled();
    // The names before 0.9, twice: each warns once.
    expect(script({ buttonLabel: 'Ask', locales: { fr: { buttonLabel: false } } })).toBe(current);
    expect(script({ buttonLabel: 'Ask', locales: { fr: { buttonLabel: false } } })).toBe(current);
    // `launcher` wins when both are given.
    expect(
      script({ launcher: 'Ask', buttonLabel: 'Old', locales: { fr: { launcher: false } } }),
    ).toBe(current);
    expect(current).toContain('"launcher":"Ask"');
    expect(current).not.toContain('buttonLabel');
    expect(warn.mock.calls).toEqual([
      [warning('dialog.buttonLabel', 'dialog.launcher')],
      [warning('dialog.locales.fr.buttonLabel', 'dialog.locales.fr.launcher')],
    ]);
  });

  it('gives the Docusaurus theme the same options, and says so while the site builds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const siteDir = await mkdtemp(join(tmpdir(), 'ondocs-deprecations-'));
    try {
      const data = (dialog: Record<string, unknown>, currentLocale = 'en') => {
        const setGlobalData = vi.fn();
        ondocs(
          {
            siteDir,
            siteConfig: { title: 'Acme Docs' },
            baseUrl: '/',
            i18n: { currentLocale, defaultLocale: 'en' },
          },
          { dialog },
        ).contentLoaded({ actions: { setGlobalData } });
        return setGlobalData.mock.calls[0]?.[0] as unknown;
      };
      const current = data({ launcher: 'Ask', locales: { fr: { launcher: false } } }, 'fr');
      expect(warn).not.toHaveBeenCalled();
      expect(data({ buttonLabel: 'Ask', locales: { fr: { buttonLabel: false } } }, 'fr')).toEqual(
        current,
      );
      expect(current).toMatchObject({ dialog: { launcher: false }, locale: 'fr' });
      expect(data({ buttonLabel: 'Ask' })).toEqual(data({ launcher: 'Ask' }));
      // The same words as everywhere else, once per option however often Docusaurus reloads.
      expect(warn.mock.calls).toEqual([
        [warning('dialog.buttonLabel', 'dialog.launcher')],
        [warning('dialog.locales.fr.buttonLabel', 'dialog.locales.fr.launcher')],
      ]);
    } finally {
      await rm(siteDir, { recursive: true, force: true });
    }
  });
});

describe('ondocs init: --name is now --site-name', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ondocs-init-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function files(dir = cwd): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) Object.assign(out, await files(path));
      else out[relative(cwd, path)] = await readFile(path, 'utf8');
    }
    return out;
  }

  async function init(...args: string[]) {
    await rm(cwd, { recursive: true, force: true });
    cwd = await mkdtemp(join(tmpdir(), 'ondocs-init-'));
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'acme-docs', dependencies: { '@docusaurus/core': '3' } }),
    );
    await writeFile(join(cwd, 'vercel.json'), '{}\n');
    const stderr: string[] = [];
    const code = await main(['init', ...args], {
      cwd,
      env: {},
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    });
    return { code, stderr, written: await files() };
  }

  it('writes the same endpoint with either flag, and says the new name with the old', async () => {
    const current = await init('--site-name', 'the Acme docs');
    expect(current.code).toBe(0);
    expect(current.stderr).toEqual([]);
    expect(Object.values(current.written).join('\n')).toContain("siteName: 'the Acme docs'");

    const old = await init('--name', 'the Acme docs');
    expect(old.code).toBe(0);
    expect(old.written).toEqual(current.written);
    expect(old.stderr).toEqual([
      `! --name is now --site-name. The old name still works until ${REMOVED_IN}.`,
    ]);
  });
});
