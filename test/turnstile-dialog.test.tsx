// @vitest-environment jsdom
// The bot check in the dialog: with `challenge: { turnstile: '<site key>' }`, the dialog loads
// Turnstile's script when it opens (and not before), renders a widget in itself, and sends a fresh
// token with each question. Turnstile is a stand-in here (`window.turnstile`), and the endpoint is
// a real handler whose siteverify is a stand-in too: nothing reaches Cloudflare.
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { scriptOptions } from '../src/embed/script';
import { launcherScript } from '../src/integration';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskDialog, useAsk } from '../src/react';
import { TURNSTILE_SCRIPT, type TurnstileApi } from '../src/react/turnstile';
import { createAskHandler, turnstile } from '../src/server';
import { corpus } from './helpers';

/** Cloudflare's test site key that always passes, invisibly. */
const SITE_KEY = '1x00000000000000000000BB';
const SECRET = 'the-widget-secret';
const QUESTION = 'How is an int8 vector scaled?';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

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

/**
 * Siteverify, as Cloudflare runs it for a real widget: each token it handed out passes once.
 * `issued` is what the widget stand-in solves.
 */
let issued: Set<string>;
let verified: string[];
beforeEach(() => {
  issued = new Set();
  verified = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        return Promise.reject(new Error(`unexpected fetch of ${url}`));
      }
      const { secret, response } = JSON.parse(init?.body as string) as Record<string, string>;
      verified.push(response ?? '');
      const success = secret === SECRET && issued.delete(response ?? '');
      return Promise.resolve(
        Response.json({ success, 'error-codes': success ? [] : ['timeout-or-duplicate'] }),
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  // Settle a script tag a test left loading, so the next test starts without one.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const tag of scriptTags()) tag.dispatchEvent(new Event('error'));
  delete window.turnstile;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const scriptTags = (): HTMLScriptElement[] =>
  [...document.querySelectorAll('script')].filter((tag) => tag.src === TURNSTILE_SCRIPT);

/** The ask endpoint, checking tokens with the siteverify stand-in. */
function endpoint() {
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    challenge: turnstile({ secretKey: SECRET }),
  });
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
    return handler(
      input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init),
    );
  });
  return { fetch, bodies };
}

