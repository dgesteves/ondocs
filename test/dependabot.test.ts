// Dependabot's schedule: GitHub Actions updates come monthly, as in onsystem and signoff-ui, the
// two sibling projects, so the three repositories move their pinned actions together.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const config = parse(
  readFileSync(join(import.meta.dirname, '../.github/dependabot.yml'), 'utf8'),
) as { updates: { 'package-ecosystem': string; schedule: { interval: string } }[] };

describe('Dependabot', () => {
  it('updates the GitHub Actions monthly', () => {
    const actions = config.updates.find(
      (update) => update['package-ecosystem'] === 'github-actions',
    );
    expect(actions?.schedule.interval).toBe('monthly');
  });
});
