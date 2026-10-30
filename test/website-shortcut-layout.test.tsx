// @vitest-environment jsdom
// The website's own ⌘K and ⌘I (examples/nextjs/components/ask.tsx) on a layout that types no
// Latin letters, as the library's shortcut takes them (test/shortcut-layout.test.tsx): Ctrl+K on a
// Russian layout types "л" (code KeyK). Dvorak's key in K's place types T, which opens nothing,
// and so do AltGr and Option, which type other characters from the same place.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { navigation } = vi.hoisted(() => {
  // The site's own next, as its components import it, which this folder can't resolve by name.
  const { createRequire } = process.getBuiltinModule('node:module');
  const require = createRequire(`${import.meta.dirname}/../examples/nextjs/package.json`);
  return { navigation: require.resolve('next/navigation') };
});

vi.mock(navigation, () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { Ask } = await import('../examples/nextjs/components/ask');
const { loadAskDialog } = await import('../src/react');

beforeAll(async () => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
  await loadAskDialog();
});

afterEach(() => {
  cleanup();
});

/** Ctrl (or `modifiers`) and the key that types `key`, at `code`'s place. */
function press(key: string, code: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code,
    ctrlKey: true,
    ...modifiers,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('the website’s shortcuts on other keyboard layouts', () => {
  it('open the dialog on Ctrl+K and Ctrl+I from a Russian layout, and leave Dvorak’s T alone', () => {
    render(<Ask mode="mock" />);
    expect(press('е', 'KeyT').defaultPrevented).toBe(false);
    expect(press('t', 'KeyK').defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(press('л', 'KeyK').defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    press('ш', 'KeyI');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leave the characters AltGr and Option type from K’s and I’s places to the page', () => {
    render(<Ask mode="mock" />);
    // AltGr is Ctrl and Alt: í on US International; ⌘⌥I on a Mac is a dead key.
    expect(press('í', 'KeyI', { altKey: true }).defaultPrevented).toBe(false);
    expect(
      press('Dead', 'KeyI', { ctrlKey: false, metaKey: true, altKey: true }).defaultPrevented,
    ).toBe(false);
    // ˚ is Option+K on a Mac's US layout.
    expect(
      press('˚', 'KeyK', { ctrlKey: false, metaKey: true, altKey: true }).defaultPrevented,
    ).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Open, the dialog stays open as í is typed in its input.
    press('л', 'KeyK');
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(press('í', 'KeyI', { altKey: true }).defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});
