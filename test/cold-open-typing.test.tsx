// @vitest-environment jsdom
// ⌘I and the question straight after it, on a React host: the dialog's code is still on its way
// when the first keys come, and they used to go nowhere. Its import is held here until the test
// lets it arrive. The module is imported once per test file, so the first test is the cold open.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const arrival = vi.hoisted(() => {
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return { arrived, arrive };
});
vi.mock('../src/react/dialog-panel', async (original) => {
  await arrival.arrived;
  return original();
});

const { AskDialog, AskButton, loadAskDialog } = await import('../src/react');

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
  document.body.replaceChildren();
});

/** The dialog's input, once it has focus. */
async function focusedInput(): Promise<HTMLInputElement> {
  const input = await screen.findByRole<HTMLInputElement>('combobox');
  await waitFor(() => {
    expect(document.activeElement).toBe(input);
  });
  return input;
}

describe('typing before the dialog is there, on a React host', () => {
  it('starts the input with what was typed while its code loaded, and does not ask it', async () => {
    const fetch = vi.fn();
    const user = userEvent.setup();
    render(<AskDialog launcher fetch={fetch} />);
    await user.keyboard('{Meta>}i{/Meta}How dp{Backspace}o');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      arrival.arrive();
      await loadAskDialog();
    });
    const input = await focusedInput();
    expect(input.value).toBe('How do');
    await user.keyboard(' I roll back a release?');
    expect(input.value).toBe('How do I roll back a release?');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps what is typed as AskButton’s dialog opens, the first time and again', async () => {
    const user = userEvent.setup();
    render(<AskButton fetch={vi.fn()} />);
    await user.keyboard('{Meta>}i{/Meta}How');
    expect((await focusedInput()).value).toBe('How');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Opened again, the input has its text from before, selected, and typing replaces it.
    await user.keyboard('{Meta>}i{/Meta}Is it free?');
    expect((await focusedInput()).value).toBe('Is it free?');
  });

  it('leaves the dialog’s own buttons their keys', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<AskDialog fetch={vi.fn()} onOpenChange={onOpenChange} />);
    await user.keyboard('{Meta>}i{/Meta}');
    await focusedInput();
    // From the input to the Close button: Space presses it, as it would anywhere.
    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    await user.keyboard(' ');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
