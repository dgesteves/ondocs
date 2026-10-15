// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { OndocsGlobalData } from '../src/docusaurus';
import NavbarSearch from '../src/docusaurus/theme/Navbar/Search';
import Ondocs from '../src/docusaurus/theme/Ondocs';
import OndocsMcp from '../src/docusaurus/theme/OndocsMcp';
import { openAskDialog } from '../src/embed';
import { globalData } from './docusaurus-client';

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
  const instances: Record<string, OndocsGlobalData> = {
    docs: {
      endpoint: '/api/ask',
      dialog: { title: 'Ask the docs', shortcut: 'j' },
      mcp: { url: 'https://docs.acme.dev/api/mcp', name: 'acme-docs' },
    },
    blog: { endpoint: '/api/blog', dialog: { title: 'Ask the blog', launcher: 'Ask' } },
  };
  globalData.instances = instances;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('@theme/Ondocs', () => {
  it('renders one launcher, with its shortcut, for the first plugin instance', async () => {
    // The plugin's Root and a swizzled Root can both render it.
    render(
      <>
        <Ondocs />
        <Ondocs />
      </>,
    );
    const launcher = await screen.findByRole('button', { name: 'Ask AI' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Meta+J Control+J');

    await userEvent.click(launcher);
    expect(await screen.findByRole('dialog', { name: 'Ask the docs' })).toBeTruthy();
  });

  it('reads the plugin instance it is given', async () => {
    render(<Ondocs pluginId="blog" />);
    const launcher = await screen.findByRole('button', { name: 'Ask' });
    expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');
  });
});

describe('@theme/Navbar/Search, with the navbar button', () => {
  /** The plugin's global data, as `dialog.navbar` makes it, for one test. */
  function withNavbar(data: Partial<OndocsGlobalData>): void {
    const { instances } = globalData;
    globalData.instances = {
      docs: {
        endpoint: '/api/ask',
        dialog: { title: 'Ask the docs', launcher: false },
        navbar: 'Ask AI',
        ...data,
      },
    };
    onTestFinished(() => {
      globalData.instances = instances;
    });
  }

  it('renders the search box alone without dialog.navbar', () => {
    const { container } = render(
      <NavbarSearch className="search">
        <input aria-label="Search" />
      </NavbarSearch>,
    );
    expect(container.innerHTML).toBe(
      '<div class="navbar-search search"><input aria-label="Search"></div>',
    );
  });

  it('puts the button after the search box, with its shortcut, and it opens the dialog', async () => {
    withNavbar({});
    render(
      <>
        <NavbarSearch>
          <input aria-label="Search" />
        </NavbarSearch>
        <Ondocs />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Ask AI' });
    expect(button.parentElement?.className).toBe('navbar-search ondocs-navbar');
    expect(button.previousElementSibling?.getAttribute('aria-label')).toBe('Search');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');
    expect(button.querySelector('kbd')?.outerHTML).toBe(
      '<kbd aria-hidden="true" data-control="Ctrl">I</kbd>',
    );
    // The floating launcher is off: the plugin set launcher: false with navbar.
    expect(document.querySelector('.ondocs-launcher')).toBeNull();
    await userEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'Ask the docs' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });
  });

  it('labels the button and its shortcut as the options say', () => {
    withNavbar({
      dialog: { title: 'Demander', shortcut: 'j', labels: { controlKey: 'Strg' } },
      navbar: 'Demander',
    });
    render(<NavbarSearch />);
    const button = screen.getByRole('button', { name: 'Demander' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+J Control+J');
    expect(button.querySelector('kbd')?.dataset.control).toBe('Strg');
  });

  it('has no shortcut hint with the shortcut off', () => {
    withNavbar({ dialog: { title: 'Ask', shortcut: false } });
    render(<NavbarSearch />);
    const button = screen.getByRole('button', { name: 'Ask AI' });
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(button.querySelector('kbd')).toBeNull();
  });
});

describe('@theme/Ondocs, opened from the page', () => {
  it('opens from openAskDialog() and data-ondocs-open, asking their question', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const { question } = JSON.parse(init?.body as string) as { question: string };
        asked.push(question);
        return Promise.resolve(
          new Response(
            [
              { type: 'start', messageMetadata: { refused: false, retrieval: 'keyword' } },
              { type: 'text-delta', id: 'a', delta: `You asked: ${question}` },
              { type: 'finish' },
            ]
              .map((part) => `data: ${JSON.stringify(part)}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        );
      }),
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    render(
      <>
        <button type="button" data-ondocs-open="Is it free?">
          Is it free?
        </button>
        <Ondocs />
        <Ondocs />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Is it free?' }));
    expect(await screen.findByText('You asked: Is it free?')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    act(() => {
      openAskDialog('Where does it run?');
    });
    expect(await screen.findByText('You asked: Where does it run?')).toBeTruthy();
    // Rendered twice, it listens once.
    expect(asked).toEqual(['Is it free?', 'Where does it run?']);
  });
});

describe('@theme/OndocsMcp', () => {
  it('shows how to add the MCP endpoint to each client, as Infima buttons', () => {
    render(<OndocsMcp />);
    const cursor = screen.getByRole('link', { name: 'Add to Cursor' });
    expect(cursor.getAttribute('href')).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=acme-docs&config=/,
    );
    expect(cursor.className).toContain('button button--secondary');
    expect(screen.getByRole('link', { name: 'Add to VS Code' }).getAttribute('href')).toMatch(
      /^vscode:mcp\/install\?/,
    );
    expect(screen.getByRole('link', { name: 'Add to Claude' }).getAttribute('href')).toContain(
      'connectorUrl=https%3A%2F%2Fdocs.acme.dev%2Fapi%2Fmcp',
    );
    expect(screen.getByText(/^claude mcp add --transport http acme-docs /)).toBeTruthy();
    expect(
      screen.getByText(/^codex mcp add acme-docs --url https:\/\/docs\.acme\.dev\//),
    ).toBeTruthy();
    expect(
      screen.getByText(/^gemini mcp add --transport http --scope user acme-docs /),
    ).toBeTruthy();
    expect(screen.getByText(/^\[mcp_servers\.acme-docs\]\surl = "https:/)).toBeTruthy();
  });

  it('renders nothing for a plugin instance without an MCP endpoint', () => {
    const { container } = render(<OndocsMcp pluginId="blog" />);
    expect(container.innerHTML).toBe('');
  });
});

/* eslint-disable @typescript-eslint/no-deprecated -- the names from before ondocs, on purpose */
describe('@theme/AskMySite and @theme/AskMySiteMcp, the names from before ondocs', () => {
  /** The two components, from modules of their own, so each test starts with nothing said. */
  async function load() {
    const { instances } = globalData;
    vi.resetModules();
    const [client, { default: AskMySite }, { default: AskMySiteMcp }] = await Promise.all([
      import('./docusaurus-client'),
      import('../src/docusaurus/theme/AskMySite'),
      import('../src/docusaurus/theme/AskMySiteMcp'),
    ]);
    client.globalData.instances = instances;
    return { AskMySite, AskMySiteMcp };
  }

  it('render the same dialog and MCP block, and say once in development to import the new names', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { AskMySite, AskMySiteMcp } = await load();
    const { rerender } = render(
      <>
        <AskMySite />
        <AskMySiteMcp />
      </>,
    );
    rerender(
      <>
        <AskMySite />
        <AskMySiteMcp />
      </>,
    );
    expect(await screen.findByRole('button', { name: 'Ask AI' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add to Cursor' })).toBeTruthy();
    expect(warn.mock.calls).toEqual([
      [
        '[ondocs] @theme/AskMySite is now @theme/Ondocs. Import it from there; the old name still works for now.',
      ],
      [
        '[ondocs] @theme/AskMySiteMcp is now @theme/OndocsMcp. Import it from there; the old name still works for now.',
      ],
    ]);
  });

  it('say nothing in a visitor’s browser', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { AskMySite } = await load();
    render(<AskMySite />);
    expect(await screen.findByRole('button', { name: 'Ask AI' })).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});
/* eslint-enable @typescript-eslint/no-deprecated */
