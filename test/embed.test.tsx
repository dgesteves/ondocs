// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { mountAskDialog, type MountedAskDialog } from '../src/embed';
import { scriptOptions } from '../src/embed/script';

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
  // React's act() environment, for updates from outside React (the controls, attributes).
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const mounted: MountedAskDialog[] = [];
function mount(...args: Parameters<typeof mountAskDialog>): MountedAskDialog {
  let dialog!: MountedAskDialog;
  act(() => {
    dialog = mountAskDialog(...args);
  });
  mounted.push(dialog);
  return dialog;
}

afterEach(() => {
  for (const dialog of mounted.splice(0)) {
    act(() => {
      dialog.unmount();
    });
  }
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('scriptOptions', () => {
  const data = (attributes: Record<string, string>) => {
    const script = document.createElement('script');
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    return script.dataset;
  };

  it('reads the dialog’s options from a script tag’s data-* attributes', () => {
    expect(
      scriptOptions(
        data({
          'data-endpoint': 'https://api.example.com/ask',
          'data-title': 'Ask Acme',
          'data-placeholder': 'Ask away…',
          'data-suggestions': '["How do I install it?", "Is it free?"]',
          'data-shortcut': 'j',
          'data-launcher': 'Ask',
          'data-theme': 'dark',
          'data-links': 'sources',
        }),
      ),
    ).toEqual({
      endpoint: 'https://api.example.com/ask',
      title: 'Ask Acme',
      placeholder: 'Ask away…',
      suggestions: ['How do I install it?', 'Is it free?'],
      shortcut: 'j',
      launcher: 'Ask',
      theme: 'dark',
      links: 'sources',
    });
    expect(scriptOptions(data({}))).toEqual({});
    expect(scriptOptions(data({ 'data-links': 'some' }))).toEqual({});
    expect(scriptOptions(data({ 'data-launcher': 'true' }))).toEqual({ launcher: true });
  });

  it('turns the shortcut and the button off with "false", and skips what it cannot read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      scriptOptions(
        data({
          'data-shortcut': 'false',
          'data-launcher': '',
          'data-theme': 'sepia',
          'data-suggestions': 'How do I install it?',
        }),
      ),
    ).toEqual({ shortcut: false, launcher: false });
    expect(scriptOptions(data({ 'data-launcher': 'false' }))).toEqual({ launcher: false });
    expect(scriptOptions(data({ 'data-suggestions': '[1, 2]' }))).toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain('data-suggestions must be a JSON array of strings');
  });
});

