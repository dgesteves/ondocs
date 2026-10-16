// @vitest-environment jsdom
// An endpoint that cannot answer as it is set up: its model has no key, or its index does not
// match it. Retrying cannot fix that, so the dialog says answers aren't set up, offers no Retry,
// and, in development, points at the endpoint's log. Requests go to a real handler.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createOpenAI } from '@ai-sdk/openai';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { buildEmbedding } from '../src/integration/build';
import { mockEmbeddingModel } from '../src/mock';
import { AskDialog, DEFAULT_LABELS, useAsk, type AskDialogProps } from '../src/react';
import { createAskHandler, type AskHandlerOptions } from '../src/server';
import { corpus } from './helpers';

const { index: keywordOnly } = await buildIndex({ documents: corpus, embeddingModel: null });
const { index: mockIndex } = await buildIndex({
  documents: corpus,
  embeddingModel: mockEmbeddingModel(),
});

const QUESTION = 'How do I install with pnpm?';

/** OpenAI as the endpoints `init` writes use it, with no key set: it never reaches the network. */
function openaiWithoutKey() {
  vi.stubEnv('OPENAI_API_KEY', undefined);
  return createOpenAI({ fetch: () => Promise.reject(new Error('no network in this test')) });
}

/** A fetch that routes to a handler as `init` writes it, over `index`, with its errors kept. */
function endpoint(index: AskHandlerOptions['index'], model?: AskHandlerOptions['model']) {
  const openai = openaiWithoutKey();
  const onError = vi.fn();
  const handler = createAskHandler({
    index,
    model: model ?? openai('gpt-5.4-mini'),
    embeddingModel: openai.embedding('text-embedding-3-small'),
    rateLimit: false,
    onError,
  });
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    handler(
      input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init),
    ),
  );
  return { fetch, onError };
}

const CASES = [
  // A plugin build without a key, deployed with no key in the function: the sources, then the
  // model fails.
  ['the model has no key', () => endpoint(keywordOnly)],
  // Built with `embedding: 'mock'`, deployed with the function init writes: a 500.
  ['the index was embedded with another model', () => endpoint(mockIndex)],
] as const;

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
  vi.unstubAllEnvs();
});

/** Opens the dialog, asks the question, and waits for the error. */
async function ask(props: Partial<AskDialogProps>) {
  const user = userEvent.setup();
  render(<AskDialog defaultOpen {...props} />);
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByRole('combobox'), `${QUESTION}{Enter}`);
  await waitFor(() => {
    expect(dialog.querySelector('[data-status="error"]')).not.toBeNull();
  });
  return dialog;
}

describe('a misconfigured endpoint', () => {
  it.each(CASES)('shows that answers aren’t set up, without a Retry: %s', async (_, make) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch, onError } = make();
    const dialog = await ask({ fetch });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Answers aren’t set up on this site yet.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'New question' })).toBeTruthy();
    // The endpoint's log has the cause.
    expect(onError).toHaveBeenCalled();
  });

  it('keeps the Retry for a failure that may pass', async () => {
    const down = new MockLanguageModelV4({
      doStream: () => Promise.reject(new Error('socket hang up')),
    });
    const dialog = await ask({ fetch: endpoint(keywordOnly, down).fetch });
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'The answer could not be generated. Please try again.',
    );
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('takes its words from errorMisconfigured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dialog = await ask({
      fetch: endpoint(keywordOnly).fetch,
      labels: { errorMisconfigured: 'Les réponses ne sont pas encore en place.' },
    });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Les réponses ne sont pas encore en place.',
    );
  });

  it.each(CASES)('is an error useAsk names `misconfigured`: %s', async (_, make) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useAsk({ fetch: make().fetch }));
    await act(() => result.current.ask(QUESTION));
    expect(result.current.status).toBe('error');
    expect(result.current.error?.reason).toBe('misconfigured');
  });

  it.each(CASES)(
    'points at the endpoint’s log in the console while you develop: %s',
    async (_, make) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { result } = renderHook(() => useAsk({ fetch: make().fetch }));
      await act(() => result.current.ask(QUESTION));
      // jsdom's page is http://localhost:3000/, a page served from this machine.
      expect(warn.mock.calls).toEqual([
        [
          '[ondocs] The ask endpoint at http://localhost:3000/api/ask cannot answer as it is set up, and asking again will not help. Its log says why, such as a missing OPENAI_API_KEY or an index embedded with another model. See https://ondocs.vercel.app/docs/troubleshooting#answers-arent-set-up-on-this-site-yet.',
        ],
      ]);
    },
  );

  it('points at the endpoint’s log for an answer the model failed to write, too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const down = new MockLanguageModelV4({
      doStream: () => Promise.reject(new Error('socket hang up')),
    });
    const { result } = renderHook(() => useAsk({ fetch: endpoint(keywordOnly, down).fetch }));
    await act(() => result.current.ask(QUESTION));
    expect(result.current.error?.reason).toBe('server');
    expect(warn.mock.calls).toEqual([
      [
        '[ondocs] The ask endpoint at http://localhost:3000/api/ask could not write the answer. Its log says why. See https://ondocs.vercel.app/docs/troubleshooting#the-answer-could-not-be-generated.',
      ],
    ]);
  });

  it('is in Troubleshooting under what the dialog shows', () => {
    const page = readFileSync(
      join(import.meta.dirname, '../examples/nextjs/content/docs/troubleshooting.md'),
      'utf8',
    );
    expect(page).toContain("\n## Answers aren't set up on this site yet\n");
    expect(page).toContain(`\`${DEFAULT_LABELS.errorMisconfigured}\``);
  });
});

describe('the console’s hint for a 404', () => {
  it('says to start the site with ASK_ENDPOINT, and links to Deploying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing = () => Promise.resolve(new Response('Not found', { status: 404 }));
    const { result } = renderHook(() => useAsk({ fetch: missing }));
    await act(() => result.current.ask(QUESTION));
    expect(warn.mock.calls).toEqual([
      [
        '[ondocs] POST http://localhost:3000/api/ask returned 404: no ask endpoint answers there. While you develop, run `npx ondocs dev` and start the site with ASK_ENDPOINT=http://localhost:8787/api/ask; with React, pass that address as `endpoint`, and with the script tag as `data-endpoint`. To deploy one, see https://ondocs.vercel.app/docs/deployment.',
      ],
    ]);
  });
});

describe('a build with mock embeddings', () => {
  it('says the index is for local testing, which the endpoint init writes refuses', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    await buildEmbedding({ embedding: 'mock' }, { info, warn });
    expect(info.mock.calls).toEqual([
      [
        "embedding: 'mock' is for local testing only: the endpoints init writes embed questions with OpenAI's text-embedding-3-small, so they refuse this index and answer every question with a 500. Remove it before you deploy.",
      ],
    ]);
    expect(warn).not.toHaveBeenCalled();

    const quiet = vi.fn();
    await buildEmbedding({ embedding: 'none' }, { info: quiet, warn: quiet });
    expect(quiet).not.toHaveBeenCalled();
  });
});
