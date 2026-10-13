// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import ondocs, { type OndocsGlobalData } from '../src/docusaurus';
import { launcherScript } from '../src/integration';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import { AskAnswer, AskDialog, type SourceUrls } from '../src/react';
import { mapSourceUrl } from '../src/react/answer';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

// A copy of a site's docs, whose dialog asks that site's endpoint: its index has that site's URLs.
const sourceUrls: SourceUrls = {
  pages: { '/docs/install': '/install/', '/docs/quantization': '/' },
  base: 'https://docs.example.com',
};

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

describe('mapSourceUrl', () => {
  it('sends a mapped page here, with its anchor, and resolves the rest against base', () => {
    expect(mapSourceUrl('/docs/install#with-pnpm', sourceUrls)).toBe('/install/#with-pnpm');
    expect(mapSourceUrl('/docs/install', sourceUrls)).toBe('/install/');
    // With or without a trailing slash.
    expect(mapSourceUrl('/docs/install/#with-pnpm', sourceUrls)).toBe('/install/#with-pnpm');
    expect(mapSourceUrl('/docs/quantization#int8', sourceUrls)).toBe('/#int8');
    // Not a page here: it opens on the site whose index answered.
    expect(mapSourceUrl('/docs/rate-limits#window', sourceUrls)).toBe(
      'https://docs.example.com/docs/rate-limits#window',
    );
    // Absolute URLs and anchors alone stay as they are.
    expect(mapSourceUrl('https://example.org/a', sourceUrls)).toBe('https://example.org/a');
    expect(mapSourceUrl('#top', sourceUrls)).toBe('#top');
    // Without base, a page that is not mapped stays as it is; without the option, every one does.
    expect(mapSourceUrl('/docs/rate-limits', { pages: sourceUrls.pages })).toBe(
      '/docs/rate-limits',
    );
    expect(mapSourceUrl('/docs/install#a', undefined)).toBe('/docs/install#a');
  });
});

describe('AskAnswer with sourceUrls', () => {
  const sources = [
    { id: 1, url: '/docs/install#with-pnpm', title: 'Install', heading: 'With pnpm' },
    { id: 2, url: '/docs/rate-limits', title: 'Rate limits', heading: '' },
  ];

  it('points citations and the answer’s links at the pages here, or at the other site', () => {
    render(
      <AskAnswer
        text="Run it [1] [2], see [the setup](/docs/install#from-source) and [limits](/docs/rate-limits)."
        sources={sources}
        sourceUrls={sourceUrls}
      />,
    );
    expect(screen.getByRole('link', { name: 'Source 1: Install' }).getAttribute('href')).toBe(
      '/install/#with-pnpm',
    );
    expect(screen.getByRole('link', { name: 'Source 2: Rate limits' }).getAttribute('href')).toBe(
      'https://docs.example.com/docs/rate-limits',
    );
    expect(screen.getByRole('link', { name: 'the setup' }).getAttribute('href')).toBe(
      '/install/#from-source',
    );
    expect(screen.getByRole('link', { name: 'limits' }).getAttribute('href')).toBe(
      'https://docs.example.com/docs/rate-limits',
    );
  });

  it('checks a link is safe before mapping it, so base cannot make one safe', () => {
    render(
      <AskAnswer
        text="[a](//evil.example/login) [b](javascript:alert(1)) [c](/\\evil.example)"
        sources={[]}
        sourceUrls={sourceUrls}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('keeps links to the mapped source pages with links="sources"', () => {
    render(
      <AskAnswer
        text="See [the setup](/docs/install), [elsewhere](/docs/pricing) and [off site](https://evil.example). [1]"
        sources={sources}
        sourceUrls={sourceUrls}
        links="sources"
      />,
    );
    expect(screen.getByRole('link', { name: 'the setup' }).getAttribute('href')).toBe('/install/');
    expect(screen.queryByRole('link', { name: 'elsewhere' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'off site' })).toBeNull();
  });
});

describe('AskDialog with sourceUrls', () => {
  it('lists the sources at their pages here, and navigates there', async () => {
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
    });
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      handler(
        input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init),
      ),
    );
    const onNavigate = vi.fn((_url: string, event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    const user = userEvent.setup();
    render(<AskDialog fetch={fetch} defaultOpen sourceUrls={sourceUrls} onNavigate={onNavigate} />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How do I install with pnpm?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });

    const list = within(dialog).getByRole('navigation', { name: 'Sources' });
    const links = within(list).getAllByRole('link');
    const hrefs = links.map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    // Every source is on a page here or on the other site, none at a path this site lacks.
    for (const href of hrefs) {
      expect(
        href.startsWith('/install/') ||
          href === '/' ||
          href.startsWith('/#') ||
          href.startsWith('https://docs.example.com/'),
      ).toBe(true);
    }
    const install = links.find((link) => link.getAttribute('href')?.startsWith('/install/'));
    expect(install).toBeDefined();
    // The URL it shows is the one it opens.
    expect(install?.querySelector('.ask-source-url')?.textContent).toBe(
      install?.getAttribute('href'),
    );
    await user.click(install!);
    expect(onNavigate).toHaveBeenCalledWith(install!.getAttribute('href'), expect.anything());
  });
});

describe('sourceUrls in the plugins', () => {
  it('reaches the dialog from the Astro, Starlight and VitePress launcher', () => {
    const script = launcherScript({ endpoint: '/api/ask', dialog: { sourceUrls } });
    expect(script).toContain(JSON.stringify({ endpoint: '/api/ask', sourceUrls }));
  });

  it('reaches the dialog from the Docusaurus plugin’s global data', () => {
    const setGlobalData = vi.fn();
    const context = {
      siteDir: '/nonexistent',
      siteConfig: { title: 'Docs' },
      baseUrl: '/',
      i18n: { currentLocale: 'en', defaultLocale: 'en' },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ondocs(context, { dialog: { sourceUrls } }).contentLoaded({ actions: { setGlobalData } });
    const [data] = setGlobalData.mock.lastCall as [OndocsGlobalData];
    expect(data.dialog.sourceUrls).toEqual(sourceUrls);
  });
});
