// @vitest-environment jsdom
// `AskButton` from ondocs/react: the "Ask AI" button with the dialog's shortcut on it, and the
// dialog behind it, which ondocs's own site and the sibling sites each wrote by hand. And the
// dialog's opt-in `poweredBy` credit line. The endpoint repeats each question back.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openAskDialog } from '../src/embed';
import * as react from '../src/react';
import { AskButton, type AskButtonProps } from '../src/react';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('data-ondocs-mac');
});

/** An endpoint that answers each question by repeating it, recording what it was asked. */
function answering(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        question?: string;
        messages?: { parts: { text: string }[] }[];
      };
      const question = body.question ?? body.messages?.at(-1)?.parts[0]?.text ?? '';
      asked.push(question);
      return Promise.resolve(
        new Response(
          [
            { type: 'start', messageMetadata: { refused: false, retrieval: 'keyword' } },
            { type: 'text-delta', id: 'a', delta: `You asked: ${question}` },
            { type: 'finish' },
          ]
            .map((part) => `data: ${JSON.stringify(part)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    }),
  );
  return asked;
}

describe('AskButton', () => {
  it('is part of ondocs/react', () => {
    expect(typeof react.AskButton).toBe('function');
  });

  it('renders the plugins’ navbar button: its label, and the shortcut for ondocs/embed/button.css', () => {
    render(<AskButton />);
    const button = screen.getByRole('button', { name: 'Ask AI' });
    expect(button.className).toBe('ondocs-button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');
    expect(button.querySelector('.ondocs-button-label')?.textContent).toBe('Ask AI');
    const kbd = button.querySelector('kbd');
    expect(kbd?.getAttribute('aria-hidden')).toBe('true');
    expect(kbd?.getAttribute('data-control')).toBe('Ctrl');
    expect(kbd?.textContent).toBe('I');
    // No dialog, and none of its code, until it is wanted.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes a label, class names, a shortcut and the labels’ words', () => {
    const { rerender } = render(
      <AskButton shortcut="k" className="header-ask">
        Ask the docs
      </AskButton>,
    );
    const button = screen.getByRole('button', { name: 'Ask the docs' });
    expect(button.className).toBe('ondocs-button header-ask');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
    expect(button.querySelector('kbd')?.textContent).toBe('K');

    rerender(<AskButton shortcut={false} labels={{ launcher: 'Demander', controlKey: 'Strg' }} />);
    const own = screen.getByRole('button', { name: 'Demander' });
    expect(own.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(own.querySelector('kbd')).toBeNull();
    rerender(<AskButton labels={{ controlKey: 'Strg' }} />);
    expect(screen.getByRole('button').querySelector('kbd')?.getAttribute('data-control')).toBe(
      'Strg',
    );
  });

  it('marks <html> on Apple devices, where the stylesheet shows ⌘ for Ctrl', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<AskButton />);
    expect(document.documentElement.hasAttribute('data-ondocs-mac')).toBe(true);
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    render(<AskButton />);
    expect(document.documentElement.hasAttribute('data-ondocs-mac')).toBe(false);
  });

  it('opens the dialog on a click, and gives focus back when it closes', async () => {
    const user = userEvent.setup();
    render(<AskButton title="Ask Acme" />);
    const button = screen.getByRole('button', { name: 'Ask AI' });
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(button);
  });

  it('opens the dialog with its shortcut, ⌘K here, and closes it with the same keys', async () => {
    const user = userEvent.setup();
    render(<AskButton shortcut="k" title="Ask Acme" />);
    await user.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    await user.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Ctrl+K elsewhere.
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
  });

  it('opens from openAskDialog() and data-ondocs-open elsewhere on the page, with a question', async () => {
    const asked = answering();
    const user = userEvent.setup();
    render(
      <>
        <AskButton title="Ask Acme" />
        <button type="button" data-ondocs-open="Do I need a database?">
          Do I need a database?
        </button>
      </>,
    );
    act(() => {
      openAskDialog();
    });
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    expect(asked).toEqual([]);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Do I need a database?' }));
    expect(await screen.findByText('You asked: Do I need a database?')).toBeTruthy();
    act(() => {
      openAskDialog('How do I deploy it?');
    });
    expect(await screen.findByText('You asked: How do I deploy it?')).toBeTruthy();
    expect(asked).toEqual(['Do I need a database?', 'How do I deploy it?']);
  });

  it('stops listening for openAskDialog() once it is unmounted', () => {
    const { unmount } = render(<AskButton />);
    unmount();
    act(() => {
      openAskDialog();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a controlled open state with the parent, and tells it when something opens it', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<AskButton open={false} onOpenChange={onOpenChange} />);
    act(() => {
      openAskDialog();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    // The parent has not opened it.
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<AskButton open onOpenChange={onOpenChange} title="Ask Acme" />);
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
  });

  it('renders on the server, and hydrates without a mismatch', () => {
    const html = renderToString(<AskButton shortcut="k">Ask the docs</AskButton>);
    expect(html).toContain('class="ondocs-button"');
    expect(html).toContain('<span class="ondocs-button-label">Ask the docs</span>');
    expect(html).toContain('data-control="Ctrl"');
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    act(() => {
      hydrateRoot(container, <AskButton shortcut="k">Ask the docs</AskButton>, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(document.documentElement.hasAttribute('data-ondocs-mac')).toBe(true);
  });
});

/** Opens the dialog behind an `AskButton` and returns its footer. */
async function footer(props: AskButtonProps = {}): Promise<HTMLElement> {
  render(<AskButton defaultOpen {...props} />);
  const dialog = await screen.findByRole('dialog');
  const element = dialog.querySelector<HTMLElement>('.ask-footer');
  if (!element) throw new Error('The dialog has no footer.');
  return element;
}

describe('poweredBy', () => {
  it('is off by default', async () => {
    const element = await footer();
    expect(within(element).queryByRole('link')).toBeNull();
    expect(element.textContent).not.toContain('ondocs');
  });

  it('adds a credit line to the footer, its link to ondocs’s site in a new tab', async () => {
    const element = await footer({ poweredBy: true });
    expect(element.textContent).toContain(
      'Answers come from this site and can be wrong. Check the sources. Answers by ondocs.',
    );
    const link = within(element).getByRole('link', { name: 'ondocs' });
    expect(link.getAttribute('href')).toBe('https://ondocs.vercel.app');
    expect(link.getAttribute('target')).toBe('_blank');
    // noopener, but the referrer stays, so ondocs's site can tell where its visitors came from.
    expect(link.getAttribute('rel')).toBe('noopener');
    const dialog = screen.getByRole('dialog');
    expect((await axe.run(dialog)).violations.map((v) => v.id)).toEqual([]);
  });

  it('takes the line in the site’s own words, with {ondocs} where the link goes', async () => {
    const element = await footer({
      poweredBy: 'Answers and docs MCP by {ondocs}.',
      labels: { footer: 'Answers can be wrong: check the sources.' },
    });
    expect(element.textContent).toContain(
      'Answers can be wrong: check the sources. Answers and docs MCP by ondocs.',
    );
    expect(within(element).getByRole('link', { name: 'ondocs' })).toBeTruthy();
    cleanup();

    // Without {ondocs}, the whole line is the link.
    const whole = await footer({ poweredBy: 'Réponses par ondocs' });
    expect(
      within(whole).getByRole('link', { name: 'Réponses par ondocs' }).getAttribute('href'),
    ).toBe('https://ondocs.vercel.app');
  });

  it('stays out of a footer of the site’s own, which replaces the line too', async () => {
    render(
      <AskButton defaultOpen poweredBy footer={<p className="own-footer">Our own footer</p>} />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Our own footer')).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: 'ondocs' })).toBeNull();
  });
});
