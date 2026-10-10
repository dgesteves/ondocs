// @vitest-environment jsdom
// The module ondocs/vitepress adds to every page, run in a page: VitePress's dark mode, a class on
// <html>, becomes the data-theme the launcher and the dialog follow.
import { describe, expect, it } from 'vitest';

import { launcherModule, type VitePressSiteConfig } from '../src/vitepress';

const SITE: VitePressSiteConfig = {
  root: '/site',
  outDir: '/site/.vitepress/dist',
  pages: [],
  rewrites: { map: {} },
  site: {
    base: '/docs/',
    title: 'Acme',
    description: 'Docs for Acme.',
    locales: { root: { title: 'Acme' }, fr: { title: 'Acme FR' } },
  },
};

describe('the VitePress launcher module, in a page', () => {
  it('follows the dark class on <html> as data-theme, in a page', async () => {
    document.documentElement.className = 'dark';
    const source = launcherModule('/api/ask', {}, SITE)
      .split('\n')
      .filter((line) => !line.startsWith('import'))
      .join('\n');
    const mounted: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const page = new Function(
      'document',
      'location',
      'MutationObserver',
      'mountAskDialog',
      source,
    ) as (...args: unknown[]) => void;
    page(document, { pathname: '/docs/fr/guide/' }, MutationObserver, (options: unknown) => {
      mounted.push(options);
      return { unmount: () => undefined };
    });
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('dark');
    expect(mounted).toEqual([{ endpoint: '/api/ask', title: 'Ask Acme FR', locale: 'fr' }]);
    root.classList.remove('dark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.dataset.theme).toBe('light');
  });
});
