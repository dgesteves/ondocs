// @vitest-environment jsdom
// The home page's demo (examples/nextjs/components/landing/hero-demo.tsx): the sources the answer
// cites show, and the others fold into one line (demo-sources.tsx). On a phone it is a still of the
// same answer. With the site's Turnstile key, each question carries a bot check's token.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoSources } from '../examples/nextjs/components/landing/demo-sources';
import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { DEFAULT_LABELS } from '../src/react';
import { citedSourceIds } from '../src/react/answer';
import { TURNSTILE_SCRIPT, type TurnstileApi } from '../src/react/turnstile';
import { createAskHandler, turnstile } from '../src/server';
import { corpus } from './helpers';

const { navigation } = vi.hoisted(() => {
  // The site's own next, as its components import it, which this folder can't resolve by name.
  const { createRequire } = process.getBuiltinModule('node:module');
  const require = createRequire(`${import.meta.dirname}/../examples/nextjs/package.json`);
  return { navigation: require.resolve('next/navigation') };
});

vi.mock(navigation, () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** What the live site's demo opened on: six sources, and one short answer citing the second. */
const SOURCES = [
  { id: 1, url: '/docs/docusaurus', title: 'Docusaurus', heading: '' },
  {
    id: 2,
    url: '/docs/docusaurus#add-it-to-docusaurusconfigts',
    title: 'Docusaurus',
    heading: 'Add it to docusaurus.config.ts',
  },
  {
    id: 3,
    url: '/docs/docusaurus#the-dialog-and-the-shortcut',
    title: 'Docusaurus',
    heading: 'The dialog and the shortcut',
  },
];
const ANSWER =
  "Put the plugin in the `plugins` array of `docusaurus.config.ts`: `plugins: ['ondocs/docusaurus']`. [2]";

const sources = (answer: string, complete = true) =>
  render(
    <DemoSources
      sources={SOURCES}
      cited={citedSourceIds(answer)}
      complete={complete}
      onNavigate={vi.fn()}
    />,
  ).container.querySelector('.demo-sources')!;

const shown = (element: Element) =>
  [...element.querySelectorAll(':scope > ol a')].map((a) => [
    text(a.querySelector('.demo-source-title')),
    a.getAttribute('data-cited'),
  ]);

describe('the home page’s demo', () => {
  it('shows the source the answer cites, and folds the others into one closed line', () => {
    const element = sources(ANSWER);
    expect(shown(element)).toEqual([['Docusaurus › Add it to docusaurus.config.ts', 'true']]);
    const more = element.querySelector('details')!;
    expect(more.open).toBe(false);
    expect(text(more.querySelector('summary'))).toBe('2 more sources, not cited');
    expect(
      [...more.querySelectorAll('a')].map((a) => [
        a.getAttribute('href'),
        a.getAttribute('data-cited'),
      ]),
    ).toEqual([
      ['/docs/docusaurus', 'false'],
      ['/docs/docusaurus#the-dialog-and-the-shortcut', 'false'],
    ]);
  });

  it('while the answer streams, says nothing of the sources it has not cited yet', () => {
    const element = sources('Put the plugin in the', false);
    expect(shown(element)).toEqual([]);
    const more = element.querySelector('details')!;
    expect(text(more.querySelector('summary'))).toBe('3 sources');
    expect([...more.querySelectorAll('a')].map((a) => a.getAttribute('data-cited'))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('shows every source it cites, and no fold when it cites them all', () => {
    const element = sources('One [1], two [2] and three [3].');
    expect(element.querySelectorAll(':scope > ol a')).toHaveLength(3);
    expect(element.querySelector('details')).toBeNull();
  });

  it('folds one source as one source', () => {
    expect(text(sources('One [1] and two [2].').querySelector('summary'))).toBe(
      '1 more source, not cited',
    );
  });
});

const landing = (file: string) =>
  readFileSync(join(import.meta.dirname, '../examples/nextjs', file), 'utf8');
/** The landing page's styles on a phone. */
const phone = (landing('app/(home)/landing.css').split('@media (max-width: 800px) {')[1] ?? '')
  // Without its comments.
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the home page’s demo on a phone', () => {
  it('is a still of the same answer: no box to type in, and no questions to pick', () => {
    expect(phone).toMatch(
      /\.hero \.demo\[data-still\] \.demo-input,\s*\.hero \.demo\[data-still\] \.demo-chips \{\s*display: none;\s*\}/,
    );
  });

  it('stays a demo to type in when the build got no answer', () => {
    // Only a demo marked as a still loses its input and chips…
    for (const part of ['.demo-input', '.demo-chips']) {
      const selectors = [...phone.matchAll(/([^{}]+)\{[^}]*display: none;[^}]*\}/g)]
        .flatMap(([, list]) => (list ?? '').split(','))
        .map((selector) => selector.trim())
        .filter((selector) => selector.endsWith(part));
      expect(selectors, part).toEqual([`.hero .demo[data-still] ${part}`]);
    }
    // …and the demo is marked so only when it opens on the answer asked at build time.
    expect(landing('components/landing/hero-demo.tsx')).toContain(
      "data-still={initial ? '' : undefined}",
    );
  });
});

