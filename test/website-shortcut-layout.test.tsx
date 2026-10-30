// @vitest-environment jsdom
// The website's own ⌘K and ⌘I (examples/nextjs/components/ask.tsx) on a layout that types no
// Latin letters, as the library's shortcut takes them (test/shortcut-layout.test.tsx): Ctrl+K on a
// Russian layout types "л" (code KeyK). Dvorak's key in K's place types T, which opens nothing.
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

/** Ctrl and the key that types `key`, at `code`'s place. */
function press(key: string, code: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code,
    ctrlKey: true,
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
});
