import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, it } from 'vitest';

// The websites moved from *-demo.vercel.app to ondocs.vercel.app, onsystem.vercel.app and
// signoff-ui.vercel.app. The old addresses redirect, but links, metadata and install links use
// the new ones. Changelogs and the record of the one-off rename commands keep what was published.
const root = path.resolve(import.meta.dirname, '..');
const OLD = [
  /(?:design-system-mcp|ask-my-site|agent-ui-kit)-demo\.vercel\.app/,
  // The same address inside a Cursor install link, whose config is base64.
  /eyJ1cmwiOiJodHRwczovL2Fzay1teS1zaXRlLWRlbW8/,
];
const KEEP = [/(?:^|\/)CHANGELOG\.md$/, /^CONTRIBUTING\.md$/, /^test\/site-address\.test\.ts$/];
const BINARY = /\.(?:png|jpe?g|webp|gif|ico|svg|mp4|webm|woff2?|ttf|pdf)$/i;

it('links to the websites at their current addresses', () => {
  const stale = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !BINARY.test(file) && !KEEP.some((keep) => keep.test(file)))
    .filter((file) => {
      const full = path.join(root, file);
      if (!fs.existsSync(full)) return false;
      const text = fs.readFileSync(full, 'utf8');
      return OLD.some((old) => old.test(text));
    });
  expect(stale).toEqual([]);
});
