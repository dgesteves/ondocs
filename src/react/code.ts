/**
 * Colours for the code in an answer: a small tokenizer, not a grammar, so the dialog stays small.
 * It finds comments, strings, numbers, keywords and the keys of JSON and YAML, which is most of
 * what makes code read as code; anything else is plain text. Each kind is a class,
 * `ask-tok-<kind>`, coloured by the `--ask-code-<kind>` custom properties.
 */

export type CodeTokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'property';

export interface CodeToken {
  text: string;
  /** Undefined for plain text. */
  kind?: CodeTokenKind;
}

/** Languages whose comments start with `#`. */
const HASH_COMMENTS = new Set([
  'sh',
  'bash',
  'shell',
  'zsh',
  'console',
  'yaml',
  'yml',
  'toml',
  'py',
  'python',
  'rb',
  'ruby',
  'dockerfile',
  'ini',
  'env',
]);

/** Languages whose comments are `<!-- -->`. */
const MARKUP = new Set(['html', 'xml', 'svg', 'vue', 'svelte', 'astro', 'md', 'mdx', 'markdown']);

/** Languages with no keywords to colour. */
const NO_KEYWORDS = new Set([
  ...HASH_COMMENTS,
  ...MARKUP,
  'json',
  'jsonc',
  'text',
  'txt',
  'css',
  'diff',
]);

/** Languages whose `key:` at the start of a line is a key. */
const KEYED = new Set(['yaml', 'yml', 'toml', 'ini', 'env']);

const KEYWORDS = new Set(
  (
    'import export from default const let var function return async await new class extends ' +
    'if else for of in while do switch case break continue throw try catch finally typeof ' +
    'instanceof void delete yield type interface enum implements as satisfies true false null ' +
    'undefined this super static readonly public private protected declare keyof'
  ).split(' '),
);

const STRING = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\]|\\.)*\``;
const NUMBER = String.raw`(?<![\w$.])(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)(?![\w$])`;
const WORD = String.raw`[A-Za-z_$][\w$]*`;

/** One pattern per language family: each alternative a group, in the order of `KINDS`. */
function patternFor(lang: string): { pattern: RegExp; kinds: (CodeTokenKind | 'word')[] } {
  const comment = HASH_COMMENTS.has(lang)
    ? String.raw`(?<![^\s])#.*`
    : MARKUP.has(lang)
      ? String.raw`<!--[\s\S]*?(?:-->|$)`
      : // `//` after a space or at the start, so a URL's `https://` is not a comment.
        String.raw`(?<![^\s([{,;=])\/\/.*|\/\*[\s\S]*?(?:\*\/|$)`;
  const parts: [CodeTokenKind | 'word', string][] = [
    ['comment', comment],
    ['property', KEYED.has(lang) ? String.raw`^[ \t-]*[\w.@-]+(?=[ \t]*[:=](?:\s|$))` : '(?!)'],
    ['string', STRING],
    ['number', NUMBER],
    ['word', WORD],
  ];
  return {
    pattern: new RegExp(parts.map(([, source]) => `(${source})`).join('|'), 'gm'),
    kinds: parts.map(([kind]) => kind),
  };
}

/** The tokens of `code` in `lang` (a fence's language, such as `ts` or `json`; may be empty). */
export function tokenizeCode(code: string, lang = ''): CodeToken[] {
  const language = lang.toLowerCase();
  const { pattern, kinds } = patternFor(language);
  const keywords = !NO_KEYWORDS.has(language);
  const tokens: CodeToken[] = [];
  let last = 0;
  const plain = (text: string) => {
    if (!text) return;
    const previous = tokens.at(-1);
    if (previous && previous.kind === undefined) previous.text += text;
    else tokens.push({ text });
  };
  for (const match of code.matchAll(pattern)) {
    const kind = kinds[match.slice(1).findIndex(Boolean)];
    plain(code.slice(last, match.index));
    last = match.index + match[0].length;
    const text = match[0];
    if (kind === 'word') {
      if (keywords && KEYWORDS.has(text)) tokens.push({ text, kind: 'keyword' });
      else plain(text);
    } else if (kind === 'property') {
      // The list marker and indentation before a YAML key stay plain.
      const start = /^[ \t-]*/.exec(text)?.[0] ?? '';
      plain(start);
      tokens.push({ text: text.slice(start.length), kind: 'property' });
    } else if (kind === 'string' && /^\s*:/.test(code.slice(last))) {
      // A quoted key: JSON's, or an object's.
      tokens.push({ text, kind: 'property' });
    } else if (kind) {
      tokens.push({ text, kind });
    }
  }
  plain(code.slice(last));
  return tokens;
}

/** The language a fence names: ```ts or ~~~ json title="x" → `ts`, `json`. */
export function fenceLanguage(segment: string): string {
  return /^ {0,3}(?:`{3,}|~{3,})[ \t]*([\w+#.-]*)/.exec(segment)?.[1]?.toLowerCase() ?? '';
}
