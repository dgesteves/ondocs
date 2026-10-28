// @vitest-environment jsdom
// The dialog's options renamed in 0.9: each old name still works, does what its new name does,
// and says once what it is called now. The shortcut is ⌘I or Ctrl+I everywhere, and `auto` means
// the same in React as in the script embed and the plugins.
/* eslint-disable @typescript-eslint/no-deprecated -- these tests pass the old names on purpose */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { REMOVED_IN, resetDeprecationWarnings } from '../src/deprecation';
import { mountAskDialog, type MountAskDialogOptions, type MountedAskDialog } from '../src/embed';
import { scriptOptions } from '../src/embed/script';
import { AskDialog } from '../src/react';

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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetDeprecationWarnings();
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

const warning = (old: string, current: string): string =>
  `[ondocs] ${old} is now ${current}. The old name still works until ${REMOVED_IN}.`;

describe('mountAskDialog and window.Ondocs.mount: buttonLabel is now launcher', () => {
  /** The label of the launcher button `options` render, or null without one. */
  function launcherOf(options: MountAskDialogOptions): string | null {
    let dialog!: MountedAskDialog;
    act(() => {
      dialog = mountAskDialog(options);
    });
    const button = document.querySelector('.ondocs-launcher');
    button?.querySelector('kbd')?.remove();
    const label = button?.textContent ?? null;
    act(() => {
      dialog.unmount();
    });
    return label;
  }

  it('renders the same button under either name, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shown = launcherOf({ launcher: 'Ask the docs' });
    const byDefault = launcherOf({});
    const fromLabels = launcherOf({ launcher: true, labels: { launcher: 'Demander' } });
    expect(launcherOf({ launcher: false })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect([shown, byDefault, fromLabels]).toEqual(['✦ Ask the docs', '✦ Ask AI', '✦ Demander']);
    // The name before 0.9.
    expect(launcherOf({ buttonLabel: 'Ask the docs' })).toBe(shown);
    expect(launcherOf({ buttonLabel: false })).toBeNull();
    // `launcher` wins when both are given.
    expect(launcherOf({ launcher: 'Ask the docs', buttonLabel: false })).toBe(shown);
    expect(warn.mock.calls).toEqual([[warning('buttonLabel', 'launcher')]]);
  });
});

describe('the script tag: data-button-label is now data-launcher', () => {
  const data = (attributes: Record<string, string>) => {
    const script = document.createElement('script');
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    return script.dataset;
  };

  it('reads the same options from either attribute, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(scriptOptions(data({ 'data-launcher': 'Ask' }))).toEqual({ launcher: 'Ask' });
    expect(scriptOptions(data({ 'data-launcher': 'false' }))).toEqual({ launcher: false });
    expect(warn).not.toHaveBeenCalled();

    expect(scriptOptions(data({ 'data-button-label': 'Ask' }))).toEqual({ launcher: 'Ask' });
    expect(scriptOptions(data({ 'data-button-label': 'false' }))).toEqual({ launcher: false });
    expect(scriptOptions(data({ 'data-button-label': '' }))).toEqual({ launcher: false });
    // `data-launcher` wins when both are given.
    expect(scriptOptions(data({ 'data-button-label': 'Old', 'data-launcher': 'Ask' }))).toEqual({
      launcher: 'Ask',
    });
    expect(warn.mock.calls).toEqual([[warning('data-button-label', 'data-launcher')]]);
  });
});

describe('AskDialog: theme="system" is now theme="auto", which follows <html data-theme>', () => {
  const themeOf = () => document.querySelector<HTMLElement>('.ondocs-launcher')?.dataset.askTheme;

  it('renders "system" as "auto", and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { rerender } = render(<AskDialog launcher fetch={vi.fn()} />);
    // Without <html data-theme>, the stylesheet follows prefers-color-scheme.
    expect(themeOf()).toBeUndefined();
    rerender(<AskDialog launcher theme="auto" fetch={vi.fn()} />);
    expect(themeOf()).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    rerender(<AskDialog launcher theme="system" fetch={vi.fn()} />);
    expect(themeOf()).toBeUndefined();
    act(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await waitFor(() => {
      expect(themeOf()).toBe('dark');
    });
    rerender(<AskDialog launcher theme="auto" fetch={vi.fn()} />);
    expect(themeOf()).toBe('dark');
    rerender(<AskDialog launcher theme="system" fetch={vi.fn()} />);
    expect(themeOf()).toBe('dark');
    expect(warn.mock.calls).toEqual([[warning('theme="system"', 'theme="auto"')]]);
  });

  it('follows <html data-theme> live with auto, the dialog too, and pins light or dark', async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.theme = 'light';
    const { rerender } = render(<AskDialog launcher fetch={vi.fn()} />);
    expect(themeOf()).toBe('light');
    await user.click(screen.getByRole('button', { name: /Ask AI/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.dataset.askTheme).toBe('light');
    act(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await waitFor(() => {
      expect([themeOf(), dialog.dataset.askTheme]).toEqual(['dark', 'dark']);
    });
    // A value other than light or dark leaves it to prefers-color-scheme.
    act(() => {
      document.documentElement.dataset.theme = 'sepia';
    });
    await waitFor(() => {
      expect([themeOf(), dialog.dataset.askTheme]).toEqual([undefined, undefined]);
    });
    rerender(<AskDialog launcher theme="light" fetch={vi.fn()} />);
    expect([themeOf(), dialog.dataset.askTheme]).toEqual(['light', 'light']);
  });
});

describe('AskDialog’s shortcut', () => {
  it('is ⌘I or Ctrl+I, as in the plugins and the script embed; "k" gives ⌘K back', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AskDialog launcher fetch={vi.fn()} />);
    expect(screen.getByRole('button').getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');
    await user.keyboard('{Meta>}k{/Meta}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('{Control>}i{/Control}');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    rerender(<AskDialog launcher shortcut="k" fetch={vi.fn()} />);
    expect(screen.getByRole('button').getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
    await user.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
