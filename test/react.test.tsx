// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskAnswer, AskDialog, citedSourceIds, useAsk } from '../src/react';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

/** A fetch that routes to a real handler with the scripted mock model: no network involved. */
function handlerFetch(
  overrides: Parameters<typeof createAskHandler>[0] extends infer O ? Partial<O> : never = {},
) {
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
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

describe('useAsk', () => {
  it('streams sources, then the answer, to done', async () => {
    const fetch = handlerFetch();
    const onFinish = vi.fn();
    const { result } = renderHook(() => useAsk({ fetch, onFinish }));

    await act(() => result.current.ask('  How is an int8 vector scaled?  '));

    expect(fetch).toHaveBeenCalledWith('/api/ask', expect.objectContaining({ method: 'POST' }));
    expect(result.current.status).toBe('done');
    expect(result.current.question).toBe('How is an int8 vector scaled?');
    expect(result.current.refused).toBe(false);
    expect(result.current.retrieval).toBe('hybrid');
    expect(result.current.sources.map((s) => s.url)).toContain('/docs/quantization#why-int8');
    expect(result.current.answer).toMatch(/scaled so its largest component maps to 127\. \[\d\]/);
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('reports refusals', async () => {
    const { result } = renderHook(() => useAsk({ fetch: handlerFetch() }));
    await act(() => result.current.ask('Who won the 1998 World Cup final?'));
    expect(result.current).toMatchObject({ status: 'done', refused: true, sources: [] });
    expect(result.current.answer).toContain("I don't know");
  });

  it('flags an answer the model cut off at its output limit', async () => {
    const atLimit = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: 't' },
              { type: 'text-delta' as const, id: 't', delta: 'To install it, first run the' },
              { type: 'text-end' as const, id: 't' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'length' as const, raw: 'max_tokens' },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 800, text: 800, reasoning: 0 },
                },
              },
            ],
          }),
        }),
    });
    const { result } = renderHook(() => useAsk({ fetch: handlerFetch({ model: atLimit }) }));
    await act(() => result.current.ask('How do I install with pnpm?'));
    expect(result.current).toMatchObject({
      status: 'done',
      truncated: true,
      answer: 'To install it, first run the',
    });
  });

  it('maps rate limits, HTTP and network failures to typed errors', async () => {
    const limited = handlerFetch({
      rateLimit: () => ({ success: false, reset: Date.now() + 12_000 }),
    });
    const { result } = renderHook(() => useAsk({ fetch: limited }));
    await act(() => result.current.ask('int8'));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatchObject({
      kind: 'rate-limited',
      code: 'rate_limited',
      status: 429,
      retryAfter: 12,
    });

    // The site's daily budget is spent: still a 429, told apart by its code.
    const spent = handlerFetch({ budget: { requestsPerDay: 1 } });
    const budget = renderHook(() => useAsk({ fetch: spent }));
    await act(() => budget.result.current.ask('int8'));
    await act(() => budget.result.current.ask('int8 vectors'));
    expect(budget.result.current.error).toMatchObject({
      kind: 'rate-limited',
      code: 'budget_exceeded',
      message: 'The assistant has reached its daily limit. Please try again later.',
    });

    const offline = renderHook(() =>
      useAsk({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) }),
    );
    await act(() => offline.result.current.ask('int8'));
    expect(offline.result.current.error?.kind).toBe('network');

    const broken = renderHook(() =>
      useAsk({ fetch: () => Promise.resolve(new Response('nope', { status: 502 })) }),
    );
    await act(() => broken.result.current.ask('int8'));
    expect(broken.result.current.error).toMatchObject({ kind: 'http', status: 502 });
  });

  it('explains a missing endpoint kindly, and in development says where it posted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const notFound = () =>
      Promise.resolve(
        new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } }),
      );
    const { result } = renderHook(() => useAsk({ fetch: notFound }));
    await act(() => result.current.ask('int8'));
    expect(result.current.error).toEqual({
      kind: 'http',
      status: 404,
      message: 'Answers aren’t available here right now.',
      reason: 'unavailable',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`POST ${new URL('/api/ask', location.href).href} returned 404`),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('run `npx ondocs dev`'));

    // A production build on a deployed site keeps the console quiet.
    warn.mockClear();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('location', new URL('https://docs.example.com/guide/'));
    try {
      await act(() => result.current.ask('int8'));
      expect(result.current.error?.status).toBe(404);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('stop() keeps the partial answer and ignores the rest of the stream', async () => {
    const slow = handlerFetch({ model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 30 }) });
    const { result } = renderHook(() => useAsk({ fetch: slow }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.ask('How is an int8 vector scaled?');
    });
    await waitFor(() => {
      expect(result.current.status).toBe('streaming');
    });
    act(() => {
      result.current.stop();
    });
    const partial = result.current.answer;
    await act(() => pending);
    expect(result.current.status).toBe('done');
    expect(result.current.answer).toBe(partial);
    expect(partial.length).toBeGreaterThan(0);
  });
});

