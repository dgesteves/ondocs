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

const { AskDialog } = await import('../src/react');
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
