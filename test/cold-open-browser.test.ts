// ⌘I, then the question straight away, in headless Chrome: the script embed and a React page
// built from the source, with the CPU slowed four times, and the dialog's code arriving at once or,
// as on a slow connection, 1.5 s late. What was typed before the dialog was there used to go
// nowhere: the first letter on localhost, all of it on a slow connection. Skipped where headless
// Chrome is not installed (`pnpm exec playwright-core install --only-shell chromium`).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { chromium, type Page } from 'playwright-core';
import { build } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import configs from '../tsdown.config';

const root = join(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true }).catch(() => null);

const QUESTION = 'How do I roll back a release?';
const ORIGIN = 'http://ondocs.test';
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

const EMBED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title>
<script src="/embed.global.js" data-endpoint="/api/ask" defer></script></head>
<body><main><h1>Deploying</h1><p>A page with the <a href="/">script embed</a>.</p></main></body></html>`;

const REACT_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>React</title>
<link rel="stylesheet" href="/styles.css"><script type="module" src="/page.js"></script></head>
<body><main><h1>Deploying</h1><p>A page with <a href="/">AskDialog</a>.</p></main></body></html>`;

/** A React page with `<AskDialog launcher />`, as a site renders it. */
const REACT_ENTRY = `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AskDialog } from ${JSON.stringify(join(root, 'src/react/index.ts'))};
const element = document.createElement('div');
document.body.append(element);
createRoot(element).render(createElement(AskDialog, { launcher: true, endpoint: '/api/ask' }));
`;

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
};

describe.skipIf(!browser)('typing straight after ⌘I, in a browser', () => {
  let out = '';
  /** The built files, by URL path, and the ones that are the dialog's code. */
  const files = new Map<string, string>();
  const dialogCode = new Set<string>();

  beforeAll(async () => {
    // Inside the project, so the React page's imports resolve from its node_modules.
    const cache = join(root, 'node_modules', '.cache', 'ondocs');
    mkdirSync(cache, { recursive: true });
    out = mkdtempSync(join(cache, 'cold-open-'));
    const quiet = {
      config: false,
      cwd: root,
      logLevel: 'error',
      inputOptions: {
        // Radix and cmdk mark their modules "use client", which means nothing once bundled.
        onLog: (level, log, handler) => {
          if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
        },
      },
    } satisfies Parameters<typeof build>[0];
    for (const name of ['embed', 'embed-dialog']) {
      // The script embed's two files, each a build of its own.
      const config = configs.find(
        (entry) =>
          typeof entry.entry === 'object' &&
          !Array.isArray(entry.entry) &&
          Object.keys(entry.entry).join() === name,
      );
      if (!config) throw new Error(`tsdown.config.ts builds no ${name}`);
      await build({ ...config, ...quiet, outDir: join(out, 'embed') });
    }
    writeFileSync(join(out, 'page.tsx'), REACT_ENTRY);
    await build({
      ...quiet,
      entry: { page: join(out, 'page.tsx') },
      outDir: join(out, 'react'),
      outputOptions: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
      deps: { alwaysBundle: [/./], onlyBundle: false },
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      dts: false,
    });
    for (const dir of ['embed', 'react']) {
      for (const file of readdirSync(join(out, dir))) {
        const text = readFileSync(join(out, dir, file), 'utf8');
        files.set(`/${dir}/${file}`, text);
        // The dialog's own code: the dialog's script, or the React page's chunk it imports.
        if (
          file === 'embed-dialog.global.js' ||
          (file !== 'page.js' && text.includes('ask-dialog'))
        )
          dialogCode.add(`/${dir}/${file}`);
      }
    }
    files.set('/react/styles.css', readFileSync(join(root, 'src/react/styles.css'), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    if (out) rmSync(out, { recursive: true, force: true });
  });

  /**
   * Opens `site`'s page with the CPU slowed four times and the dialog's code `late` ms late, and
   * returns it with the questions it sent.
   */
  async function open(site: 'embed' | 'react', late: number) {
    const context = await browser!.newContext();
    const page = await context.newPage();
    const asked: string[] = [];
    await page.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/ask') {
        asked.push(route.request().postData() ?? '');
        await route.fulfill({ status: 500, body: '' });
        return;
      }
      if (path === '/') {
        await route.fulfill({
          contentType: 'text/html',
          body: site === 'embed' ? EMBED_PAGE : REACT_PAGE,
        });
        return;
      }
      const file = `/${site}${path}`;
      const body = files.get(file);
      if (body === undefined) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      if (dialogCode.has(file)) await new Promise((resolve) => setTimeout(resolve, late));
      await route.fulfill({ contentType: TYPES[extname(file)] ?? 'text/plain', body });
    });
    const cdp = await context.newCDPSession(page);
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector('.ondocs-launcher');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    return { page, asked, close: () => context.close() };
  }

  /** The dialog's input, once it has focus, and its text once it has settled on `expected`. */
  async function inputValue(page: Page, expected: string): Promise<string> {
    await page.waitForFunction(
      () => document.activeElement?.classList.contains('ask-input'),
      null,
      {
        timeout: 15_000,
      },
    );
    await page
      .waitForFunction(
        (text) => (document.activeElement as HTMLInputElement).value === text,
        expected,
        { timeout: 2000 },
      )
      .catch(() => undefined);
    return page.evaluate(() => (document.activeElement as HTMLInputElement).value);
  }

  for (const site of ['embed', 'react'] as const) {
    for (const late of [0, 1500]) {
      it(`keeps every key on the ${site === 'embed' ? 'script embed' : 'React page'} with the dialog's code ${late ? `${String(late)} ms late` : 'at once'}`, async () => {
        const { page, asked, close } = await open(site, late);
        try {
          await page.keyboard.press(`${MODIFIER}+i`);
          await page.keyboard.type(QUESTION, { delay: 40 });
          expect(await inputValue(page, QUESTION)).toBe(QUESTION);
          // Kept as the input's text, for the visitor to send.
          expect(asked).toEqual([]);
        } finally {
          await close();
        }
      }, 60_000);
    }

    it(`types on in the ${site === 'embed' ? 'script embed' : 'React page'}’s input once it is there, after what came before`, async () => {
      const { page, close } = await open(site, 1500);
      try {
        await page.keyboard.press(`${MODIFIER}+i`);
        await page.keyboard.type('How do I', { delay: 40 });
        expect(await inputValue(page, 'How do I')).toBe('How do I');
        await page.keyboard.type(' roll back a release?', { delay: 40 });
        expect(await inputValue(page, QUESTION)).toBe(QUESTION);
      } finally {
        await close();
      }
    }, 60_000);
  }
});
