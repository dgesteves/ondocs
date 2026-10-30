// The dialog's styles for touch screens and for forced colors (Windows High Contrast), which jsdom
// does not apply: a phone gets a Close button and targets of 44 px, and forced colors keep the
// selected suggestion and the cited sources visible after they drop backgrounds and shadows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(import.meta.dirname, '..', path), 'utf8');
const css = read('src/react/styles.css');

/** The rules inside every `@media <query> { … }` of `source`, joined. */
function media(source: string, query: string): string {
  const bodies: string[] = [];
  const opening = `@media ${query} {`;
  for (let at = source.indexOf(opening); at !== -1; at = source.indexOf(opening, at + 1)) {
    let depth = 0;
    const start = at + opening.length;
    for (let i = start - 1; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) {
        bodies.push(source.slice(start, i));
        break;
      }
    }
  }
  return bodies.join('\n');
}

/** The declarations of every rule in `source` whose selector list includes `selector`, joined. */
function rule(source: string, selector: string): string {
  const declarations: string[] = [];
  const rules = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) declarations.push(match[2] ?? '');
  }
  return declarations.join('\n');
}

describe('on a touch screen', () => {
  it('shows a Close button of 44 px in place of the esc hint', () => {
    expect(rule(css, '.ask-close')).toMatch(/display:\s*none;/);
    const touch = media(css, '(hover: none)');
    expect(rule(touch, '.ask-close')).toMatch(/display:\s*inline-flex;/);
    expect(rule(touch, '.ask-input-row > .ask-kbd')).toMatch(/display:\s*none;/);
    expect(rule(css, '.ask-close')).toMatch(/width:\s*44px;[\s\S]*height:\s*44px;/);
  });

  it('makes buttons and the comment field 44 px tall, and citations easier to hit', () => {
    const coarse = media(css, '(pointer: coarse)');
    for (const selector of [
      '.ask-stop',
      '.ask-retry',
      '.ask-new',
      '.ask-feedback-button',
      '.ask-feedback-more',
      '.ask-feedback-input',
    ]) {
      expect([selector, rule(coarse, selector)]).toEqual([
        selector,
        expect.stringMatching(/height:\s*44px;/),
      ]);
    }
    expect(rule(coarse, '.ask-feedback-button')).toMatch(/min-width:\s*44px;/);
    // A citation keeps its look, with a larger area to tap, and one right after another keeps
    // far enough from it that their areas do not meet.
    expect(rule(coarse, '.ask-citation')).toMatch(/position:\s*relative;/);
    // Next to words and punctuation it keeps its usual margins: "it [1]." with no gap before ".".
    expect(rule(coarse, '.ask-citation')).not.toMatch(/margin/);
    const reach = Number(/inset:\s*-(\d+)px;/.exec(rule(coarse, '.ask-citation::after'))?.[1]);
    expect(reach).toBeGreaterThan(0);
    const apart = /margin-inline-start:\s*(\d+)px;/.exec(
      rule(coarse, '.ask-citation[data-after-citation]'),
    )?.[1];
    expect(Number(apart)).toBeGreaterThanOrEqual(2 * reach);
  });
});

describe('in forced colors', () => {
  it('outlines the selected suggestion, which keyboard focus is on', () => {
    expect(rule(media(css, '(forced-colors: active)'), ".ask-item[data-selected='true']")).toMatch(
      /outline:\s*2px solid Highlight;/,
    );
  });

  it('fills the numbers of the sources the answer cites, as it does outside them', () => {
    const cited = ".ask-source[data-cited='true'] .ask-source-id";
    expect(rule(css, cited)).toMatch(/background:\s*var\(--ask-accent\);/);
    expect(rule(media(css, '(forced-colors: active)'), cited)).toMatch(
      /forced-color-adjust:\s*none;[\s\S]*background:\s*Highlight;/,
    );
  });

  it.each(['src/embed/button.css', 'src/docusaurus/launcher.css'])(
    'gives the navbar button a border in %s, which forced colors would leave as bare text',
    (path) => {
      expect(rule(media(read(path), '(forced-colors: active)'), '.ondocs-button')).toMatch(
        /border:\s*1px solid ButtonText;/,
      );
    },
  );
});
