// Measures the JavaScript a docs page of each example loads in headless Chrome, gzipped: before
// any interaction, and after the visitor opens the dialog. With --check, fails when a page loads
// more than its budget for either.
//
//   pnpm build && pnpm --filter <example> build
//   node scripts/js-weight.mjs [docusaurus|starlight|vitepress|next|embed ...] [--check] [--json]
//     [--port=<port>]
//
// Each site is served from its build output by a static server in this process (Next.js by
// `next start`, on --port or JS_WEIGHT_PORT, or else on a port that is free), so what Chrome
// downloads is what a host would serve. Bytes are gzipped here, at level 9, from the response
// bodies, so the numbers do not depend on the server compressing.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Per site: where its build is, the page to load, the key that opens the dialog, and the budget
 * for the JavaScript the page loads before any interaction, in gzipped KB. The budgets are the
 * framework's own JavaScript, with the demo's theme and pages, plus ondocs's launcher, with a
 * little room; the dialog itself loads on first use and is not counted. A framework update, or
 * the demo's own growth, such as its banner or more pages, can need a budget raised: measure
 * the site built without ondocs, keeping its theme and pages (`docusaurus=<another build>`).
 *
 * `open` is the budget for what the dialog adds when it opens, with a few KB of room. On a React
 * site (Docusaurus, Next.js) that is the dialog, Radix and cmdk; on the others, it brings its own
 * React too: the Starlight and VitePress plugins' `ondocs/embed/standalone`, and the script tag's
 * `embed-dialog.global.js`.
 */
const SITES = {
  docusaurus: {
    dir: 'examples/docusaurus/build',
    page: '/getting-started',
    key: 'i',
    // Docusaurus's own 174.8 KB, with the demo's banner and pages, and ondocs's 2.9 KB (the
    // navbar button, its shortcut and the dialog's options): 177.7 KB, up from 175.2 KB with the
    // live demo's banner and source URLs and more pages. Built without src/pages as well, the
    // site loads its shared code in one chunk, not two, and 173.8 KB, the benchmarks page's
    // figure. The budget leaves about 4 KB of room, as Starlight's does.
    budget: 182,
    // The dialog, Radix and cmdk, on the site's React: 27.7 KB.
    open: 31,
  },
  starlight: {
    dir: 'examples/starlight/dist',
    page: '/get-started/getting-started/',
    key: 'i',
    // Starlight's own 33.7 KB, with the demo's banner and question box, and ondocs's 2.4 KB:
    // 36.1 KB.
    budget: 40,
    // ondocs/embed/standalone's dialog, with its own React: 93.1 KB.
    open: 97,
  },
  vitepress: {
    dir: 'examples/vitepress/.vitepress/dist',
    page: '/getting-started',
    key: 'i',
    // VitePress's own 58.7 KB, with the demo's notice and question box, and ondocs's 2.9 KB:
    // 61.6 KB.
    budget: 64,
    // ondocs/embed/standalone's dialog, with its own React: 96.1 KB.
    open: 100,
  },
  next: {
    next: 'examples/nextjs',
    page: '/docs/getting-started',
    key: 'k',
    // The website: Next.js and its own pages; its header has the button, not a launcher. 167.7 KB
    // before the shared header's theme switch and phone menu, 171.4 KB with them, 178 KB with the
    // docs shell (On this page, the docs bar, page actions, tabs), and 174.5 KB once ondocs's
    // package.json, which client code reached through the site's constants, left the bundle.
    // 180.5 KB with the dialog's styles for touch screens, forced colors and cited sources: the
    // site inlines ondocs/react/styles.css in its page payload, so every rule counts here.
    launcher: false,
    budget: 182,
    // The dialog, Radix and cmdk, on the site's React: 27.8 KB.
    open: 31,
  },
  embed: {
    dir: null,
    page: '/',
    key: 'i',
    // dist/embed.global.js alone: the button, the shortcut and their styles.
    budget: 4,
    // dist/embed-dialog.global.js: the dialog, React and the dialog's styles, 98.5 KB.
    open: 102,
  },
};

