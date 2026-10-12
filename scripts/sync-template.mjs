// Writes templates/cloudflare-worker from what `ondocs init --host github-pages` writes, so the
// template that `npm create cloudflare` copies and the Worker init writes are the same code. The
// template's README, its tests and their config are its own, and left alone.
//
//   pnpm build && node scripts/sync-template.mjs           # write it
//   pnpm build && node scripts/sync-template.mjs --check   # exit 1 if it is out of date
//
// The files are kept as init writes them, byte for byte (.prettierignore leaves them alone). The
// template's package.json adds what its tests need, and depends on ondocs at this package.json's
// version, the one on npm. The release workflow runs this after `changeset version`, so the
// release pull request moves the template to the version it publishes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const TEMPLATE = join(root, 'templates/cloudflare-worker');
const GENERATED = ['package.json', 'tsconfig.json', 'wrangler.jsonc', 'src/index.ts'];
const check = process.argv.includes('--check');

const site = mkdtempSync(join(tmpdir(), 'ondocs-template-'));
try {
  writeFileSync(join(site, 'docusaurus.config.ts'), "export default { title: 'your docs' };\n");
  execFileSync(
    process.execPath,
    [
      join(root, 'dist/cli.js'),
      'init',
      '--host',
      'github-pages',
      '--site-url',
      'https://docs.example.com',
      '--yes',
    ],
    { cwd: site, stdio: 'ignore' },
  );
  const changed = [];
  for (const file of GENERATED) {
    let text = readFileSync(join(site, 'ondocs-worker', file), 'utf8');
    const target = join(TEMPLATE, file);
    let current = null;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // Not written yet.
    }
    if (file === 'package.json') {
      const pkg = JSON.parse(text);
      pkg.scripts = { ...pkg.scripts, test: 'vitest run' };
      pkg.devDependencies = {
        ...pkg.devDependencies,
        '@cloudflare/vitest-plugin': '^1.4.0',
        // vitest 5.0.4 breaks @cloudflare/vitest-plugin 1.4.0 ("no such file or directory,
        // readAll …/.vitest-cache/…"). Back to ^5.0.0 once the plugin supports it.
        vitest: '5.0.3',
      };
      pkg.dependencies.ondocs = `^${version}`;
      text = `${JSON.stringify(pkg, null, 2)}\n`;
    }
    if (current !== text) changed.push([file, text]);
  }
  const show = (file) => `templates/cloudflare-worker/${file}`;
  if (check) {
    if (changed.length === 0) {
      console.log('✓ templates/cloudflare-worker matches what ondocs init writes.');
    } else {
      console.error(
        [
          '✗ templates/cloudflare-worker is out of date with what ondocs init writes:',
          ...changed.map(([file]) => `  changed: ${show(file)}`),
          'Run `pnpm build && node scripts/sync-template.mjs` and commit the result.',
        ].join('\n'),
      );
      process.exitCode = 1;
    }
  } else {
    for (const [file, text] of changed) {
      mkdirSync(dirname(join(TEMPLATE, file)), { recursive: true });
      writeFileSync(join(TEMPLATE, file), text);
    }
    console.log(`✓ Wrote ${String(changed.length)} files of templates/cloudflare-worker.`);
  }
} finally {
  rmSync(site, { recursive: true, force: true });
}
