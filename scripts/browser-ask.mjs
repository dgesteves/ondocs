// Asks a question on a docs page of each example, in headless Chrome, as a visitor does: opens
// the dialog from the button the page shows, types the question and presses Enter, and waits for
// the answer's citations and sources. Then it runs axe on the dialog with the answer in it, in
// the light and the dark color scheme, and presses Enter on the first citation, which must take
// the page to the cited section: the dialog sat inside a command palette that took every Enter,
// so a citation or a source could not be opened from the keyboard, and no test pressed one.
//
//   pnpm build && pnpm --filter <example> build
//   node scripts/browser-ask.mjs [docusaurus|starlight|vitepress|embed ...]
//
// Each site is served from its build output, as scripts/js-weight.mjs serves it. Its questions
// go to the endpoint the page posts to (the live demos post to ondocs.vercel.app), which the
// browser routes to a handler in this process: dist/server.js with the mock models, over the
// website's docs. Requests to any other host are dropped, so nothing leaves the machine
// and nothing needs a key.
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../dist/mock.js';
import { createAskHandler } from '../dist/server.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const QUESTION = 'How do I install ondocs?';

/**
 * Per site: its build and a docs page. The three demos post to the website's endpoint, which
 * answers from the website's docs, and map its citations to their own pages with `sourceUrls`;
 * the handler here answers from the same docs. `embed` is the script tag on a plain page.
 */
const SITES = {
  docusaurus: { dir: 'examples/docusaurus/build', page: '/getting-started' },
  starlight: { dir: 'examples/starlight/dist', page: '/get-started/getting-started/' },
  vitepress: { dir: 'examples/vitepress/.vitepress/dist', page: '/getting-started' },
  embed: { dir: null, page: '/' },
};

/** The website's docs, indexed as the website indexes them without a key, with the mock model. */
function websiteIndex() {
  const out = join(mkdtempSync(join(tmpdir(), 'ondocs-browser-ask-')), 'ask-index.json');
  execFileSync(
    process.execPath,
    [
      join(root, 'dist/cli.js'),
      'index',
      join(root, 'examples/nextjs/content/docs'),
      '--base-url',
      '/docs',
      '-e',
      'mock',
      '-o',
      out,
      '-q',
    ],
    { stdio: 'inherit' },
  );
  return JSON.parse(readFileSync(out, 'utf8'));
}

/** The button that opens the dialog: the floating launcher, or the navbar's. */
const BUTTON = ':is(.ondocs-launcher, .ondocs-button):visible';

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

const EMBED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title>
<script src="/embed.global.js" data-endpoint="/api/ask" defer></script></head>
<body><main><h1>A static page</h1><p>With the <a href="/">script embed</a>.</p></main></body></html>`;

/** Serves a build as a static host does (`/a` from `a.html` or `a/index.html`), or the embed page. */
async function serveStatic(dir) {
  const base = join(root, dir ?? 'dist');
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    if (dir === null && path === '/') {
      response.writeHead(200, { 'content-type': TYPES['.html'] });
      response.end(EMBED_PAGE);
      return;
    }
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

/** axe-core's rules for WCAG 2.x A and AA, on the dialog: the violations, one line each. */
async function axe(page) {
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const { violations } = await window.axe.run('.ask-dialog', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return violations.map(
      (violation) =>
        `${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
    );
  });
  return violations;
}

async function ask(name, index) {
  const site = SITES[name];
  const server = await serveStatic(site.dir);
  const handler = createAskHandler({
    index,
    model: mockLanguageModel(),
    ...(index.embedding
      ? { embeddingModel: mockEmbeddingModel({ dimensions: index.embedding.dimensions }) }
      : {}),
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    allowedOrigins: [server.url],
    rateLimit: false,
  });
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  try {
    const page = await browser.newPage();
    const asked = [];
    // Nothing leaves the machine: requests to other hosts (analytics, fonts) are dropped.
    await page.route(
      (url) => url.origin !== server.url,
      (route) => route.abort(),
    );
    // Wherever the page posts its questions, the handler here answers.
    await page.route('**/api/ask', async (route) => {
      const request = route.request();
      asked.push(`${request.method()} ${request.url()}`);
      const body = request.postDataBuffer();
      const response = await handler(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          ...(body && request.method() !== 'GET' ? { body } : {}),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await page.goto(`${server.url}${site.page}`, { waitUntil: 'networkidle' });
    await page.locator(BUTTON).first().click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('ask-input'));
    await page.keyboard.type(QUESTION);
    await page.keyboard.press('Enter');
    const citation = page.locator('.ask-dialog .ask-citation').first();
    try {
      await citation.waitFor({ timeout: 15_000 });
      await page.locator('.ask-dialog .ask-source').first().waitFor({ timeout: 5000 });
    } catch {
      problems.push(
        `no citation and source in the answer (requests: ${asked.join(', ') || 'none'})`,
      );
      return { name, problems };
    }
    const sources = await page.locator('.ask-dialog .ask-source').count();

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(200);
      for (const violation of await axe(page)) problems.push(`axe, ${scheme}: ${violation}`);
    }

    // Enter on the citation, from the keyboard alone.
    const href = await citation.getAttribute('href');
    const target = new URL(href ?? '', page.url());
    await citation.focus();
    await page.keyboard.press('Enter');
    try {
      await page.waitForURL((url) => url.pathname === target.pathname && url.hash === target.hash, {
        timeout: 5000,
      });
    } catch {
      problems.push(`Enter on the citation to ${String(href)} left the page at ${page.url()}`);
    }
    return { name, problems, sources, href };
  } finally {
    await browser.close();
    server.close();
  }
}

const names = process.argv.slice(2);
for (const name of names) {
  if (!SITES[name])
    throw new Error(`Unknown site ${name}; one of ${Object.keys(SITES).join(', ')}`);
}
let failed = false;
const index = websiteIndex();
for (const name of names.length > 0 ? names : Object.keys(SITES)) {
  const result = await ask(name, index);
  if (result.problems.length > 0) {
    failed = true;
    console.error(`✗ ${name}:\n  ${result.problems.join('\n  ')}`);
  } else {
    console.log(
      `✓ ${name}: "${QUESTION}" answered with ${String(result.sources)} sources, no axe violations in the dialog in light or dark, and Enter on the first citation opened ${String(result.href)}`,
    );
  }
}
if (failed) process.exit(1);
