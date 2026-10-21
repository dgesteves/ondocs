// Every page of the website at a phone's width: none may scroll sideways. It loads each page in
// the sitemap, and the 404 page, in headless Chrome at 390 by 844, after the example's build, and
// fails on a page wider than the screen, naming the widest elements that stick out.
//
//   pnpm --filter ondocs-example-nextjs build && node scripts/mobile-width.mjs
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const WIDTH = 390;

/** Runs `next start` for the website and waits until it answers. */
async function serveNext() {
  const port = 3600 + Math.floor(Math.random() * 300);
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: join(root, 'examples/nextjs'),
    stdio: 'ignore',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  const url = `http://127.0.0.1:${String(port)}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return { url, close: () => child.kill() };
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error('next start did not answer');
}

const server = await serveNext();
const browser = await chromium.launch({ headless: true });
const problems = [];
try {
  // The sitemap's absolute URLs are the live site's: keep their paths.
  const sitemap = await (await fetch(`${server.url}/sitemap.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1] ?? '').pathname,
  );
  if (paths.length < 10) throw new Error(`The sitemap lists ${String(paths.length)} pages`);
  paths.push('/this-page-does-not-exist');
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 844 } });
  for (const path of paths) {
    await page.goto(`${server.url}${path}`, { waitUntil: 'networkidle' });
    const { width, wide } = await page.evaluate((screen) => {
      const elements = [...document.querySelectorAll('body *')]
        .map((element) => ({ element, right: element.getBoundingClientRect().right }))
        // Inside a scroller of its own, such as a code block or a table, it scrolls there.
        .filter(({ element, right }) => {
          if (right <= screen + 0.5) return false;
          for (let up = element.parentElement; up; up = up.parentElement) {
            const overflow = getComputedStyle(up).overflowX;
            if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') return false;
          }
          return true;
        })
        .sort((a, b) => b.right - a.right)
        .slice(0, 3)
        .map(
          ({ element, right }) =>
            `<${element.tagName.toLowerCase()}${element.className ? ` class="${String(element.className)}"` : ''}> to ${String(Math.round(right))}px: ${(element.textContent ?? '').trim().slice(0, 60)}`,
        );
      return { width: document.documentElement.scrollWidth, wide: elements };
    }, WIDTH);
    if (width > WIDTH) {
      problems.push(`${path} is ${String(width)}px wide: ${wide.join('; ') || 'no one element'}`);
    }
  }
  console.log(`${String(paths.length)} pages at ${String(WIDTH)}px.`);
} finally {
  await browser.close();
  server.close();
}
if (problems.length > 0) {
  console.error(`✗ ${problems.join('\n✗ ')}`);
  process.exit(1);
}
console.log('✓ None scrolls sideways.');
