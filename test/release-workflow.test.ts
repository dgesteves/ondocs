import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  uses?: string;
  with?: Record<string, string>;
}

const root = join(import.meta.dirname, '..');
const workflow = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')) as {
  jobs: Record<string, { steps: Step[] }>;
};
const scripts = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const changesets = Object.values(workflow.jobs)
  .flatMap((job) => job.steps)
  .find((step) => step.uses?.startsWith('changesets/action@'));

describe('release workflow', () => {
  // changesets/action splits these on spaces and runs them without a shell, so `&&` or a pipe
  // reaches the command as an argument and the release pull request never updates.
  it.each(['version-script', 'publish-script'])('runs %s as one package.json script', (input) => {
    const command = changesets?.with?.[input];
    expect(command).toMatch(/^pnpm [\w:-]+$/);
    expect(scripts[command!.slice('pnpm '.length)]).toBeDefined();
  });

  // Without the pins, the release pull request fails test/package.test.ts: its version is the next
  // minor, and the docs' script tags are still at the last one.
  it('moves the Worker template and the docs’ jsDelivr pins when it versions the packages', () => {
    expect(scripts['version-packages']).toBe(
      'changeset version && node scripts/sync-template.mjs && node scripts/sync-cdn-range.mjs',
    );
  });
});
