import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../src/react/styles.css'), 'utf8');

/** The custom properties a block of `css` sets: `--ask-bg: #fff` → `{ bg: '#fff' }`. */
function tokens(block: RegExp): Record<string, string> {
  const body = block.exec(css)?.[1];
  if (body === undefined) throw new Error(`No block matches ${String(block)}`);
  return Object.fromEntries(
    Array.from(body.matchAll(/--ask-([\w-]+):\s*([^;]+);/g), (match) => [match[1], match[2]]),
  ) as Record<string, string>;
}

const THEMES = {
  light: tokens(/^\.ask-overlay,\s*\.ask-dialog\s*\{([^}]*)\}/m),
  'dark (system)': tokens(/@media \(prefers-color-scheme: dark\)\s*\{[^{]*\{([^}]*)\}/),
  'dark (pinned)': tokens(/\.ask-dialog\[data-ask-theme='dark'\]\s*\{([^}]*)\}/),
};

/** `#rrggbb` or `rgb(r g b / a)`, composited over `background` when it has an alpha. */
function rgb(color: string, background?: number[]): number[] {
  const hex = /^#([\da-f]{6})$/i.exec(color)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const match = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(color);
  if (!match || !background) throw new Error(`Cannot read ${color}`);
  const alpha = Number(match[4]);
  return [1, 2, 3].map((i) => Number(match[i]) * alpha + (background[i - 1] ?? 0) * (1 - alpha));
}

/** WCAG 2 contrast ratio. */
function contrast(a: number[], b: number[]): number {
  const luminance = (color: number[]) => {
    const [r = 0, g = 0, bl = 0] = color.map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe('the default theme', () => {
  it.each(Object.entries(THEMES))('keeps text at 4.5:1 or more in %s', (_, theme) => {
    const ratios: Record<string, number> = {};
    for (const surface of ['bg', 'raised']) {
      const background = rgb(theme[surface] ?? '');
      for (const text of [
        'fg',
        'muted',
        'subtle',
        'accent',
        'danger',
        // An answer's code, on the raised code block (and on bg, where a host restyles it).
        'code-comment',
        'code-keyword',
        'code-string',
        'code-number',
        'code-property',
      ]) {
        ratios[`${text} on ${surface}`] = contrast(rgb(theme[text] ?? ''), background);
      }
    }
    // Citation chips and the "Ask" label: accent text on the accent tint.
    const bg = rgb(theme.bg ?? '');
    ratios['accent on accent-soft'] = contrast(
      rgb(theme.accent ?? ''),
      rgb(theme['accent-soft'] ?? '', bg),
    );
    for (const [pair, ratio] of Object.entries(ratios)) {
      expect([pair, ratio >= 4.5]).toEqual([pair, true]);
    }
  });

  it('pins the same dark theme it follows from the system', () => {
    expect(THEMES['dark (pinned)']).toEqual(THEMES['dark (system)']);
  });

  it('never fades text with opacity, which would undo its contrast', () => {
    const rules = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
    expect(rules).not.toMatch(/opacity\s*:/);
  });
});

describe('the answer area', () => {
  it('leaves no blank line over an error, which shows under the question instead', () => {
    expect(css).toMatch(/\.ask-answer\[data-status='error'\]\s*\{\s*min-height:\s*0;\s*\}/);
  });
});
