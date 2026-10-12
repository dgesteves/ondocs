// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OndocsGlobalData } from '../src/docusaurus';
import Ondocs from '../src/docusaurus/theme/Ondocs';
import OndocsMcp from '../src/docusaurus/theme/OndocsMcp';
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
