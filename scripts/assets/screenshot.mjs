// Captures the README hero from the running example app (mock mode, so it is deterministic).
//
//   pnpm example:build && (cd examples/nextjs && pnpm start) &
//   pnpm screenshot                       # or: ASK_URL=http://localhost:3457 pnpm screenshot
//
// Drives the locally installed Chrome through playwright-core; no browser download needed.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.env.ASK_URL ?? 'http://localhost:3000';
const out = fileURLToPath(new URL('../../.github/assets/', import.meta.url));
mkdirSync(out, { recursive: true });

const shots = [
  {
    file: 'hero.png',
    page: '/docs/retrieval',
    question: 'When does it answer "I don\'t know"?',
    viewport: { width: 1280, height: 720 },
    // Tight around the dialog so its text stays legible at README width, with page context.
    clip: { x: 150, y: 0, width: 980, height: 640 },
  },
];

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(new URL(shot.page, base).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox');
    await input.waitFor();
    await input.fill(shot.question);
    await page.keyboard.press('Enter');
    await page.locator('.ask-answer[data-status="done"]').waitFor({ timeout: 15_000 });
    // Park the pointer away from hover styles.
    await page.mouse.move(2, 2);
    await page.screenshot({ path: `${out}${shot.file}`, type: 'png', clip: shot.clip });
    console.log(`wrote .github/assets/${shot.file}`);
    await context.close();
  }
} finally {
  await browser.close();
}
