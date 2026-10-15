// @vitest-environment jsdom
// The home page's demo (examples/nextjs/components/landing/hero-demo.tsx): the sources the answer
// cites show, and the others fold into one line (demo-sources.tsx). On a phone it is a still of the
// same answer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoSources } from '../examples/nextjs/components/landing/demo-sources';
import { citedSourceIds } from '../src/react/answer';

afterEach(cleanup);

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** What the live site's demo opened on: six sources, and one short answer citing the second. */
const SOURCES = [
  { id: 1, url: '/docs/docusaurus', title: 'Docusaurus', heading: '' },
  {
    id: 2,
    url: '/docs/docusaurus#add-it-to-docusaurusconfigts',
    title: 'Docusaurus',
    heading: 'Add it to docusaurus.config.ts',
  },
  {
    id: 3,
    url: '/docs/docusaurus#the-dialog-and-the-shortcut',
    title: 'Docusaurus',
    heading: 'The dialog and the shortcut',
  },
];
const ANSWER =
  "Put the plugin in the `plugins` array of `docusaurus.config.ts`: `plugins: ['ondocs/docusaurus']`. [2]";

const sources = (answer: string, complete = true) =>
  render(
    <DemoSources
      sources={SOURCES}
      cited={citedSourceIds(answer)}
      complete={complete}
      onNavigate={vi.fn()}
    />,
  ).container.querySelector('.demo-sources')!;

const shown = (element: Element) =>
  [...element.querySelectorAll(':scope > ol a')].map((a) => [
    text(a.querySelector('.demo-source-title')),
    a.getAttribute('data-cited'),
  ]);

describe('the home page’s demo', () => {
  it('shows the source the answer cites, and folds the others into one closed line', () => {
    const element = sources(ANSWER);
    expect(shown(element)).toEqual([['Docusaurus › Add it to docusaurus.config.ts', 'true']]);
    const more = element.querySelector('details')!;
    expect(more.open).toBe(false);
    expect(text(more.querySelector('summary'))).toBe('2 more sources, not cited');
    expect(
      [...more.querySelectorAll('a')].map((a) => [
        a.getAttribute('href'),
        a.getAttribute('data-cited'),
      ]),
    ).toEqual([
      ['/docs/docusaurus', 'false'],
      ['/docs/docusaurus#the-dialog-and-the-shortcut', 'false'],
    ]);
  });

  it('while the answer streams, says nothing of the sources it has not cited yet', () => {
    const element = sources('Put the plugin in the', false);
    expect(shown(element)).toEqual([]);
    const more = element.querySelector('details')!;
    expect(text(more.querySelector('summary'))).toBe('3 sources');
    expect([...more.querySelectorAll('a')].map((a) => a.getAttribute('data-cited'))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('shows every source it cites, and no fold when it cites them all', () => {
    const element = sources('One [1], two [2] and three [3].');
    expect(element.querySelectorAll(':scope > ol a')).toHaveLength(3);
    expect(element.querySelector('details')).toBeNull();
  });

  it('folds one source as one source', () => {
    expect(text(sources('One [1] and two [2].').querySelector('summary'))).toBe(
      '1 more source, not cited',
    );
  });
});

describe('the home page’s demo on a phone', () => {
  const landing = (file: string) =>
    readFileSync(join(import.meta.dirname, '../examples/nextjs', file), 'utf8');
  const phone = (landing('app/(home)/landing.css').split('@media (max-width: 800px) {')[1] ?? '')
    // Without its comments.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('is a still of the same answer: no box to type in, and no questions to pick', () => {
    expect(phone).toMatch(
      /\.hero \.demo\[data-still\] \.demo-input,\s*\.hero \.demo\[data-still\] \.demo-chips \{\s*display: none;\s*\}/,
    );
  });

  it('stays a demo to type in when the build got no answer', () => {
    // Only a demo marked as a still loses its input and chips…
    for (const part of ['.demo-input', '.demo-chips']) {
      const selectors = [...phone.matchAll(/([^{}]+)\{[^}]*display: none;[^}]*\}/g)]
        .flatMap(([, list]) => (list ?? '').split(','))
        .map((selector) => selector.trim())
        .filter((selector) => selector.endsWith(part));
      expect(selectors, part).toEqual([`.hero .demo[data-still] ${part}`]);
    }
    // …and the demo is marked so only when it opens on the answer asked at build time.
    expect(landing('components/landing/hero-demo.tsx')).toContain(
      "data-still={initial ? '' : undefined}",
    );
  });
});