/**
 * The button that opens the dialog: the floating launcher, or the button in the navbar that the
 * plugins' `dialog.navbar` puts there instead, as on the three live demos.
 */
const BUTTON = '.ondocs-launcher, .ondocs-button';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** A page for the script embed: plain HTML with the script tag, as on a Hugo or Jekyll site. */
const EMBED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title>
<script src="/embed.global.js" data-endpoint="/api/ask" defer></script></head>
<body><main><h1>A static page</h1><p>With the <a href="/">script embed</a>.</p></main></body></html>`;

/** Serves a folder as a static host does: `/a` from `a.html` or `a/index.html`. */
async function serveStatic(dir) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (dir === null) {
      if (path === '/') {
        response.writeHead(200, { 'content-type': TYPES['.html'] });
        response.end(EMBED_PAGE);
        return;
      }
      const file = join(root, 'dist', path.replace(/^\/+/, ''));
      if (existsSync(file) && statSync(file).isFile()) {
        response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' });
        response.end(readFileSync(file));
        return;
      }
      response.writeHead(404).end();
      return;
    }
    const base = join(root, dir);
    const clean = normalize(path).replace(/^(\.\.[/\\])+/, '');
    for (const candidate of [
      join(base, clean),
      join(base, `${clean.replace(/\/$/, '')}.html`),
      join(base, clean, 'index.html'),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        response.writeHead(200, {
          'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream',
        });
        response.end(readFileSync(candidate));
        return;
      }
    }
    response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${String(server.address().port)}`, close: () => server.close() };
}

