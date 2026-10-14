// @vitest-environment jsdom
// The keyboard on the dialog's answer. The command palette around it takes Enter, the arrow keys,
// Home and End for its list, and cancels them wherever they are pressed, so Enter on a citation,
// a source, a link in the answer or one of its buttons did nothing, and the arrow keys did not
// scroll the answer. Requests go to a real handler, with a model that answers in one piece.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskDialog } from '../src/react';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

const ANSWER = 'Install it with pnpm, as [the install guide](/docs/install) says. [1]';

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

function handlerFetch(
  overrides: Parameters<typeof createAskHandler>[0] extends infer O ? Partial<O> : never = {},
) {
  const handler = createAskHandler({
    index,
    model: answering(ANSWER),
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

/** The dialog with an answer on screen: the panel, its live region and what was navigated to. */
async function answered(onFeedback?: () => void) {
  const user = userEvent.setup();
  const onNavigate = vi.fn((_url: string, event: { preventDefault: () => void }) => {
    event.preventDefault();
  });
  render(
    <AskDialog
      fetch={handlerFetch(onFeedback ? { onFeedback } : {})}
      onNavigate={onNavigate}
      defaultOpen
    />,
  );
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByRole('combobox'), 'How do I install with pnpm?{Enter}');
  const answer = await waitFor(() => {
    const region = dialog.querySelector('[aria-live="polite"]');
    expect(region?.getAttribute('data-status')).toBe('done');
    return region as HTMLElement;
  });
  const panel = dialog.querySelector<HTMLElement>('.ask-panel')!;
  return { user, dialog, answer, panel, onNavigate };
}

async function closed(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

describe('Enter in the answer', () => {
  it('follows a citation', async () => {
    const { user, answer, onNavigate } = await answered();
    const citation = within(answer).getByRole('link', { name: /^Source 1:/ });
    citation.focus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith(citation.getAttribute('href'), expect.anything());
    await closed();
  });

  it('follows a link in the answer', async () => {
    const { user, answer, onNavigate } = await answered();
    within(answer).getByRole('link', { name: 'the install guide' }).focus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('/docs/install', expect.anything());
    await closed();
  });

  it('follows a source', async () => {
    const { user, dialog, onNavigate } = await answered();
    const sources = within(dialog).getByRole('navigation', { name: 'Sources' });
    const source = within(sources).getAllByRole('link')[0]!;
    source.focus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith(source.getAttribute('href'), expect.anything());
    await closed();
  });

  it('rates the answer, and opens the comment field', async () => {
    const onFeedback = vi.fn();
    const { user, dialog } = await answered(onFeedback);
    within(dialog).getByRole('button', { name: 'Yes, it helped' }).focus();
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText('Thanks for the feedback.')).toBeTruthy();
    expect(onFeedback).toHaveBeenCalledWith(expect.objectContaining({ rating: 'up' }));

    within(dialog).getByRole('button', { name: 'Add a comment' }).focus();
    await user.keyboard('{Enter}');
    expect(within(dialog).getByRole('textbox', { name: 'Comment' })).toBeTruthy();
  });

  it('starts a new question', async () => {
    const { user, dialog } = await answered();
    within(dialog).getByRole('button', { name: 'New question' }).focus();
    await user.keyboard('{Enter}');
    const input = within(dialog).getByRole<HTMLInputElement>('combobox');
    expect(dialog.querySelector('.ask-panel')).toBeNull();
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('retries after an error', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<AskDialog fetch={fetch} defaultOpen />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    await within(dialog).findByRole('alert');
    expect(fetch).toHaveBeenCalledTimes(1);
    within(dialog).getByRole('button', { name: 'Retry' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('stops an answer that is still coming', async () => {
    const user = userEvent.setup();
    const slow = mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 5_000 });
    render(<AskDialog fetch={handlerFetch({ model: slow })} defaultOpen />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    (await within(dialog).findByRole('button', { name: 'Stop' })).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull();
    });
  });
});

describe('other keys in the answer', () => {
  it('leaves the arrow keys, Home and End to the answer, so they scroll it', async () => {
    const { dialog, answer, panel } = await answered();
    const citation = within(answer).getByRole('link', { name: /^Source 1:/ });
    for (const target of [citation, panel]) {
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
        // fireEvent returns false when a listener cancelled the key's default action.
        expect(fireEvent.keyDown(target, { key }), `${key} on ${target.className}`).toBe(true);
      }
    }

    // In the input, they still move through the list.
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'And with npm?' } });
    await within(dialog).findByRole('option', { name: /And with npm\?/ });
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
  });

  it('still closes the dialog on Escape', async () => {
    const { user, answer } = await answered();
    within(answer)
      .getByRole('link', { name: /^Source 1:/ })
      .focus();
    await user.keyboard('{Escape}');
    await closed();
  });
});
