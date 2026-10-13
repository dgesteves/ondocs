// @vitest-environment jsdom
// The code in an answer: coloured by a small tokenizer (src/react/code.ts), still as text nodes.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AskAnswer } from '../src/react';
import { fenceLanguage, tokenizeCode } from '../src/react/code';

afterEach(cleanup);

/** Each coloured token as `kind:text`. */
const kinds = (code: string, lang?: string) =>
  tokenizeCode(code, lang).flatMap((token) => (token.kind ? [`${token.kind}:${token.text}`] : []));

describe('the answer code tokenizer', () => {
  it('finds keywords, strings, numbers and comments in a script', () => {
    expect(
      kinds(
        "// docusaurus.config.ts\nexport default { plugins: ['ondocs/docusaurus'], n: 2 };",
        'ts',
      ),
    ).toEqual([
      'comment:// docusaurus.config.ts',
      'keyword:export',
      'keyword:default',
      "string:'ondocs/docusaurus'",
      'number:2',
    ]);
  });

  it('keeps every character, in order', () => {
    const code = "import { a } from 'b'; /* c */ const d = `e ${1}`; // f";
    expect(
      tokenizeCode(code, 'ts')
        .map((token) => token.text)
        .join(''),
    ).toBe(code);
  });

  it('leaves a URL’s slashes alone, and a word that only looks like a keyword', () => {
    expect(kinds("fetch('https://docs.acme.dev/api/ask')", 'js')).toEqual([
      "string:'https://docs.acme.dev/api/ask'",
    ]);
    expect(kinds('const url = https://example.com', 'js')).toEqual(['keyword:const']);
    expect(kinds('npx ondocs index ./docs # build it', 'sh')).toEqual(['comment:# build it']);
    // No keywords in a shell command or in JSON.
    expect(kinds('if true; then echo default; fi', 'sh')).toEqual([]);
  });

  it('colours the keys of JSON and YAML', () => {
    expect(kinds('{ "overrides": { "zod": "4.1.13" }, "n": 1 }', 'json')).toEqual([
      'property:"overrides"',
      'property:"zod"',
      'string:"4.1.13"',
      'property:"n"',
      'number:1',
    ]);
    expect(kinds('thresholds:\n  hit@3: 0.8\n  - question: How?', 'yaml')).toEqual([
      'property:thresholds',
      'property:hit@3',
      'number:0.8',
      'property:question',
    ]);
  });

  it('reads markup comments in HTML, and an unclosed comment while it streams', () => {
    expect(kinds('<!-- the dialog -->\n<script src="x.js"></script>', 'html')).toEqual([
      'comment:<!-- the dialog -->',
      'string:"x.js"',
    ]);
    expect(kinds('/* still streaming', 'ts')).toEqual(['comment:/* still streaming']);
  });

  it('takes the language from the fence', () => {
    expect(fenceLanguage('```ts\nx\n```')).toBe('ts');
    expect(fenceLanguage('~~~JSON title="a.json"\n{}\n~~~')).toBe('json');
    expect(fenceLanguage('```\nx\n```')).toBe('');
  });
});

describe('an answer’s code block', () => {
  it('renders the tokens as spans of text, and names the language', () => {
    const { container } = render(
      <AskAnswer
        text={"Add it:\n\n```ts\nexport default { plugins: ['ondocs/docusaurus'] };\n```"}
        sources={[]}
      />,
    );
    const pre = container.querySelector('pre.ask-pre');
    expect(pre?.getAttribute('data-lang')).toBe('ts');
    expect(pre?.textContent).toBe("export default { plugins: ['ondocs/docusaurus'] };");
    expect([...container.querySelectorAll('pre span')].map((span) => span.className)).toEqual([
      'ask-tok-keyword',
      'ask-tok-keyword',
      'ask-tok-string',
    ]);
  });

  it('never turns the model’s text into markup', () => {
    const { container } = render(
      <AskAnswer text={'```html\n<img src=x onerror="alert(1)">\n```'} sources={[]} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });
});
