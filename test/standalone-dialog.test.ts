// @vitest-environment jsdom
// `ondocs/embed/standalone`, what the Astro, Starlight and VitePress plugins mount the launcher
// with: the dialog's chunk brings React, Radix and cmdk, so a site without React installs none of
// them. Built here as tsdown.config.ts builds it, then read for imports a site would have to
// resolve, and run.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { build } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MountAskDialogOptions, MountedAskDialog } from '../src/embed';
import { launcherScript } from '../src/integration';
import { launcherModule } from '../src/vitepress';
import configs from '../tsdown.config';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

/** What the dialog renders with, which ondocs/react needs a site to install. */
const REACT_PACKAGES = ['react', 'react-dom', '@radix-ui/react-dialog', 'cmdk'];

describe('the setup guides for sites without React', () => {
  it('install ondocs and the AI SDK, without React, Radix or cmdk', () => {
    const installs = [
      ['README.md', '**Starlight.** `npm i '],
      ['examples/nextjs/content/docs/astro.md', 'npm i '],
      ['examples/nextjs/content/docs/vitepress.md', 'npm i '],
      ['packages/starlight-ondocs/README.md', 'npm i '],
    ].map(([file = '', start = '']) => {
      const line = read(file)
        .split('\n')
        .find((text) => text.startsWith(start));
      const packages =
        /npm i ([^`]+)/
          .exec(line ?? '')?.[1]
          ?.trim()
          .split(/\s+/) ?? [];
      return [file, packages.filter((name) => REACT_PACKAGES.includes(name))];
    });
    expect(installs).toEqual([
      ['README.md', []],
      ['examples/nextjs/content/docs/astro.md', []],
      ['examples/nextjs/content/docs/vitepress.md', []],
      ['packages/starlight-ondocs/README.md', []],
    ]);
  });

  it('match the landing page’s install step for Astro, Starlight and VitePress', () => {
    const page = read('examples/nextjs/app/(home)/page.tsx');
    // The last tab with each id is the install section's; the first is the demos'.
    const install = (id: string) =>
      /'npm i ([^']+)'/.exec(
        page.slice(page.lastIndexOf(`id: '${id}'`)).split(/\bid: '/)[1] ?? '',
      )?.[1];
    expect([install('astro'), install('vitepress')]).toEqual([
      'ondocs ai @ai-sdk/openai',
      'ondocs ai @ai-sdk/openai',
    ]);
  });
});

describe('the plugins’ launcher', () => {
  it('mounts with ondocs/embed/standalone, in Astro, Starlight and VitePress', () => {
    const imports = (source: string) =>
      source.split('\n').filter((line) => line.includes('mountAskDialog }'));
    expect(imports(launcherScript({ endpoint: '/api/ask' }))).toEqual([
      "import { mountAskDialog } from 'ondocs/embed/standalone';",
    ]);
    expect(imports(launcherModule('/api/ask', {}, undefined))).toEqual([
      "import { mountAskDialog } from 'ondocs/embed/standalone';",
    ]);
  });
});

describe('ondocs/embed/standalone', () => {
  const ENTRY = 'embed/standalone.js';
  let out = '';
  let files: string[] = [];
  /** The dialog's chunk, which the entry imports on first use. */
  let chunk = '';
  const text = (file: string) => readFileSync(join(out, file), 'utf8');

  beforeAll(async () => {
    // Inside the project, where Vitest imports from.
    const cache = join(root, 'node_modules', '.cache', 'ondocs');
    mkdirSync(cache, { recursive: true });
    out = mkdtempSync(join(cache, 'standalone-'));
    const config = configs.find(
      (entry) =>
        typeof entry.entry === 'object' &&
        !Array.isArray(entry.entry) &&
        'embed/standalone' in entry.entry,
    );
    if (!config) throw new Error('tsdown.config.ts builds no embed/standalone');
    await build({ ...config, config: false, cwd: root, outDir: out, logLevel: 'error' });
    files = readdirSync(join(out, 'embed')).map((file) => `embed/${file}`);
    chunk = files.find((file) => file !== ENTRY) ?? '';
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

  afterAll(() => {
    if (out) rmSync(out, { recursive: true, force: true });
  });

  it('imports nothing but its own dialog chunk, which imports nothing', () => {
    const specifiers = (file: string) =>
      [
        ...text(file).matchAll(
          /\bimport\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)|\b(?:from|import)\s*[`'"]([^`'"]+)[`'"]/g,
        ),
      ].map((match) => match[1] ?? match[2]);
    expect(files).toHaveLength(2);
    expect(files).toContain(ENTRY);
    expect(specifiers(ENTRY)).toEqual([`./${chunk.slice('embed/'.length)}`]);
    expect(specifiers(chunk)).toEqual([]);
    // No require() and no process.env left for a browser bundle to choke on.
    for (const file of files)
      expect([file, /\brequire\(|process\.env/.test(text(file))]).toEqual([file, false]);
  });

  it('keeps a page to the launcher, and React in the chunk it loads on first use', () => {
    const gzipped = (file: string) => gzipSync(text(file), { level: 9 }).length;
    expect(gzipped(ENTRY)).toBeLessThan(2.5 * 1024);
    expect(text(ENTRY)).not.toContain('ask-dialog');
    // React's own error URL, and the dialog's class names, are in the chunk.
    expect(text(chunk)).toContain('react.dev/errors');
    expect(text(chunk)).toContain('ask-dialog');
  });

  it('opens the dialog and answers, with no React of the page’s own', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            [
              { type: 'start', messageMetadata: { refused: false, retrieval: 'keyword' } },
              { type: 'source-url', sourceId: '1', url: '/guides/setup/#install', title: 'Setup' },
              { type: 'text-delta', id: 'a', delta: 'Run the installer [1].' },
              { type: 'finish' },
            ]
              .map((part) => `data: ${JSON.stringify(part)}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        ),
      ),
    );
    const { mountAskDialog } = (await import(/* @vite-ignore */ join(out, ENTRY))) as {
      mountAskDialog: (options?: MountAskDialogOptions) => MountedAskDialog;
    };
    const start = document.createElement('a');
    start.href = '#start';
    start.textContent = 'Start';
    document.body.append(start);
    start.focus();
    // React schedules its renders with setImmediate. A busy CI runner reaches them late, as this
    // does: the dialog has focus before the render that lets it take pointer events.
    vi.stubGlobal('setImmediate', (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
      setTimeout(callback, 30, ...args),
    );
    const ask = mountAskDialog({ suggestions: ['How do I install it?'] });
    try {
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Ask AI/ }));
      const input = await screen.findByRole('combobox');
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
        // Radix turns pointer events off for the page as the dialog opens, and back on for the
        // dialog a render later. Until then user-event refuses to click into it.
        expect(getComputedStyle(input).pointerEvents).not.toBe('none');
      });
      await user.type(input, 'How do I install it?{Enter}');
      const citation = await screen.findByRole('link', { name: /^Source 1:/ });
      expect(citation.getAttribute('href')).toBe('/guides/setup/#install');
      expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/ask');
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(document.querySelector('.ask-dialog')).toBeNull();
      });
      expect(screen.getByRole('button', { name: /Ask AI/ }).getAttribute('aria-expanded')).toBe(
        'false',
      );
    } finally {
      ask.unmount();
      start.remove();
      vi.unstubAllGlobals();
    }
  });
});