/** A port on 127.0.0.1 that nothing listens on: one the system picks, as a server bound to 0. */
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/** Runs `next start` for the example on `port`, or a free one, and waits until it answers. */
async function serveNext(dir, port) {
  port ??= await freePort();
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: join(root, dir),
    stdio: 'ignore',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  const url = `http://127.0.0.1:${String(port)}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { url, close: () => child.kill() };
}

async function measure(name, dir, baseline, port) {
  const site = dir ? { ...SITES[name], dir, next: undefined } : SITES[name];
  const server = site.next ? await serveNext(site.next, port) : await serveStatic(site.dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const scripts = new Map();
    let phase = 'initial';
    page.on('response', async (response) => {
      const type = response.request().resourceType();
      if (type !== 'script') return;
      const url = response.url();
      if (scripts.has(url)) return;
      scripts.set(url, { phase, bytes: null });
      try {
        const body = await response.body();
        scripts.set(url, {
          phase: scripts.get(url).phase,
          bytes: gzipSync(body, { level: 9 }).length,
        });
      } catch {
        // A response without a body (a redirect).
      }
    });
    // Scripts requested and not yet loaded, and every script request so far.
    let pending = 0;
    let requested = 0;
    const isScript = (request) => request.resourceType() === 'script';
    page.on('request', (request) => {
      if (!isScript(request)) return;
      pending += 1;
      requested += 1;
    });
    const settled = (request) => {
      if (isScript(request)) pending -= 1;
    };
    page.on('requestfinished', settled);
    page.on('requestfailed', settled);
    // Keeps track of the idle callbacks the page queues, so that those still waiting once the
    // network has gone quiet can be run before the dialog opens (see below).
    await page.addInitScript(() => {
      const request = window.requestIdleCallback?.bind(window);
      const cancel = window.cancelIdleCallback?.bind(window);
      if (!request || !cancel) return;
      const waiting = new Map();
      window.requestIdleCallback = (callback, options) => {
        const id = request((deadline) => {
          waiting.delete(id);
          callback(deadline);
        }, options);
        waiting.set(id, callback);
        return id;
      };
      window.cancelIdleCallback = (id) => {
        waiting.delete(id);
        cancel(id);
      };
      // Runs them now, as the browser runs one whose timeout has passed, and counts them.
      Object.defineProperty(window, '__jsWeightRunIdle', {
        value: () => {
          const due = [...waiting];
          waiting.clear();
          for (const [id, callback] of due) {
            cancel(id);
            try {
              callback({ didTimeout: true, timeRemaining: () => 0 });
            } catch (error) {
              reportError(error);
            }
          }
          return due.length;
        },
      });
    });
    await page.goto(`${server.url}${site.page}`, { waitUntil: 'networkidle' });
    // What a page loads on its own once the browser is idle counts too: Starlight imports its
    // search UI, about 25 KB gzipped, in a requestIdleCallback. A busy CI runner can go without
    // an idle period for longer than this waits, and the dialog's opening was then charged for
    // the search UI: 10.5 KB before interaction and +119.1 KB on open, against 36.3 KB and
    // +93.3 KB. Wait for an idle callback queued after the page's own, for up to 10 s; then,
    // once every script requested has loaded and none has been requested for 500 ms, run the
    // page's idle callbacks still waiting and wait for the network again, until none wait (five
    // rounds at most).
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.requestIdleCallback(() => resolve(undefined), { timeout: 10_000 });
        }),
    );
    for (let round = 0; round < 5; round += 1) {
      for (let seen = -1; seen !== requested || pending > 0;) {
        seen = requested;
        await page.waitForTimeout(500);
      }
      if ((await page.evaluate(() => window.__jsWeightRunIdle?.() ?? 0)) === 0) break;
    }
    const inline = await page.evaluate(() =>
      [...document.querySelectorAll('script:not([src])')]
        .filter((script) => !script.type || /javascript|module/.test(script.type))
        .map((script) => script.textContent ?? ''),
    );
    const inlineBytes = inline.reduce((sum, code) => sum + gzipSync(code, { level: 9 }).length, 0);
    const launcher = await page.locator(`:is(${BUTTON}):visible`).count();
    if (baseline) {
      const initial = [...scripts.values()].reduce(
        (total, script) => total + (script.bytes ?? 0),
        0,
      );
      return {
        site: name,
        page: site.page,
        initialKB: +((initial + inlineBytes) / 1024).toFixed(1),
        baseline: true,
      };
    }

    phase = 'open';
    // Whatever loads from here on arrives late, as on a slow connection, so the shortcut is
    // pressed while the dialog's code is still on its way, and has to be queued.
    await page.route('**/*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    // Focus a link on the page, to see focus come back to it when the dialog closes.
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('a[href]')].find(
        (a) => !a.closest('.ondocs') && a.getBoundingClientRect().width > 0,
      );
      link?.setAttribute('data-ask-start', '');
      link?.focus();
    });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+${site.key}`);
    await page.waitForSelector('.ask-dialog', { timeout: 10_000 });
    await page
      .waitForFunction(() => document.activeElement?.classList.contains('ask-input'), null, {
        timeout: 5000,
      })
      .catch(() => undefined);
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ask-dialog', { state: 'detached', timeout: 5000 });
    // Radix gives focus back a moment after the dialog has gone.
    const focusOn = (test) =>
      page
        .waitForFunction(test, null, { timeout: 2000 })
        .then(() => true)
        .catch(() => false);
    const focusReturned = await focusOn(
      () => document.activeElement?.hasAttribute('data-ask-start') ?? false,
    );
    let launcherFocusReturned = null;
    if (launcher > 0) {
      await page.locator(`:is(${BUTTON}):visible`).first().click();
      await page.waitForSelector('.ask-dialog', { timeout: 10_000 });
      await page.waitForFunction(
        () => document.activeElement?.classList.contains('ask-input'),
        null,
        {
          timeout: 5000,
        },
      );
      await page.keyboard.press('Escape');
      await page.waitForSelector('.ask-dialog', { state: 'detached', timeout: 5000 });
      launcherFocusReturned = await focusOn(
        () => document.activeElement?.matches('.ondocs-launcher, .ondocs-button') ?? false,
      );
    }
    await page.unroute('**/*.js');
    await page.waitForLoadState('networkidle');

    const sum = (wanted) =>
      [...scripts.values()]
        .filter((script) => script.phase === wanted)
        .reduce((total, script) => total + (script.bytes ?? 0), 0);
    return {
      site: name,
      page: site.page,
      initialKB: +((sum('initial') + inlineBytes) / 1024).toFixed(1),
      onOpenKB: +(sum('open') / 1024).toFixed(1),
      files: scripts.size,
      launcher: launcher > 0,
      dialogFocused: /ask-input/.test(focused),
      focusReturned,
      launcherFocusReturned,
      budgetKB: site.budget,
      openBudgetKB: site.open,
    };
  } finally {
    await browser.close();
    server.close();
  }
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const json = args.includes('--json');
const names = args.filter((arg) => !arg.startsWith('--'));
const portArg = args.find((arg) => arg.startsWith('--port='))?.slice('--port='.length);
const port = portArg ?? process.env.JS_WEIGHT_PORT;
if (port !== undefined && !/^\d+$/.test(port)) {
  throw new Error(`--port and JS_WEIGHT_PORT take a port number, not ${JSON.stringify(port)}`);
}
const results = [];
// `docusaurus=examples/docusaurus/build-plain` measures another build of a site, such as one
// without ondocs, for the framework's own JavaScript; it is not opened or checked.
for (const arg of names.length > 0 ? names : Object.keys(SITES)) {
  const [name = '', dir] = arg.split('=');
  if (!SITES[name])
    throw new Error(`Unknown site ${name}; one of ${Object.keys(SITES).join(', ')}`);
  results.push(
    await measure(name, dir, Boolean(dir), port === undefined ? undefined : Number(port)),
  );
}
if (json) console.log(JSON.stringify(results, null, 2));
else {
  for (const result of results) {
    if (result.baseline) {
      console.log(
        `${result.site.padEnd(11)} ${String(result.initialKB).padStart(6)} KB without ondocs`,
      );
      continue;
    }
    console.log(
      `${result.site.padEnd(11)} ${String(result.initialKB).padStart(6)} KB before interaction (budget ${String(result.budgetKB)}), +${String(result.onOpenKB)} KB on open (budget ${String(result.openBudgetKB)}); button ${result.launcher ? 'shown' : 'missing'}; shortcut while loading: input ${result.dialogFocused ? 'focused' : 'NOT focused'}, focus ${result.focusReturned ? 'back on the page' : 'NOT back'} after Escape${result.launcher ? `, ${result.launcherFocusReturned ? 'and back on the button' : 'NOT back on the button'} after a click` : ''}`,
    );
  }
}
const failures = results.filter(
  (result) =>
    !result.baseline &&
    (result.initialKB > result.budgetKB ||
      result.onOpenKB > result.openBudgetKB ||
      (SITES[result.site].launcher !== false && !result.launcher) ||
      !result.dialogFocused ||
      !result.focusReturned ||
      result.launcherFocusReturned === false),
);
if (check && failures.length > 0) {
  for (const failure of failures) {
    console.error(
      `✗ ${failure.site}: ${String(failure.initialKB)} KB of JavaScript before interaction (budget ${String(failure.budgetKB)} KB), +${String(failure.onOpenKB)} KB on open (budget ${String(failure.openBudgetKB)} KB)${failure.launcher || SITES[failure.site].launcher === false ? '' : ', no button'}${failure.dialogFocused ? '' : ', the dialog input did not get focus'}${failure.focusReturned ? '' : ', focus did not come back after Escape'}${failure.launcherFocusReturned === false ? ', focus did not come back to the button' : ''}`,
    );
  }
  process.exit(1);
}