describe('AskAnswer', () => {
  const sources = [{ id: 1, url: '/docs/a#x', title: 'A', heading: 'X' }];

  it('renders citations as links only for known sources', () => {
    render(<AskAnswer text="Known [1], unknown [7], pair [1, 7]." sources={sources} />);
    const link = screen.getByRole('link', { name: 'Source 1: A' });
    expect(link.getAttribute('href')).toBe('/docs/a#x');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(document.body.textContent).toContain('unknown [7], pair [1, 7]');
  });

  it('never renders model output as HTML or unsafe links', () => {
    render(
      <AskAnswer
        text={'<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://example.com)'}
        sources={[]}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(screen.queryByRole('link', { name: 'click' })).toBeNull();
    expect(screen.getByRole('link', { name: 'ok' }).getAttribute('rel')).toBe(
      'noreferrer noopener',
    );
  });

  it('keeps only links to the source pages with links="sources"', () => {
    const text =
      'See [the setup](/docs/a), [its section](/docs/a/#y), ' +
      '[a login page](https://evil.example/login) and [elsewhere](/docs/b). [1]';
    const { unmount } = render(<AskAnswer text={text} sources={sources} links="sources" />);
    expect(screen.getByRole('link', { name: 'the setup' }).getAttribute('href')).toBe('/docs/a');
    expect(screen.getByRole('link', { name: 'its section' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'a login page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'elsewhere' })).toBeNull();
    // Shown as text, and citations still link.
    expect(document.body.textContent).toContain('a login page and elsewhere.');
    expect(screen.getByRole('link', { name: 'Source 1: A' })).toBeTruthy();
    unmount();

    // The default keeps every safe link.
    render(<AskAnswer text={text} sources={sources} />);
    expect(screen.getByRole('link', { name: 'a login page' })).toBeTruthy();
  });

  it('extracts cited source numbers', () => {
    expect([...citedSourceIds('A [1]. B [2][3]. C [1, 4]. Not [x].')]).toEqual([1, 2, 3, 4]);
  });

  it('renders lists, code and emphasis', () => {
    render(
      <AskAnswer
        text={'Steps:\n\n1. Install `ondocs`\n2. Run **index**\n\n```sh\npnpm build\n```'}
        sources={[]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.querySelector('code')?.textContent).toBe('ondocs');
    expect(document.querySelector('strong')?.textContent).toBe('index');
    expect(document.querySelector('pre code')?.textContent).toBe('pnpm build');
  });

  it('lets the keyboard reach a code block, which can scroll sideways', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AskAnswer text={'Add it:\n\n```ts\nexport default { plugins: [] };\n```'} sources={[]} />,
    );
    await user.tab();
    expect(document.activeElement).toBe(container.querySelector('pre.ask-pre'));
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('AskDialog', () => {
  it('opens with ⌘I, asks, streams a cited answer and returns focus on close', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((_url: string, event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <>
        <button type="button">Elsewhere</button>
        <AskDialog
          fetch={handlerFetch()}
          suggestions={['How do I install with pnpm?']}
          onNavigate={onNavigate}
        />
      </>,
    );
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();

    await user.keyboard('{Meta>}i{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Ask this site' });
    const input = within(dialog).getByRole('combobox');
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(
      within(dialog).getByRole('option', { name: 'How do I install with pnpm?' }),
    ).toBeTruthy();

    await user.type(input, 'How is an int8 vector scaled?{Enter}');

    const answer = await waitFor(() => {
      const region = dialog.querySelector('[aria-live="polite"]');
      expect(region?.getAttribute('data-status')).toBe('done');
      return region as HTMLElement;
    });
    expect(answer.getAttribute('aria-busy')).toBe('false');
    expect(within(dialog).getByRole('status').textContent).toMatch(
      /Answer ready, citing \d sources?\./,
    );

    const sources = within(dialog).getByRole('navigation', { name: 'Sources' });
    const sourceLinks = within(sources).getAllByRole('link');
    expect(sourceLinks.length).toBeGreaterThan(0);
    // Sources the finished answer cites are marked; the rest are de-emphasized.
    expect(sourceLinks.some((link) => link.getAttribute('data-cited') === 'true')).toBe(true);

    const citation = within(answer).getAllByRole('link', { name: /^Source \d+:/ })[0]!;
    await user.click(citation);
    expect(onNavigate).toHaveBeenCalledWith(citation.getAttribute('href'), expect.anything());
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(elsewhere);
  });

  it('shows only links to the source pages when links="sources"', async () => {
    const injected = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: 't' },
              {
                type: 'text-delta' as const,
                id: 't',
                delta:
                  'Scale it [as shown](/docs/quantization), or [log in here](https://evil.example/login). [1]',
              },
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
    const user = userEvent.setup();
    render(<AskDialog fetch={handlerFetch({ model: injected })} defaultOpen links="sources" />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    const answer = await waitFor(() => {
      const region = dialog.querySelector('[data-status="done"]');
      expect(region).not.toBeNull();
      return region as HTMLElement;
    });
    expect(within(answer).getByRole('link', { name: 'as shown' }).getAttribute('href')).toBe(
      '/docs/quantization',
    );
    expect(within(answer).queryByRole('link', { name: 'log in here' })).toBeNull();
    expect(answer.textContent).toContain('or log in here.');
  });

  it('passes axe before and after it answers', async () => {
    const user = userEvent.setup();
    render(<AskDialog fetch={handlerFetch()} defaultOpen suggestions={['How do I install it?']} />);
    const dialog = await screen.findByRole('dialog');
    // jsdom has no layout, so color contrast is left to the theme's tests (styles.test.ts).
    const violations = async () =>
      (await axe.run(dialog)).violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      );
    expect(await violations()).toEqual([]);

    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    expect(within(dialog).getByRole('navigation', { name: 'Sources' })).toBeTruthy();
    // The input's aria-controls still points at the list, which the answer replaced.
    const controls = within(dialog).getByRole('combobox').getAttribute('aria-controls') ?? '';
    expect(document.getElementById(controls)).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('leaves the shortcut to text fields and editors, where ⌘I means italic', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Elsewhere</button>
        <input aria-label="Name" />
        <textarea aria-label="Notes" />
        <select aria-label="Size">
          <option>S</option>
        </select>
        <div role="textbox" aria-label="Editor" contentEditable tabIndex={0}>
          <b>Rich</b> text
        </div>
        <AskDialog fetch={handlerFetch()} shortcut="i" />
      </>,
    );
    for (const field of [
      screen.getByRole('textbox', { name: 'Name' }),
      screen.getByRole('textbox', { name: 'Notes' }),
      screen.getByRole('combobox', { name: 'Size' }),
      screen.getByRole('textbox', { name: 'Editor' }),
    ]) {
      field.focus();
      await user.keyboard('{Control>}i{/Control}');
      expect([field.getAttribute('aria-label'), screen.queryByRole('dialog')]).toEqual([
        field.getAttribute('aria-label'),
        null,
      ]);
    }

    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await user.keyboard('{Control>}i{/Control}');
    const dialog = await screen.findByRole('dialog');
    // The dialog's own input still closes it.
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole('combobox'));
    });
    await user.keyboard('{Control>}i{/Control}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows a floating launcher, with its shortcut, when asked to', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AskDialog fetch={handlerFetch()} />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<AskDialog fetch={handlerFetch()} launcher theme="dark" />);
    const button = screen.getByRole('button', { name: /Ask AI/ });
    expect(button.className).toBe('ondocs-launcher');
    expect(button.dataset.askTheme).toBe('dark');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Ask this site' })).toBeTruthy();
    await user.keyboard('{Escape}');

    rerender(<AskDialog fetch={handlerFetch()} launcher="Ask the docs" shortcut={false} />);
    const custom = screen.getByRole('button', { name: 'Ask the docs' });
    expect(custom.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(custom.querySelector('kbd')).toBeNull();
  });

  it('asks a suggestion on click and supports a custom trigger', async () => {
    const user = userEvent.setup();
    render(
      <AskDialog
        fetch={handlerFetch()}
        shortcut={false}
        trigger={<button type="button">Ask the docs</button>}
        suggestions={['How do I install with pnpm?']}
      />,
    );
    await user.keyboard('{Meta>}i{/Meta}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ask the docs' }));
    await user.click(await screen.findByRole('option', { name: 'How do I install with pnpm?' }));
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Sources' })).toBeTruthy();
    });
    expect(
      within(screen.getByRole('navigation', { name: 'Sources' }))
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toContain('/docs/install#with-pnpm');
  });
});
