// @vitest-environment jsdom
// The dialog's code loads on first use, not with the page: what each page carries is the button
// and the shortcut. These tests count when the dialog's module is imported, and check that what
// the visitor does before it arrives is kept.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const imported = vi.hoisted(() => vi.fn());
vi.mock('../src/react/dialog-panel', async (original) => {
  imported();
  return original();
});

const { AskDialog, loadAskDialog } = await import('../src/react');
const { mountWithLoader } = await import('../src/embed/mount');
type Renderer = Awaited<
  Parameters<typeof mountWithLoader>[1] extends () => Promise<infer R> ? Promise<R> : never
>;

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

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('AskDialog loads the dialog on first use', () => {
  // The module is imported once per test file, so the order of these tests matters: the first
  // checks that nothing loads before intent.
  it('renders the button without the dialog’s code, and loads it on a pointer over the button', async () => {
    render(<AskDialog launcher fetch={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Ask AI/ });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(imported).not.toHaveBeenCalled();
    fireEvent.pointerEnter(button);
    await waitFor(() => {
      expect(imported).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog in the same render as the open once its code is there', async () => {
    // Its code came with the pointer over the button. Behind Suspense, the dialog's first render
    // still waited for React to reveal it, about 300 ms on a real page.
    await loadAskDialog();
    render(<AskDialog fetch={vi.fn()} />);
    act(() => {
      fireEvent.keyDown(window, { key: 'i', metaKey: true });
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('opens on the shortcut, focuses the input, and gives focus back on Escape', async () => {
    const user = userEvent.setup();
    render(
      <>
        <a href="/docs">Docs</a>
        <AskDialog launcher fetch={vi.fn()} />
      </>,
    );
    const link = screen.getByRole('link', { name: 'Docs' });
    link.focus();
    await user.keyboard('{Meta>}i{/Meta}');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement?.className).toContain('ask-input');
    });
    // The page behind the open dialog is hidden from assistive tech, the button with it.
    expect(document.querySelector('.ondocs-launcher')?.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(dialog.isConnected).toBe(false);
    });
    expect(document.activeElement).toBe(link);
  });

  it('gives focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<AskDialog launcher fetch={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Ask AI/ });
    await user.click(button);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(button);
  });

  it('keeps a custom trigger’s own handlers, and opens unless they prevent it', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <AskDialog
        fetch={vi.fn()}
        trigger={
          <button type="button" onClick={onClick}>
            Search
          </button>
        }
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Search' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    await user.click(trigger);
    expect(onClick).toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    cleanup();
    render(
      <AskDialog
        fetch={vi.fn()}
        trigger={
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
            }}
          >
            Search
          </button>
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the embed loads the dialog on first use', () => {
  /** A loader whose dialog arrives when the test says, and records how it is rendered. */
  function deferredLoader() {
    let resolve!: (renderer: Renderer) => void;
    const renders: { open: boolean }[] = [];
    const setOpen = vi.fn();
    const renderer = {
      render: vi.fn((_element: Element, options: { open: boolean }) => {
        renders.push({ open: options.open });
        return { setOpen, unmount: vi.fn() };
      }),
    } as unknown as Renderer;
    const load = vi.fn(
      () =>
        new Promise<Renderer>((done) => {
          resolve = done;
        }),
    );
    /** Lets the dialog's code arrive, and the loader's promise settle. */
    const arrive = async (): Promise<void> => {
      await act(async () => {
        resolve(renderer);
        await Promise.resolve();
      });
    };
    return { load, renders, setOpen, arrive, renderer };
  }

  it('loads nothing until the button is pointed at or focused', () => {
    const { load } = deferredLoader();
    const mounted = mountWithLoader({}, load);
    expect(load).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: /Ask AI/ });
    fireEvent.pointerEnter(button);
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.focus(button);
    expect(load).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it('queues a shortcut pressed before the dialog has loaded, and opens it once it has', async () => {
    const { load, renders, arrive } = deferredLoader();
    const mounted = mountWithLoader({}, load);
    fireEvent.keyDown(window, { key: 'i', metaKey: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Ask AI/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    await arrive();
    expect(renders).toEqual([{ open: true }]);
    mounted.unmount();
  });

  it('opens closed when the shortcut was pressed twice, or Escape came, before it loaded', async () => {
    for (const second of [{ key: 'i', metaKey: true }, { key: 'Escape' }]) {
      const { load, renders, arrive } = deferredLoader();
      const mounted = mountWithLoader({}, load);
      fireEvent.keyDown(window, { key: 'i', metaKey: true });
      fireEvent.keyDown(window, second);
      await arrive();
      expect([second.key, renders]).toEqual([second.key, [{ open: false }]]);
      mounted.unmount();
    }
  });

  it('leaves the shortcut to text fields, and renders nothing once unmounted', async () => {
    const { load, renders, arrive } = deferredLoader();
    const input = document.createElement('input');
    document.body.append(input);
    const mounted = mountWithLoader({}, load);
    fireEvent.keyDown(input, { key: 'i', metaKey: true });
    expect(load).not.toHaveBeenCalled();
    mounted.open();
    mounted.unmount();
    await arrive();
    expect(renders).toEqual([]);
    expect(document.querySelector('.ondocs')).toBeNull();
  });

  it('passes open and close through to the dialog once it is there', async () => {
    const { load, setOpen, arrive } = deferredLoader();
    const mounted = mountWithLoader({ launcher: false, shortcut: false }, load);
    expect(document.querySelector('.ondocs-launcher')).toBeNull();
    mounted.open();
    await arrive();
    mounted.close();
    expect(setOpen).toHaveBeenLastCalledWith(false);
    mounted.unmount();
  });
});

describe('what is typed while the embed’s dialog loads', () => {
  let mounted: ReturnType<typeof mountWithLoader> | undefined;
  afterEach(() => {
    act(() => {
      mounted?.unmount();
    });
    mounted = undefined;
  });

  /** A loader for the real dialog, whose code arrives when the test says. */
  function slowDialog() {
    let resolve!: () => void;
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    const load = vi.fn(() => ready.then(() => import('../src/embed/dialog')));
    const arrive = async (): Promise<HTMLInputElement> => {
      await act(async () => {
        resolve();
        await ready;
      });
      const input = await screen.findByRole<HTMLInputElement>('combobox');
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
      });
      return input;
    };
    return { load, arrive };
  }

  it('starts the input with it, Backspace included, and does not ask it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const { load, arrive } = slowDialog();
    mounted = mountWithLoader({}, load);
    await user.keyboard('{Meta>}i{/Meta}How dp{Backspace}o');
    const input = await arrive();
    expect(input.value).toBe('How do');
    await user.keyboard(' I roll back a release?');
    expect(input.value).toBe('How do I roll back a release?');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps it from the page, and leaves text fields and shortcuts alone', async () => {
    const user = userEvent.setup();
    const field = document.createElement('input');
    document.body.append(field);
    const page = vi.fn();
    window.addEventListener('keydown', page);
    const { load, arrive } = slowDialog();
    mounted = mountWithLoader({}, load);
    try {
      await user.keyboard('{Meta>}i{/Meta}Ho {Control>}c{/Control}');
      // Keys in an IME's composition make no characters of their own.
      fireEvent.keyDown(document.body, { key: 'Process', isComposing: true });
      fireEvent.keyDown(document.body, { key: 'n', isComposing: true });
      // The page's own handlers see the shortcut and the copy, not the question: a Space there
      // would scroll it, and a "/" open its search.
      expect(page.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual([
        'Meta',
        'i',
        'Control',
        'c',
        'Process',
        'n',
      ]);
      // Typing that has a field of its own goes there, as before.
      field.focus();
      await user.keyboard('w');
      expect(field.value).toBe('w');
      const input = await arrive();
      expect(input.value).toBe('Ho ');
    } finally {
      window.removeEventListener('keydown', page);
    }
  });

  it('drops it when the dialog is closed before it is there', async () => {
    const user = userEvent.setup();
    const { load, arrive } = slowDialog();
    mounted = mountWithLoader({}, load);
    await user.keyboard('{Meta>}i{/Meta}How{Escape}');
    // Closed, the page has its keys back.
    const page = vi.fn();
    window.addEventListener('keydown', page);
    await user.keyboard('x');
    window.removeEventListener('keydown', page);
    expect(page).toHaveBeenCalledTimes(1);
    await user.keyboard('{Meta>}i{/Meta}');
    const input = await arrive();
    expect(input.value).toBe('');
  });

  it('gives the page its keys back when the dialog cannot load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    let fail!: (reason: Error) => void;
    const load = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          fail = reject;
        }),
    );
    mounted = mountWithLoader({}, load);
    await user.keyboard('{Meta>}i{/Meta}');
    const page = vi.fn();
    window.addEventListener('keydown', page);
    try {
      await user.keyboard('a');
      expect(page).not.toHaveBeenCalled();
      await act(async () => {
        fail(new Error('Offline'));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(error).toHaveBeenCalledWith('[ondocs] The dialog could not load.', expect.any(Error));
      await user.keyboard(' ');
      expect(page).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', page);
    }
  });

  it('gives way to a question the dialog is opened with', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        asked.push((JSON.parse(init?.body as string) as { question: string }).question);
        return Promise.resolve(new Response('', { status: 500 }));
      }),
    );
    const user = userEvent.setup();
    const { load, arrive } = slowDialog();
    mounted = mountWithLoader({}, load);
    await user.keyboard('{Meta>}i{/Meta}How');
    act(() => {
      mounted?.open('How do I deploy it?');
    });
    const input = await arrive();
    expect(input.value).toBe('How do I deploy it?');
    expect(asked).toEqual(['How do I deploy it?']);
  });
});