describe('the home page’s demo with a Turnstile site key', () => {
  /** Cloudflare's test site key that always passes, invisibly. Nothing here reaches Cloudflare. */
  const SITE_KEY = '1x00000000000000000000BB';
  const SECRET = 'the-widget-secret';
  const QUESTION = 'How is an int8 vector scaled?';
  // Imported by path, so the typecheck does not follow it to the site's index, which only its build
  // writes.
  const DEMO = '../examples/nextjs/components/landing/hero-demo';

  const embeddingModel = mockEmbeddingModel();
  const built = buildIndex({ documents: corpus, embeddingModel });

  /**
   * The site's `/api/ask`, checking tokens as the site does with both keys set: siteverify is a
   * stand-in, where each token the widget stand-in solved (`issued`) passes once.
   */
  let issued: Set<string>;
  let verified: string[];
  let bodies: Record<string, unknown>[];
  beforeEach(async () => {
    issued = new Set();
    verified = [];
    bodies = [];
    const { index } = await built;
    const options = {
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      embeddingModel,
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      rateLimit: false as const,
    };
    const checked = createAskHandler({ ...options, challenge: turnstile({ secretKey: SECRET }) });
    const unchecked = createAskHandler(options);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
          const { secret, response } = JSON.parse(init?.body as string) as Record<string, string>;
          verified.push(response ?? '');
          const success = secret === SECRET && issued.delete(response ?? '');
          return Promise.resolve(
            Response.json({ success, 'error-codes': success ? [] : ['timeout-or-duplicate'] }),
          );
        }
        if (url !== '/api/ask') return Promise.reject(new Error(`unexpected fetch of ${url}`));
        bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        const handler = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? checked : unchecked;
        return handler(new Request(new URL(url, 'http://localhost'), init));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    // Settle a script tag a test left loading, so the next test starts without one.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const tag of scriptTags()) tag.dispatchEvent(new Event('error'));
    for (const tag of scriptTags()) tag.remove();
    delete window.turnstile;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const scriptTags = (): HTMLScriptElement[] =>
    [...document.querySelectorAll('script')].filter((tag) => tag.src === TURNSTILE_SCRIPT);

  /**
   * The demo, as the site builds it: the key is read as the module loads, as Next inlines it.
   * With `initial`, it opens on that answer, and is a still on a phone.
   */
  async function demo(siteKey?: string, initial: typeof STILL | null = null) {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', siteKey);
    const { HeroDemo } = (await import(/* @vite-ignore */ DEMO)) as {
      HeroDemo: (props: {
        suggestions: readonly string[];
        initial: typeof STILL | null;
        mode: 'openai' | 'mock';
      }) => ReactElement;
    };
    render(
      <div className="hero">
        <HeroDemo suggestions={[QUESTION]} initial={initial} mode="mock" />
      </div>,
    );
    return screen.getByRole('region', { name: 'Ask these docs' });
  }

  /** The answer asked at build time, which the demo opens on. */
  const STILL = { question: QUESTION, answer: ANSWER, sources: SOURCES };

  /** A phone's width: the landing page's rule that makes the demo a still, until it is undone. */
  function phoneWidth(): () => void {
    const rule = /\.hero \.demo\[data-still\] \.demo-input,[^}]*\}/.exec(phone)?.[0];
    expect(rule).toBeDefined();
    const style = document.createElement('style');
    style.textContent = rule ?? '';
    document.head.append(style);
    return () => {
      style.remove();
    };
  }

  /** Lets the script tag the demo added load, with `api` as what it defines. */
  async function loadScript(api: TurnstileApi): Promise<void> {
    await waitFor(() => {
      expect(scriptTags()).toHaveLength(1);
    });
    window.turnstile = api;
    act(() => {
      scriptTags()[0]?.dispatchEvent(new Event('load'));
    });
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

  it('asks its first question with a token, so the endpoint answers it', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    // Turnstile on the page already (the dialog loaded it), solving a token as a widget renders.
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
    const region = await demo(SITE_KEY);
    await user.click(within(region).getByRole('button', { name: QUESTION }));
    await within(region).findByText(/maps to 127/);
    expect(within(region).queryByRole('alert')).toBeNull();
    expect(bodies).toEqual([{ question: QUESTION, challenge: 'token-1' }]);
    expect(verified).toEqual(['token-1']);
    expect(scriptTags()).toHaveLength(0);
  });

  it('loads Turnstile once the demo is wanted, and takes a fresh token for each question', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const region = await demo(SITE_KEY);
    // Nothing of Turnstile as the page loads.
    expect(scriptTags()).toHaveLength(0);

    // A pointer over the demo loads it, so a token is solved by the time a question is asked.
    await user.hover(region);
    await waitFor(() => {
      expect(scriptTags()).toHaveLength(1);
    });
    expect(scriptTags()[0]?.async).toBe(true);
    window.turnstile = turnstile.api;
    act(() => {
      scriptTags()[0]?.dispatchEvent(new Event('load'));
    });
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    const [widget] = turnstile.widgets;
    expect(region.contains(widget?.container ?? null)).toBe(true);
    expect(widget?.options).toMatchObject({
      sitekey: SITE_KEY,
      appearance: 'interaction-only',
      'response-field': false,
    });

    const first = turnstile.solve();
    await user.click(within(region).getByRole('button', { name: QUESTION }));
    await within(region).findByText(/maps to 127/);
    expect(bodies[0]).toEqual({ question: QUESTION, challenge: first });
    // Taking a token sets the widget solving the next.
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');

    // A question asked before its token is ready waits for it.
    await user.type(within(region).getByRole('textbox'), 'And the scale?{Enter}');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bodies).toHaveLength(1);
    const second = turnstile.solve();
    await waitFor(() => {
      expect(bodies).toHaveLength(2);
    });
    expect(bodies[1]).toMatchObject({ challenge: second });
    expect(second).not.toBe(first);
    expect(verified).toEqual([first, second]);
    await waitFor(() => {
      expect(within(region).queryByRole('alert')).toBeNull();
    });
    expect(scriptTags()).toHaveLength(1);
    expect(turnstile.widgets).toHaveLength(1);
  });

  it('says in the dialog’s words that the bot check did not load, when its script fails', async () => {
    const user = userEvent.setup();
    const region = await demo(SITE_KEY);
    await user.hover(region);
    await waitFor(() => {
      expect(scriptTags()).toHaveLength(1);
    });
    // Asked while the script loads, which a blocker, a Content-Security-Policy or the network fails.
    await user.click(within(region).getByRole('button', { name: QUESTION }));
    expect(bodies).toHaveLength(0);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => {
      scriptTags()[0]?.dispatchEvent(new Event('error'));
    });
    const alert = await within(region).findByRole('alert');
    // The library's words, which the demo copies rather than import all its labels.
    expect(text(alert)).toBe(DEFAULT_LABELS.challengeRequired);
    expect(bodies).toEqual([{ question: QUESTION }]);
    expect(errors).toHaveBeenCalledWith(
      '[ondocs]',
      expect.objectContaining({
        message: expect.stringContaining(
          'A Content-Security-Policy must allow https://challenges.cloudflare.com for scripts and frames.',
        ) as string,
      }),
    );
    // So the next question tries again.
    expect(scriptTags()).toHaveLength(0);
  });

  it('says in the dialog’s words that the bot check failed, when the endpoint rejects the token', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const region = await demo(SITE_KEY);
    await user.hover(region);
    await loadScript(turnstile.api);
    await waitFor(() => {
      expect(turnstile.widgets).toHaveLength(1);
    });
    // Already used, as a replayed token would be.
    issued.delete(turnstile.solve());
    await user.click(within(region).getByRole('button', { name: QUESTION }));
    const alert = await within(region).findByRole('alert');
    expect(text(alert)).toBe(DEFAULT_LABELS.challengeFailed);
  });

  it('on a phone, where the demo is a still, loads no Turnstile for a pointer over it', async () => {
    const user = userEvent.setup();
    const restore = phoneWidth();
    try {
      const region = await demo(SITE_KEY, STILL);
      // A tap, or a scroll that starts on it.
      await user.hover(region);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(scriptTags()).toHaveLength(0);
      // Focus in it still loads it.
      act(() => {
        within(region).getAllByRole('link')[0]?.focus();
      });
      await waitFor(() => {
        expect(scriptTags()).toHaveLength(1);
      });
    } finally {
      restore();
    }
  });

  it('wider than a phone, loads Turnstile for a pointer over the same demo, in the page’s scheme', async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const region = await demo(SITE_KEY, STILL);
    expect(region.hasAttribute('data-still')).toBe(true);
    // The theme switch, to Dark, after the page loaded.
    act(() => {
      document.documentElement.classList.add('dark');
    });
    try {
      await user.hover(region);
      await loadScript(turnstile.api);
      await waitFor(() => {
        expect(turnstile.widgets).toHaveLength(1);
      });
      expect(turnstile.widgets[0]?.options).toMatchObject({ theme: 'dark' });
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('without the key, loads no Turnstile, renders no widget and sends no token', async () => {
    const user = userEvent.setup();
    const region = await demo();
    await user.hover(region);
    await user.click(within(region).getByRole('button', { name: QUESTION }));
    await within(region).findByText(/maps to 127/);
    expect(bodies).toEqual([{ question: QUESTION }]);
    expect(scriptTags()).toHaveLength(0);
    expect(window.turnstile).toBeUndefined();
    expect(region.querySelector('.demo-challenge')).toBeNull();
  });
});