describe('mountAskDialog', () => {
  it('renders the launcher and the dialog into a container of its own, and removes them', async () => {
    const dialog = mount({ title: 'Ask Acme', suggestions: ['How do I install it?'] });
    const container = document.querySelector('body > .ondocs');
    expect(container).not.toBeNull();
    const launcher = screen.getByRole('button', { name: 'Ask AI' });
    expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');

    await userEvent.click(launcher);
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    act(() => {
      dialog.close();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    act(() => {
      dialog.open();
    });
    expect(await screen.findByRole('option', { name: 'How do I install it?' })).toBeTruthy();

    act(() => {
      dialog.unmount();
    });
    expect(document.querySelector('.ondocs')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders into a given container, which unmount leaves in place', async () => {
    const container = document.createElement('section');
    document.body.append(container);
    const dialog = mount({ container, launcher: false, shortcut: 'j' });
    expect(container.querySelector('.ondocs-launcher')).toBeNull();
    await userEvent.keyboard('{Control>}j{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Ask this site' })).toBeTruthy();
    act(() => {
      dialog.unmount();
    });
    expect(container.isConnected).toBe(true);
  });

  it('follows <html data-theme>, then the system’s color scheme, live', async () => {
    const dark = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => dark),
    );
    mount();
    const launcher = screen.getByRole('button', { name: 'Ask AI' });
    // No data-theme: the system's.
    expect(launcher.dataset.askTheme).toBe('dark');
    act(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await waitFor(() => {
      expect(launcher.dataset.askTheme).toBe('light');
    });
    // A theme the embed does not know: the system's again.
    act(() => {
      document.documentElement.dataset.theme = 'ocean';
    });
    await waitFor(() => {
      expect(launcher.dataset.askTheme).toBe('dark');
    });
    expect(dark.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('keeps a pinned theme', () => {
    document.documentElement.dataset.theme = 'dark';
    mount({ theme: 'light' });
    expect(screen.getByRole('button', { name: 'Ask AI' }).dataset.askTheme).toBe('light');
  });

  it('puts its container back after Astro’s client router swaps the page', () => {
    mount();
    const container = document.querySelector('.ondocs')!;
    document.body.replaceChildren();
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(container.isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeTruthy();
  });

  it('hands citations to onNavigate with the DOM event', async () => {
    const onNavigate = vi.fn((_url: string, event: MouseEvent) => {
      event.preventDefault();
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            [
              { type: 'start', messageMetadata: { refused: false, retrieval: 'keyword' } },
              { type: 'source-url', sourceId: '1', url: '/guides/setup/#install', title: 'Setup' },
              { type: 'text-delta', id: 'a', delta: 'Run the installer [1].' },
              { type: 'finish' },
            ]
              .map((part) => `data: ${JSON.stringify(part)}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        ),
      ),
    );
    mount({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    await userEvent.type(await screen.findByRole('combobox'), 'How do I install it?{Enter}');
    const citation = await screen.findByRole('link', { name: /^Source 1:/ });
    await userEvent.click(citation);
    expect(onNavigate).toHaveBeenCalledWith('/guides/setup/#install', expect.any(MouseEvent));
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/ask');
  });
});

describe('dist/embed.global.js', () => {
  /** Runs the script entry as if from `<script>` with these attributes. */
  async function runScript(attributes: Record<string, string>) {
    const script = document.createElement('script');
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    document.head.append(script);
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
    vi.resetModules();
    await act(async () => {
      await import('../src/embed/global');
    });
  }

  afterEach(() => {
    act(() => {
      document.querySelector('.ondocs')?.remove();
    });
    delete window.Ondocs;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- its name from before ondocs
    delete window.AskMySite;
  });

  it('mounts from its own tag’s data-* attributes, and injects its styles once', async () => {
    await runScript({ 'data-launcher': 'Ask the docs', 'data-shortcut': 'j' });
    const launcher = screen.getByRole('button', { name: 'Ask the docs' });
    expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Meta+J Control+J');
    expect(document.head.firstElementChild?.id).toBe('ondocs-styles');
    act(() => {
      window.Ondocs?.mount({ container: document.createElement('div') });
    });
    expect(document.querySelectorAll('#ondocs-styles')).toHaveLength(1);
  });

  it('leaves mounting to window.Ondocs.mount with data-manual', async () => {
    await runScript({ 'data-manual': '' });
    expect(document.querySelector('.ondocs')).toBeNull();
    let dialog!: MountedAskDialog;
    act(() => {
      dialog = window.Ondocs!.mount({ launcher: 'Ask' });
    });
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    act(() => {
      dialog.unmount();
    });
  });

  it('starts the dialog’s input with what was typed while its script loaded, unasked', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await runScript({ 'data-manual': '' });
    let dialog!: MountedAskDialog;
    act(() => {
      dialog = window.Ondocs!.mount();
    });
    try {
      const user = userEvent.setup();
      await user.keyboard('{Meta>}i{/Meta}How do');
      // The dialog's script arrives, which jsdom does not load itself.
      const tag = document.querySelector('script[src$="embed-dialog.global.js"]');
      expect(tag).not.toBeNull();
      const { render } = await import('../src/embed/dialog');
      await act(async () => {
        window.OndocsDialog = { render };
        tag?.dispatchEvent(new Event('load'));
        await Promise.resolve();
      });
      const input = await screen.findByRole<HTMLInputElement>('combobox');
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
      });
      await user.keyboard(' I install it?');
      expect(input.value).toBe('How do I install it?');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      act(() => {
        dialog.unmount();
      });
      delete window.OndocsDialog;
    }
  });

  /* eslint-disable @typescript-eslint/no-deprecated -- the name from before ondocs, on purpose */
  it('keeps window.AskMySite, its name before ondocs, and says once to use window.Ondocs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await runScript({ 'data-manual': '' });
    expect(warn).not.toHaveBeenCalled();
    expect(window.AskMySite).toBe(window.Ondocs);
    let dialog!: MountedAskDialog;
    act(() => {
      dialog = window.AskMySite!.mount({ launcher: 'Ask' });
    });
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(warn.mock.calls).toEqual([
      ['[ondocs] window.AskMySite is now window.Ondocs; the old name still works for now.'],
    ]);
    act(() => {
      dialog.unmount();
    });
  });
  /* eslint-enable @typescript-eslint/no-deprecated */
});
