// @vitest-environment jsdom
// dist/embed.global.js when the dialog's own file, dist/embed-dialog.global.js, does not arrive: a
// Content Security Policy that blocks cdn.jsdelivr.net, a network error, or a copy at
// data-dialog-src that is not the dialog. The page says why in the console and keeps its keys,
// and the next open tries again. A tag with data-dialog-integrity pins the second file too.
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** Runs the script entry as if from `<script>` with these attributes. */
async function runScript(attributes: Record<string, string>) {
  const script = document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  document.head.append(script);
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
  vi.resetModules();
  await act(async () => {
    await import('../src/embed/global');
  });
}

/** The dialog's script tags the page has, newest last. */
const dialogTags = () => [
  ...document.querySelectorAll<HTMLScriptElement>('script[src*="embed-dialog"]'),
];

afterEach(() => {
  act(() => {
    document.querySelector('.ondocs')?.remove();
  });
  for (const tag of document.head.querySelectorAll('script')) tag.remove();
  delete window.Ondocs;
  delete window.OndocsDialog;
});

describe('dist/embed.global.js, when its dialog does not load', () => {
  it('says the dialog could not load, and tries again on the next open', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runScript({
      src: 'https://cdn.jsdelivr.net/npm/ondocs@0/dist/embed.global.js',
      'data-endpoint': '/api/ask',
    });
    const button = screen.getByRole('button', { name: 'Ask AI' });
    await userEvent.click(button);
    expect(dialogTags().map((tag) => tag.src)).toEqual([
      'https://cdn.jsdelivr.net/npm/ondocs@0/dist/embed-dialog.global.js',
    ]);
    await act(async () => {
      dialogTags()[0]?.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    expect(error).toHaveBeenCalledWith(
      '[ondocs] The dialog could not load.',
      new Error(
        'Could not load https://cdn.jsdelivr.net/npm/ondocs@0/dist/embed-dialog.global.js.',
      ),
    );
    // Closed and opened again, it adds a fresh tag rather than waiting on the failed one.
    await userEvent.keyboard('{Escape}');
    await userEvent.click(button);
    expect(dialogTags()).toHaveLength(2);
  });

  it('says so when the file at data-dialog-src loads but is not the dialog', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runScript({ 'data-dialog-src': '/vendor/not-the-dialog.js' });
    await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    const [tag] = [
      ...document.querySelectorAll<HTMLScriptElement>('script[src$="not-the-dialog.js"]'),
    ];
    await act(async () => {
      tag?.dispatchEvent(new Event('load'));
      await Promise.resolve();
    });
    expect(error).toHaveBeenCalledWith(
      '[ondocs] The dialog could not load.',
      new Error('/vendor/not-the-dialog.js did not define the dialog.'),
    );
  });

  it('pins the dialog with data-dialog-integrity, fetched with CORS', async () => {
    await runScript({
      src: 'https://cdn.jsdelivr.net/npm/ondocs@0/dist/embed.global.js',
      'data-dialog-integrity': 'sha384-abc',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    const [tag] = dialogTags();
    expect(tag?.integrity).toBe('sha384-abc');
    expect(tag?.crossOrigin).toBe('anonymous');
  });

  it('mounts once the page has parsed, when its tag runs while the page is loading', async () => {
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    await runScript({});
    expect(document.querySelector('.ondocs')).toBeNull();
    state.mockRestore();
    act(() => {
      document.dispatchEvent(new Event('DOMContentLoaded'));
    });
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeTruthy();
  });
});
