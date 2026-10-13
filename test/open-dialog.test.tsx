// @vitest-environment jsdom
// Opening the dialog from outside it, with a question or without: `openAskDialog()`, the
// controls `mountAskDialog` returns, `window.Ondocs.open()`, any element with `data-ondocs-open`,
// and `AskDialog`'s `question` prop, which they all come down to.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { mountAskDialog, openAskDialog, type MountedAskDialog } from '../src/embed';
import { mountWithLoader, type DialogRenderer } from '../src/embed/mount';
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

/**
 * An endpoint that answers each question by repeating it, recording the questions asked and how
 * many earlier turns each was sent with (a follow-up sends the thread as `messages`).
 */
function answering(): { asked: string[]; threads: number[] } {
  const asked: string[] = [];
  const threads: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        question?: string;
        messages?: { parts: { text: string }[] }[];
      };
      const question = body.question ?? body.messages?.at(-1)?.parts[0]?.text ?? '';
      asked.push(question);
      threads.push(body.messages ? (body.messages.length - 1) / 2 : 0);
      const reply = `You asked: ${question}`;
      return Promise.resolve(
        new Response(
          [
            { type: 'start', messageMetadata: { refused: false, retrieval: 'keyword' } },
            { type: 'text-delta', id: 'a', delta: reply },
            { type: 'finish' },
          ]
            .map((part) => `data: ${JSON.stringify(part)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    }),
  );
  return { asked, threads };
}

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
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  // What Radix sets on <body> while a dialog is open, should a test end with one open.
  document.body.removeAttribute('style');
});

describe('openAskDialog', () => {
  it('opens the dialog the page mounted, and asks the question in it', async () => {
    const { asked } = answering();
    mount({ launcher: false, title: 'Ask Acme' });
    act(() => {
      openAskDialog();
    });
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    expect(asked).toEqual([]);

    act(() => {
      openAskDialog('  How do I deploy it?  ');
    });
    expect(await screen.findByText('You asked: How do I deploy it?')).toBeTruthy();
    expect(asked).toEqual(['How do I deploy it?']);
    expect(screen.getByRole<HTMLInputElement>('combobox').value).toBe('How do I deploy it?');
  });

  it('does nothing once the dialog is unmounted, or on a page without one', () => {
    const dialog = mount({ launcher: false });
    act(() => {
      dialog.unmount();
    });
    act(() => {
      openAskDialog('Anyone there?');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the controls mountAskDialog returns', () => {
  it('open with a question, each in a new thread, also before the dialog’s code has loaded', async () => {
    const { asked, threads } = answering();
    const dialog = mount({ launcher: false });
    act(() => {
      dialog.open('What is it?');
    });
    expect(await screen.findByText('You asked: What is it?')).toBeTruthy();
    act(() => {
      dialog.close();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    act(() => {
      dialog.open('Is it free?');
    });
    expect(await screen.findByText('You asked: Is it free?')).toBeTruthy();
    expect(asked).toEqual(['What is it?', 'Is it free?']);
    // Not a follow-up to the first answer: a question from outside starts a new thread.
    expect(threads).toEqual([0, 0]);
    // Opened again without one, it keeps the answer it has.
    act(() => {
      dialog.close();
    });
    act(() => {
      dialog.open();
    });
    expect(await screen.findByText('You asked: Is it free?')).toBeTruthy();
    expect(asked).toHaveLength(2);
  });
});

describe('data-ondocs-open', () => {
  it('opens the dialog from any element, with its value as the question, and gives focus back', async () => {
    const { asked } = answering();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="plain" data-ondocs-open>Ask AI</button><button id="chip" type="button" data-ondocs-open="Do I need a database?">Do I need a database?</button>',
    );
    mount({ launcher: false });
    const plain = document.getElementById('plain')!;
    await userEvent.click(plain);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(asked).toEqual([]);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(plain);
    });

    await userEvent.click(document.getElementById('chip')!);
    expect(await screen.findByText('You asked: Do I need a database?')).toBeTruthy();
  });

  it('leaves a link with data-ondocs-open alone when it is opened in a new tab', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a id="link" href="/ask" data-ondocs-open="Hello">Ask</a>',
    );
    mount({ launcher: false });
    // Whether the dialog's listener let the link be, then no navigation, which jsdom lacks.
    let followed: boolean | undefined;
    window.addEventListener(
      'click',
      (event) => {
        followed = !event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    document.getElementById('link')!.dispatchEvent(event);
    expect(followed).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks what a form with data-ondocs-open holds when it is submitted', async () => {
    const { asked } = answering();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<form id="named" data-ondocs-open><input name="other" value="not this"><input name="question"><button>Ask</button></form>
       <form id="first" data-ondocs-open><input type="search"></form>`,
    );
    mount({ launcher: false });
    const named = document.querySelector<HTMLInputElement>('#named input[name="question"]')!;
    await userEvent.type(named, 'How do I install it?{Enter}');
    expect(await screen.findByText('You asked: How do I install it?')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Without a field named question, its first input.
    const first = document.querySelector<HTMLInputElement>('#first input')!;
    first.value = 'And on Netlify?';
    fireEvent.submit(document.getElementById('first')!);
    expect(await screen.findByText('You asked: And on Netlify?')).toBeTruthy();
    expect(asked).toEqual(['How do I install it?', 'And on Netlify?']);
  });

  it('opens the dialog without a question for an empty form', async () => {
    const { asked } = answering();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<form id="empty" data-ondocs-open><input name="question"></form>',
    );
    mount({ launcher: false, title: 'Ask Acme' });
    fireEvent.submit(document.getElementById('empty')!);
    expect(await screen.findByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it('loads the dialog’s code when a pointer or focus reaches one', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button data-ondocs-open>Ask AI</button>');
    const renderer: DialogRenderer = {
      render: () => ({ setOpen: vi.fn(), unmount: vi.fn() }),
    };
    const load = vi.fn(() => Promise.resolve(renderer));
    const dialog = mountWithLoader({ launcher: false }, load);
    mounted.push(dialog);
    fireEvent.pointerOver(document.body);
    expect(load).not.toHaveBeenCalled();
    fireEvent.focusIn(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('hands a renderer the question it was opened with, before and after the code loads', async () => {
    const setOpen = vi.fn();
    const render = vi.fn(() => ({ setOpen, unmount: vi.fn() }));
    let resolve!: (renderer: DialogRenderer) => void;
    const dialog = mountWithLoader(
      { launcher: false },
      () =>
        new Promise<DialogRenderer>((done) => {
          resolve = done;
        }),
    );
    mounted.push(dialog);
    dialog.open('First question');
    resolve({ render });
    await waitFor(() => {
      expect(render).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({ open: true, question: 'First question' }),
      );
    });
    dialog.open('Second question');
    expect(setOpen).toHaveBeenLastCalledWith(true, 'Second question');
    dialog.close();
    expect(setOpen).toHaveBeenLastCalledWith(false);
  });
});

describe('window.Ondocs.open', () => {
  afterEach(() => {
    delete window.Ondocs;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- its name from before ondocs
    delete window.AskMySite;
  });

  it('opens the script tag’s dialog with a question', async () => {
    const { asked } = answering();
    const script = document.createElement('script');
    script.setAttribute('data-manual', '');
    document.head.append(script);
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
    // The script tag's dialog loads embed-dialog.global.js; here, the same module from source.
    window.OndocsDialog = await import('../src/embed/dialog');
    vi.resetModules();
    await act(async () => {
      await import('../src/embed/global');
    });
    act(() => {
      mounted.push(window.Ondocs!.mount({ launcher: false }));
    });
    act(() => {
      window.Ondocs?.open('Where is the index?');
    });
    expect(await screen.findByText('You asked: Where is the index?')).toBeTruthy();
    expect(asked).toEqual(['Where is the index?']);
    delete window.OndocsDialog;
    document.head.replaceChildren();
  });
});

describe('AskDialog’s question prop', () => {
  /** A controlled dialog, opened from outside with a question, as the Docusaurus theme does. */
  function Page() {
    const [state, setState] = useState<{ open: boolean; question?: string }>({ open: false });
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setState({ open: true, question: 'How does it search?' });
          }}
        >
          Try one
        </button>
        <button
          type="button"
          onClick={() => {
            setState({ open: true });
          }}
        >
          Open
        </button>
        <AskDialog
          open={state.open}
          {...(state.question ? { question: state.question } : {})}
          onOpenChange={(open) => {
            setState({ open });
          }}
        />
      </>
    );
  }

  it('asks the question as the dialog opens with it, and again on each opening with it', async () => {
    const { asked } = answering();
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Try one' }));
    expect(await screen.findByText('You asked: How does it search?')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Opened without one: the answer it has, and no new question.
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('You asked: How does it search?')).toBeTruthy();
    expect(asked).toEqual(['How does it search?']);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Try one' }));
    await waitFor(() => {
      expect(asked).toEqual(['How does it search?', 'How does it search?']);
    });
  });

  it('asks nothing while the dialog is closed', () => {
    const { asked } = answering();
    render(<AskDialog open={false} question="Too early?" />);
    expect(asked).toEqual([]);
  });
});
