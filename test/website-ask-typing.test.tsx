// @vitest-environment jsdom
// ⌘K on the website (examples/nextjs/components/ask.tsx) and the question straight after it,
// before the page has been idle. The site loaded its dialog through next/dynamic once the page was
// idle, or on the first ⌘K or ⌘I, and what was typed while that code came went nowhere: "I roll
// back a release?" on ondocs.vercel.app. The library's dialog code (Radix, cmdk, the answer) still
// loads on the first open; its import is held here until the test lets it arrive.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { arrival, navigation } = vi.hoisted(() => {
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  // The site's own next, as its components import it, which this folder can't resolve by name.
  const { createRequire } = process.getBuiltinModule('node:module');
  const require = createRequire(`${import.meta.dirname}/../examples/nextjs/package.json`);
  return { arrival: { arrived, arrive }, navigation: require.resolve('next/navigation') };
});

vi.mock(navigation, () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../src/react/dialog-panel', async (original) => {
  await arrival.arrived;
  return original();
});

const { Ask } = await import('../examples/nextjs/components/ask');
const { loadAskDialog } = await import('../src/react');

const QUESTION = 'How do I roll back a release?';

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
  vi.unstubAllGlobals();
});

describe('typing straight after ⌘K on the website', () => {
  it('keeps every key, from before the dialog’s code is there, and asks nothing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<Ask mode="mock" />);
    await user.keyboard(`{Meta>}k{/Meta}${QUESTION}`);
    await act(async () => {
      arrival.arrive();
      await loadAskDialog();
    });
    const input = await screen.findByRole<HTMLInputElement>('combobox');
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(input.value).toBe(QUESTION);
    expect(fetch).not.toHaveBeenCalled();
  });
});
