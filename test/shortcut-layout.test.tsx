// @vitest-environment jsdom
// ⌘/Ctrl+I on keyboard layouts that type no Latin letters. On a Russian layout, Ctrl+I types "ш"
// (code KeyI), and both shortcut handlers compared only the character, so the shortcut the button
// shows did nothing there. Dvorak types Latin letters in other places, so it keeps going by the
// character: its key in I's place types C, and Ctrl+C must still copy.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { mountAskDialog, type MountedAskDialog } from '../src/embed';
import { AskDialog } from '../src/react';

beforeAll(() => {
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

const mounted: MountedAskDialog[] = [];
afterEach(() => {
  for (const dialog of mounted.splice(0)) {
    act(() => {
      dialog.unmount();
    });
  }
  cleanup();
  document.body.replaceChildren();
});

/** Ctrl and the key that types `key`, at `code`'s place, as the layout reports it. */
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

const expanded = () => screen.getByRole('button', { name: /Ask AI/ }).getAttribute('aria-expanded');

describe('the shortcut on other keyboard layouts', () => {
  for (const [name, start] of [
    [
      'the embed (Starlight, VitePress, the script tag)',
      () => {
        act(() => {
          mounted.push(mountAskDialog({ endpoint: '/api/ask' }));
        });
      },
    ],
    [
      'AskDialog (Docusaurus, React)',
      () => {
        render(<AskDialog launcher fetch={vi.fn()} />);
      },
    ],
  ] as const) {
    it(`opens and closes ${name} on Ctrl+I from a Russian or Greek layout`, () => {
      start();
      expect(expanded()).toBe('false');
      expect(press('ш', 'KeyI').defaultPrevented).toBe(true);
      expect(expanded()).toBe('true');
      press('ι', 'KeyI');
      expect(expanded()).toBe('false');
    });

    it(`leaves Ctrl+C to Dvorak, whose key in I's place types C, in ${name}`, () => {
      start();
      expect(press('c', 'KeyI').defaultPrevented).toBe(false);
      expect(expanded()).toBe('false');
      // Dvorak's I, in G's place.
      press('i', 'KeyG');
      expect(expanded()).toBe('true');
    });
  }
});