/** Turnstile, stood in for: its widgets, and solving the latest one's next token. */
function fakeTurnstile() {
  const widgets: { container: HTMLElement; options: Record<string, unknown> }[] = [];
  const api: TurnstileApi = {
    render: vi.fn((container: HTMLElement, options: Record<string, unknown>) => {
      widgets.push({ container, options });
      return `widget-${String(widgets.length)}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  let count = 0;
  const solve = (): string => {
    const token = `token-${String(++count)}`;
    issued.add(token);
    const callback = widgets.at(-1)?.options.callback as (token: string) => void;
    act(() => {
      callback(token);
    });
    return token;
  };
  return { api, widgets, solve };
}

/** Lets the script tag the dialog added load, with `api` as what it defines. */
async function loadScript(api: TurnstileApi): Promise<void> {
  await waitFor(() => {
    expect(scriptTags()).toHaveLength(1);
  });
  window.turnstile = api;
  act(() => {
    scriptTags()[0]?.dispatchEvent(new Event('load'));
  });
}

describe('the dialog with challenge: { turnstile }', () => {
  it('loads Turnstile only when the dialog opens, and renders an invisible widget in it', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    render(<AskDialog launcher challenge={{ turnstile: SITE_KEY }} fetch={endpoint().fetch} />);
    const button = screen.getByRole('button', { name: /Ask AI/ });
    // The dialog's code loads on a pointer over the button; Turnstile does not.
    await user.hover(button);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scriptTags()).toHaveLength(0);

    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    await loadScript(turnstile.api);
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    const [widget] = turnstile.widgets;
    expect(dialog.contains(widget?.container ?? null)).toBe(true);
    expect(widget?.container.className).toBe('ask-challenge');
    expect(widget?.options).toMatchObject({
      sitekey: SITE_KEY,
      appearance: 'interaction-only',
      theme: 'auto',
      'response-field': false,
    });
    expect(scriptTags()[0]?.async).toBe(true);
  });

  it('sends a fresh token with each question, solving the next one after each', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const { fetch, bodies } = endpoint();
    render(<AskDialog defaultOpen challenge={{ turnstile: SITE_KEY }} fetch={fetch} />);
    const dialog = await screen.findByRole('dialog');
    await loadScript(turnstile.api);
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    // Solved as the dialog opens, before the first question.
    const first = turnstile.solve();
    const input = within(dialog).getByRole('combobox');
    await user.type(input, `${QUESTION}{Enter}`);
    await within(dialog).findByText(/maps to 127/);
    expect(bodies[0]).toMatchObject({ question: QUESTION, challenge: first });
    // Taking a token sets the widget solving the next.
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');

    // A question asked before its token is ready waits for it.
    await user.clear(input);
    await user.type(input, 'And the scale?{Enter}');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).toHaveBeenCalledTimes(1);
    const second = turnstile.solve();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    expect(bodies[1]).toMatchObject({ challenge: second });
    expect(second).not.toBe(first);
    expect(verified).toEqual([first, second]);
    await waitFor(() => {
      expect(within(dialog).queryByRole('alert')).toBeNull();
    });
  });

  // A question given as the dialog opens (`question`, data-ondocs-open="…", openAskDialog(q),
  // window.Ondocs.open(q)) is asked before the widget has rendered: it waits for the widget and
  // its first token, rather than going without one.
  it('waits for the widget with a question passed in as the dialog opens', async () => {
    const turnstile = fakeTurnstile();
    const { fetch, bodies } = endpoint();
    render(
      <AskDialog
        open
        onOpenChange={() => undefined}
        question={QUESTION}
        challenge={{ turnstile: SITE_KEY }}
        fetch={fetch}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await loadScript(turnstile.api);
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    expect(fetch).not.toHaveBeenCalled();
    const token = turnstile.solve();
    await within(dialog).findByText(/maps to 127/);
    expect(bodies).toEqual([{ question: QUESTION, challenge: token }]);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('waits for the widget when a closed dialog opens with a question, and Turnstile is loaded', async () => {
    const turnstile = fakeTurnstile();
    // The page has Turnstile already, and it solves a token as soon as a widget renders.
    window.turnstile = {
      ...turnstile.api,
      render: (container, options) => {
        const id = turnstile.api.render(container, options);
        queueMicrotask(() => {
          turnstile.solve();
        });
        return id;
      },
    };
    const { fetch, bodies } = endpoint();
    const props = { onOpenChange: () => undefined, challenge: { turnstile: SITE_KEY }, fetch };
    const { rerender } = render(<AskDialog open={false} {...props} />);
    rerender(<AskDialog open question={QUESTION} {...props} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/maps to 127/);
    expect(bodies).toEqual([{ question: QUESTION, challenge: 'token-1' }]);
    expect(scriptTags()).toHaveLength(0);
  });

  it('removes the widget when the dialog closes, and renders a new one when it opens again', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    render(<AskDialog launcher challenge={{ turnstile: SITE_KEY }} fetch={endpoint().fetch} />);
    await user.click(screen.getByRole('button', { name: /Ask AI/ }));
    await screen.findByRole('dialog');
    await loadScript(turnstile.api);
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
    });
    await user.click(screen.getByRole('button', { name: /Ask AI/ }));
    await screen.findByRole('dialog');
    // Turnstile's API is on the page now: no second script.
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(2);
    });
    expect(scriptTags()).toHaveLength(1);
  });

  it('shows the bot check’s own words, in the site’s language, when the endpoint refuses', async () => {
    const user = userEvent.setup();
    const { fetch, bodies } = endpoint();
    const labels = {
      challengeRequired: 'La vérification anti-robot n’a pas chargé.',
      challengeFailed: 'La vérification anti-robot a échoué.',
    };
    render(
      <AskDialog defaultOpen challenge={{ turnstile: SITE_KEY }} fetch={fetch} labels={labels} />,
    );
    const dialog = await screen.findByRole('dialog');
    // A page whose Content-Security-Policy blocks Turnstile: the question goes without a token.
    await waitFor(() => {
      expect(scriptTags()).toHaveLength(1);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => {
      scriptTags()[0]?.dispatchEvent(new Event('error'));
    });
    await user.type(within(dialog).getByRole('combobox'), `${QUESTION}{Enter}`);
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      labels.challengeRequired,
    );
    expect(bodies[0]).not.toHaveProperty('challenge');
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('says the check failed when the endpoint rejects the token', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const { fetch } = endpoint();
    render(<AskDialog defaultOpen challenge={{ turnstile: SITE_KEY }} fetch={fetch} />);
    const dialog = await screen.findByRole('dialog');
    await loadScript(turnstile.api);
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    const token = turnstile.solve();
    // Already used, as a replayed token would be.
    issued.delete(token);
    await user.type(within(dialog).getByRole('combobox'), `${QUESTION}{Enter}`);
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The check that you’re not a bot failed. Please try again.',
    );
  });

  it('loads no Turnstile without challenge, and sends no token', async () => {
    const user = userEvent.setup();
    const handler = createAskHandler({
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      rateLimit: false,
    });
    const bodies: unknown[] = [];
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return handler(
        input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init),
      );
    });
    render(<AskDialog defaultOpen fetch={fetch} />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), `${QUESTION}{Enter}`);
    await within(dialog).findByText(/maps to 127/);
    expect(bodies).toEqual([{ question: QUESTION }]);
    expect(scriptTags()).toHaveLength(0);
    expect(dialog.querySelector('.ask-challenge')).toBeNull();
  });
});

describe('useAsk with challengeToken', () => {
  it('sends its token as challenge with each question, and none with feedback', async () => {
    const tokens = ['first', 'second'];
    const challengeToken = vi.fn(() => Promise.resolve(tokens.shift()));
    const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      if ('feedback' in body) return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(
        new Response(
          [
            'data: {"type":"start","messageMetadata":{"refused":false,"retrieval":"hybrid","feedback":true}}',
            'data: {"type":"text-start","id":"t"}',
            'data: {"type":"text-delta","id":"t","delta":"Yes."}',
            'data: {"type":"text-end","id":"t"}',
            'data: {"type":"finish"}',
            'data: [DONE]',
            '',
          ].join('\n\n'),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    });
    const { result } = renderHook(() => useAsk({ fetch, challengeToken, followUps: false }));
    await act(() => result.current.ask('One?'));
    await act(() => result.current.ask('Two?'));
    await act(() => result.current.rate('up'));
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as object);
    expect(bodies[0]).toEqual({ question: 'One?', challenge: 'first' });
    expect(bodies[1]).toEqual({ question: 'Two?', challenge: 'second' });
    expect(bodies[2]).not.toHaveProperty('challenge');
    expect(challengeToken).toHaveBeenCalledTimes(2);
  });
});

describe('every way to add the dialog passes challenge through', () => {
  it('the script tag, from data-turnstile-site-key', () => {
    expect(scriptOptions({ endpoint: '/api/ask', turnstileSiteKey: SITE_KEY })).toEqual({
      endpoint: '/api/ask',
      challenge: { turnstile: SITE_KEY },
    });
    expect(scriptOptions({ endpoint: '/api/ask' })).not.toHaveProperty('challenge');
  });

  it('the plugins’ launcher, with the dialog’s options', () => {
    expect(
      launcherScript({ endpoint: '/api/ask', dialog: { challenge: { turnstile: SITE_KEY } } }),
    ).toContain(`"challenge":{"turnstile":"${SITE_KEY}"}`);
  });
});
