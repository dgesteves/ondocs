import { createHighlighter, type Highlighter, type ThemeRegistration } from 'shiki';

interface Palette {
  background: string;
  text: string;
  comment: string;
  keyword: string;
  string: string;
  name: string;
  type: string;
  key: string;
  punctuation: string;
}

/**
 * Code colors from the site's palette: cyan for strings and names, magenta for keywords, muted
 * for punctuation and comments. Each color keeps 4.5:1 on its theme's code background.
 * Highlighting runs at build time; the page ships plain HTML.
 */
const PALETTES: Record<'light' | 'dark', Palette> = {
  dark: {
    background: '#14181d',
    text: '#dfe6ee',
    comment: '#7c8796',
    keyword: '#f0468a',
    string: '#67e8f9',
    name: '#22d3ee',
    type: '#a5f3fc',
    key: '#f5f7fa',
    punctuation: '#9aa6b4',
  },
  light: {
    background: '#f6f7f9',
    text: '#1f2937',
    comment: '#5f6875',
    keyword: '#be185d',
    string: '#155e75',
    name: '#0e7490',
    type: '#164e63',
    key: '#0d0f12',
    punctuation: '#4b5563',
  },
};

function theme(type: 'light' | 'dark'): ThemeRegistration {
  const c = PALETTES[type];
  return {
    name: `ondocs-${type}`,
    type,
    colors: { 'editor.background': c.background, 'editor.foreground': c.text },
    tokenColors: [
      { settings: { foreground: c.text } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.comment } },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'keyword.control',
          'keyword.operator.new',
          'keyword.operator.expression',
        ],
        settings: { foreground: c.keyword },
      },
      {
        scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'],
        settings: { foreground: c.string },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'constant.character'],
        settings: { foreground: c.string },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call entity.name.function',
          'entity.name.tag',
          'support.class.component',
        ],
        settings: { foreground: c.name },
      },
      {
        scope: ['entity.name.type', 'support.type', 'entity.other.attribute-name'],
        settings: { foreground: c.type },
      },
      {
        scope: ['variable.parameter', 'meta.object-literal.key', 'support.type.property-name'],
        settings: { foreground: c.key },
      },
      {
        scope: ['punctuation', 'meta.brace', 'keyword.operator'],
        settings: { foreground: c.punctuation },
      },
      // Shell: the command in the text's strongest color, flags muted, as they read in a terminal.
      {
        scope: ['entity.name.command', 'support.function.builtin'],
        settings: { foreground: c.key },
      },
      { scope: ['constant.other.option'], settings: { foreground: c.punctuation } },
    ],
  };
}

const LANGUAGES = ['ts', 'tsx', 'js', 'jsx', 'json', 'shellscript', 'toml', 'html'] as const;
const ALIASES: Partial<Record<string, string>> = {
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
};
const LABELS: Partial<Record<string, string>> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  sh: 'Terminal',
  bash: 'Terminal',
  shell: 'Terminal',
  toml: 'TOML',
  html: 'HTML',
};

let highlighter: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({
    themes: [theme('light'), theme('dark')],
    langs: [...LANGUAGES],
  });
  return highlighter;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Highlighted `<pre>` for a code block, or escaped plain text for a language it doesn't know. */
export async function highlight(code: string, lang = ''): Promise<string> {
  const language = ALIASES[lang] ?? lang;
  if (!(LANGUAGES as readonly string[]).includes(language)) {
    return `<pre class="shiki" tabindex="0"><code>${escapeHtml(code)}</code></pre>`;
  }
  // Each token's color is a light-dark() pair, so the code follows the page's color-scheme.
  return (await getHighlighter()).codeToHtml(code, {
    lang: language,
    themes: { light: 'ondocs-light', dark: 'ondocs-dark' },
    defaultColor: 'light-dark()',
  });
}

/**
 * A code block with its language and a copy button. The button works through the delegated
 * click handler in `CopyButtons`, so the block itself is static HTML.
 */
export async function codeBlock(code: string, lang = '', title?: string): Promise<string> {
  const label = title ?? LABELS[lang] ?? (lang ? lang.toUpperCase() : 'Text');
  const head = `<div class="code-head"><span class="code-label">${escapeHtml(label)}</span><button type="button" class="copy-button" data-copy aria-label="Copy code">Copy</button></div>`;
  return `<div class="code-block">${head}${await highlight(code.replace(/\n$/, ''), lang)}</div>`;
}
