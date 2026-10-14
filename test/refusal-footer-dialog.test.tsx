// @vitest-environment jsdom
// The footer when no sources are shown: after a refusal, from the gate or the model, an answer
// that cites none, or an error. "Check the sources" would point at nothing there, so the footer
// drops it, and says it again once an answer shows sources. Requests go to a real handler.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskDialog, DEFAULT_LABELS, type AskDialogProps } from '../src/react';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

/** A model that answers with `text` in one piece. */
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
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });
}

/** A fetch that routes to a real handler, with the scripted mock model unless one is given. */
function handlerFetch(
  model?: MockLanguageModelV4,
  overrides: Partial<Parameters<typeof createAskHandler>[0]> = {},
) {
  const handler = createAskHandler({
    index,
    model: model ?? mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    ...overrides,
  });
  return vi.fn((input: string | URL | Request, init?: RequestInit) =>
    handler(
      input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init),
    ),
  );
}

beforeAll(() => {
  // jsdom lacks these; cmdk and Radix call them.
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
});

/** Opens the dialog, asks `question`, and waits for the answer to end as `status`. */
async function ask(
  question: string,
  props: Partial<AskDialogProps> = {},
  status: 'done' | 'error' = 'done',
) {
  const user = userEvent.setup();
  render(<AskDialog fetch={handlerFetch()} defaultOpen {...props} />);
  const dialog = await screen.findByRole('dialog');
  const footer = () => dialog.querySelector('.ask-footer')?.textContent ?? '';
  const before = footer();
  await user.type(within(dialog).getByRole('combobox'), `${question}{Enter}`);
  await waitFor(() => {
    expect(dialog.querySelector(`[data-status="${status}"]`)).not.toBeNull();
  });
  const sources = within(dialog).queryByRole('navigation', { name: 'Sources' }) !== null;
  return { user, dialog, footer, before, sources };
}

describe('the footer', () => {
  it('asks to check the sources under an answer that shows them', async () => {
    const { footer, before, sources } = await ask('How is an int8 vector scaled?');
    expect(before).toContain(DEFAULT_LABELS.footer);
    expect(sources).toBe(true);
    expect(footer()).toContain(DEFAULT_LABELS.footer);
  });

  it('does not ask to check the sources after the gate refuses, and does once they show again', async () => {
    const { user, dialog, footer, sources } = await ask('Who won the 1998 World Cup final?');
    expect(dialog.querySelector('[data-refused]')).not.toBeNull();
    expect(sources).toBe(false);
    expect(footer()).not.toContain('Check the sources');
    expect(footer()).toContain(DEFAULT_LABELS.footerNoSources);

    // A new question puts the footer back as it was, and an answer with sources keeps it.
    await user.click(within(dialog).getByRole('button', { name: 'New question' }));
    expect(footer()).toContain(DEFAULT_LABELS.footer);
    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    expect(within(dialog).getByRole('navigation', { name: 'Sources' })).toBeTruthy();
    expect(footer()).toContain(DEFAULT_LABELS.footer);
  });

  it('does not ask to check the sources after the model says "I don\'t know"', async () => {
    const { dialog, footer, sources } = await ask('How is an int8 vector scaled?', {
      fetch: handlerFetch(answering("I don't know.")),
    });
    expect(dialog.querySelector('[data-refused]')).not.toBeNull();
    expect(sources).toBe(false);
    expect(footer()).not.toContain('Check the sources');
    expect(footer()).toContain(DEFAULT_LABELS.footerNoSources);
  });

  it('does not ask to check the sources under an answer that cites none', async () => {
    const { dialog, footer, sources } = await ask('How is an int8 vector scaled?', {
      fetch: handlerFetch(answering('The sources say nothing about how it is scaled.')),
    });
    expect(dialog.querySelector('[data-refused]')).toBeNull();
    expect(sources).toBe(false);
    expect(footer()).not.toContain('Check the sources');
    expect(footer()).toContain(DEFAULT_LABELS.footerNoSources);
  });

  it.each([
    [
      'a rate limit',
      () => handlerFetch(undefined, { rateLimit: () => ({ success: false, reset: Date.now() }) }),
      'Too many questions. Try again shortly.',
    ],
    [
      'the day’s budget running out',
      // A store that has already counted the day's one question.
      () =>
        handlerFetch(undefined, { budget: { requestsPerDay: 1, store: { increment: () => 2 } } }),
      'The assistant has reached its daily limit. Please try again later.',
    ],
    [
      'a network failure',
      () => vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
      DEFAULT_LABELS.errorNetwork,
    ],
  ])('does not ask to check the sources after %s', async (_, fetch, message) => {
    const { dialog, footer, sources } = await ask(
      'How is an int8 vector scaled?',
      { fetch: fetch() },
      'error',
    );
    expect(within(dialog).getByRole('alert').textContent).toContain(message);
    expect(sources).toBe(false);
    expect(footer()).not.toContain('Check the sources');
    expect(footer()).toContain(DEFAULT_LABELS.footerNoSources);
  });

  it('asks to check the sources after an error that comes once they show', async () => {
    const broken = new MockLanguageModelV4({
      doStream: () => Promise.reject(new Error('provider down')),
    });
    const { dialog, footer, sources } = await ask(
      'How is an int8 vector scaled?',
      { fetch: handlerFetch(broken, { onError: vi.fn() }) },
      'error',
    );
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect(sources).toBe(true);
    expect(footer()).toContain(DEFAULT_LABELS.footer);
  });

  it('takes its words from footerNoSources, or from a given footer without it', async () => {
    const refusal = 'Who won the 1998 World Cup final?';
    const labelled = await ask(refusal, {
      labels: { footer: 'Vérifiez les sources.', footerNoSources: 'Rien trouvé.' },
    });
    expect(labelled.before).toContain('Vérifiez les sources.');
    expect(labelled.footer()).toContain('Rien trouvé.');
    expect(labelled.footer()).not.toContain('Vérifiez les sources.');
    cleanup();

    // A site that gave its own footer and nothing for this keeps its own words, not English.
    const own = await ask(refusal, { labels: { footer: 'Vérifiez les sources.' } });
    expect(own.footer()).toContain('Vérifiez les sources.');
    expect(own.footer()).not.toContain(DEFAULT_LABELS.footerNoSources);
  });

  it('is left alone when the site gives its own', async () => {
    const { dialog } = await ask('Who won the 1998 World Cup final?', {
      footer: <p className="site-footer">Our own footer.</p>,
    });
    expect(dialog.querySelector('.ask-footer')).toBeNull();
    expect(dialog.querySelector('.site-footer')?.textContent).toBe('Our own footer.');
  });
});
