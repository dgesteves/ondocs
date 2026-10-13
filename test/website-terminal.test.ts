// @vitest-environment jsdom
// The website's terminal grammar (examples/nextjs/lib/terminal.ts): terminal and tool output,
// coloured by meaning, as the three sibling sites colour it.
import { describe, expect, it } from 'vitest';

import { codeBlock } from '../examples/nextjs/lib/highlight';
import { terminalHtml, transcriptCommands } from '../examples/nextjs/lib/terminal';

/** Each token as `kind:text`, in order, without the plain text between. */
function tokens(html: string): string[] {
  return [...html.matchAll(/<span class="t-(\w+)">([^<]*)<\/span>/g)].map(
    ([, kind, text]) => `${kind ?? ''}:${text ?? ''}`,
  );
}

describe('the terminal grammar', () => {
  it('dims the prompt and brightens the command after it, with its comment dim', () => {
    expect(tokens(terminalHtml('$ npx ondocs init  # writes the endpoint'))).toEqual([
      'prompt:$',
      'command:npx ondocs init ',
      'dim: # writes the endpoint',
    ]);
    expect(tokens(terminalHtml('❯ pnpm build'))).toEqual(['prompt:❯', 'command:pnpm build']);
  });

  it('colours errors, warnings, info and passes by meaning', () => {
    expect(
      tokens(terminalHtml('error: no index\nwarning: stale\ninfo: 3 pages\n✓ passed')),
    ).toEqual(['error:error', 'warn:warning', 'dim:info', 'ok:✓', 'ok:passed']);
    expect(tokens(terminalHtml('✗ failed'))).toEqual(['error:✗', 'error:failed']);
  });

  it('puts ids in the accent, and dims paths, URLs and positions', () => {
    const html = terminalHtml(
      'src/app.tsx:12:5 no-unknown-variant at http://localhost:8787/api/ask, see ask-index.json',
      { ids: ['no-unknown-variant'] },
    );
    expect(tokens(html)).toEqual([
      'dim:src/app.tsx:12:5',
      'id:no-unknown-variant',
      'dim:http://localhost:8787/api/ask',
      'dim:ask-index.json',
    ]);
  });

  it('tints quoted strings and inline code as strings', () => {
    expect(tokens(terminalHtml('expected "primary", got `danger`'))).toEqual([
      'string:&quot;primary&quot;',
      'dim:`',
      'string:danger',
      'dim:`',
    ]);
    // An apostrophe is not a quote.
    expect(tokens(terminalHtml("it doesn't know"))).toEqual([]);
  });

  it('keeps Markdown’s structure: headings bold, bullets and table rules dim', () => {
    expect(
      tokens(terminalHtml('## Findings\n- **Button**: 2 issues\n| a | b |\n| --- | --- |')),
    ).toEqual([
      'dim:##',
      'heading:Findings',
      'dim:-',
      'dim:**',
      'bold:Button',
      'dim:**',
      'dim:|',
      'dim:|',
      'dim:|',
      'dim:|',
      'dim: --- ',
      'dim:|',
      'dim: --- ',
      'dim:|',
    ]);
  });

  it('escapes the output, which may hold markup', () => {
    const html = terminalHtml('<script>alert("x")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps every character, so the block copies as it was printed', () => {
    const text =
      '$ npx ondocs eval ask-eval.yaml\n  ✓ 1   How?   cov 1.00  → /docs/cli\n\n  hit@3  1.00';
    const pre = new DOMParser()
      .parseFromString(terminalHtml(text), 'text/html')
      .querySelector('pre');
    expect(pre?.textContent).toBe(text);
  });
});

describe('a transcript', () => {
  it('copies its commands, without prompts, comments or output', () => {
    expect(
      transcriptCommands('$ npm i ondocs\nadded 1 package\n$ npx ondocs dev  # serves it\nready'),
    ).toBe('npm i ondocs\nnpx ondocs dev');
    expect(transcriptCommands('just output')).toBeNull();
  });

  it('gives its block a button that copies the commands', async () => {
    const html = await codeBlock('$ npx ondocs index ./docs -e mock\n✓ 366 chunks', 'console');
    expect(html).toContain(
      'data-copy="npx ondocs index ./docs -e mock" aria-label="Copy the commands"',
    );
    expect(html).toContain('<span class="code-label code-label-language">Terminal</span>');
    expect(html).toContain('class="shiki terminal"');
  });
});

describe('level words', () => {
  it('count as levels first on the line, or before a colon or a bracket, not inside a sentence', () => {
    expect(
      tokens(terminalHtml('  ✗ refused   How do I add a tip or warning callout box?')),
    ).toEqual(['error:✗']);
    expect(tokens(terminalHtml('[warn] stale index, 2 errors: see above'))).toEqual([
      'warn:warn',
      'error:errors',
    ]);
  });
});
