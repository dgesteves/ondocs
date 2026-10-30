// @vitest-environment jsdom
// The dialog on a right-to-left page (Arabic, Hebrew, Persian), which it inherits from
// <html dir="rtl">. Code, inline code and source URLs read left to right whatever the page's
// direction: laid out right to left, "// docusaurus.config.ts" read "docusaurus.config.ts //" and a
// source's URL "docusaurus/". Text people write or the model writes takes the direction of its own
// first letters, so an English question on an Arabic page keeps its question mark at the end. The
// stylesheet places what has a side by the text's start and end, not left and right.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import { AskAnswer, AskDialog } from '../src/react';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

const read = (path: string): string => readFileSync(join(import.meta.dirname, '..', path), 'utf8');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
});

const ANSWER = [
  'Add the plugin to `docusaurus.config.ts` [1]:',
  '',
  '```ts',
  '// docusaurus.config.ts',
  "plugins: [['ondocs/docusaurus', {}]],",
  '```',
  '',
  '- Run `npm run build`.',
  '1. Then ask.',
].join('\n');

describe('an answer on a right-to-left page', () => {
  it('keeps code blocks and inline code left to right, and gives each block its own direction', () => {
    document.documentElement.dir = 'rtl';
    const { container } = render(
      <AskAnswer
        text={ANSWER}
        sources={[{ id: 1, url: '/docs/docusaurus', title: 'Docusaurus', heading: '' }]}
      />,
    );
    const pre = container.querySelector('pre.ask-pre');
    expect(pre?.getAttribute('dir')).toBe('ltr');
    expect(
      Array.from(container.querySelectorAll('p code, li code'), (code) => [
        code.textContent,
        code.getAttribute('dir'),
      ]),
    ).toEqual([
      ['docusaurus.config.ts', 'ltr'],
      ['npm run build', 'ltr'],
    ]);
    expect(
      Array.from(container.querySelectorAll('.ask-markdown > *'), (block) => [
        block.tagName,
        block.getAttribute('dir'),
      ]),
    ).toEqual([
      ['P', 'auto'],
      ['PRE', 'ltr'],
      ['UL', 'auto'],
      ['OL', 'auto'],
    ]);
  });
});

describe('the dialog on a right-to-left page', () => {
  it('reads the question, the input, the suggestions and the source URLs in their own direction', async () => {
    document.documentElement.dir = 'rtl';
    const embeddingModel = mockEmbeddingModel();
    const { index } = await buildIndex({ documents: corpus, embeddingModel });
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: 't' },
              { type: 'text-delta' as const, id: 't', delta: 'Install it with pnpm [1].' },
              { type: 'text-end' as const, id: 't' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        }),
    });
    const handler = createAskHandler({
      index,
      model,
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      rateLimit: false,
    });
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      handler(
        input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init),
      ),
    );
    const user = userEvent.setup();
    render(<AskDialog fetch={fetch} defaultOpen suggestions={['كيف أثبّته؟']} />);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    expect(input.getAttribute('dir')).toBe('auto');
    const itemText = () =>
      Array.from(dialog.querySelectorAll('.ask-item-text'), (text) => [
        text.textContent,
        text.getAttribute('dir'),
      ]);
    expect(itemText()).toEqual([['كيف أثبّته؟', 'auto']]);
    await user.type(input, 'How do I install with pnpm?');
    expect(itemText()).toEqual([['How do I install with pnpm?', 'auto']]);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    const urls = Array.from(dialog.querySelectorAll('.ask-source-url'));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.map((url) => url.getAttribute('dir'))).toEqual(urls.map(() => 'ltr'));
    // A follow-up puts the first question over its answer, in the thread.
    await user.type(input, 'And with npm?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelectorAll('.ask-turn-question')).toHaveLength(2);
    });
    expect(
      Array.from(dialog.querySelectorAll('.ask-turn-question'), (question) =>
        question.getAttribute('dir'),
      ),
    ).toEqual(['auto', 'auto']);
  });
});

/** The declarations of every rule in `source` whose selector list includes `selector`, joined. */
function rule(source: string, selector: string): string {
  const declarations: string[] = [];
  const rules = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) declarations.push(match[2] ?? '');
  }
  return declarations.join('\n');
}

describe('the stylesheets on a right-to-left page', () => {
  const css = read('src/react/styles.css');

  it('place the dialog’s sides by the text’s start and end, not left and right', () => {
    // Every margin, padding and position in the dialog's stylesheet. Docusaurus flips
    // left and right itself on its right-to-left locales (RTLCSS), but no other site does.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /(?:margin|padding)-(?:left|right)\s*:|(?:^|[\s;{])(?:left|right)\s*:(?!\s*50%)/m,
    );
    expect(rule(css, '.ask-markdown ul')).toMatch(/padding-inline-start:\s*1\.25em;/);
    expect(rule(css, '.ask-source')).toMatch(/padding-inline:\s*8px 12px;/);
    expect(rule(read('src/embed/launcher.css'), '.ondocs-launcher')).toMatch(
      /inset-inline-end:\s*max\(1rem, env\(safe-area-inset-right\)\);/,
    );
  });

  it('draws the selected suggestion’s bar on the right on a right-to-left page', () => {
    expect(rule(css, ".ask-item[data-selected='true']")).toMatch(
      /box-shadow:\s*inset 2px 0 0 var\(--ask-accent\);/,
    );
    // Docusaurus's RTLCSS would flip it back: the directive keeps it.
    expect(css).toMatch(
      /\.ask-item\[data-selected='true'\]:dir\(rtl\) \{\s*\/\* rtl:ignore \*\/\s*box-shadow: inset -2px 0 0 var\(--ask-accent\);/,
    );
  });
});
