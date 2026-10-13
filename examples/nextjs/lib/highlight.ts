import { createHighlighter, type Highlighter, type ShikiTransformer } from 'shiki';

import { codeTheme } from './code-theme';
import { escapeHtml, terminalHtml, transcriptCommands } from './terminal';

export { escapeHtml } from './terminal';

/*
 * Code on the site, highlighted at build time: pages ship HTML and no highlighter. Source code
 * goes through Shiki with the sibling sites' theme pair (lib/code-theme.ts), each token's colour a
 * light-dark() pair, so it follows the page's color-scheme with no flash. Terminal and tool output
 * goes through the shared terminal grammar (lib/terminal.ts), and a stream of Server-Sent Events
 * through Shiki's JSON grammar, one event per line.
 */

const LANGUAGES = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'shellscript',
  'toml',
  'html',
  'yaml',
  'diff',
  'css',
  'markdown',
] as const;
const ALIASES: Partial<Record<string, string>> = {
  typescript: 'ts',
  javascript: 'js',
  jsonc: 'json',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
};
const LABELS: Partial<Record<string, string>> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  toml: 'TOML',
  html: 'HTML',
  yaml: 'YAML',
  yml: 'YAML',
  diff: 'Diff',
  css: 'CSS',
  md: 'Markdown',
  markdown: 'Markdown',
  console: 'Terminal',
  terminal: 'Terminal',
  'shell-session': 'Terminal',
  output: 'Output',
  log: 'Output',
  sse: 'Server-Sent Events',
};

/** Fences of terminal or tool output, which the terminal grammar colours. */
const TERMINAL = new Set([
  '',
  'text',
  'txt',
  'plaintext',
  'console',
  'terminal',
  'shell-session',
  'output',
  'log',
]);

/** A Server-Sent Events line: its field, then the value. */
const SSE_LINE = /^(data|event|id|retry):( ?)(.*)$/;

let highlighter: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({
    themes: [codeTheme('light'), codeTheme('dark')],
    langs: [...LANGUAGES],
  });
  return highlighter;
}

const THEMES = { light: 'ondocs-light', dark: 'ondocs-dark' } as const;

/**
 * Each token's style as the page uses it: its light-dark() color and, for comments, italics.
 * Shiki also writes each theme's values as --shiki-* properties, which nothing reads: left out,
 * they would double the size of every highlighted block in the page's HTML.
 */
const compactStyles: ShikiTransformer = {
  postprocess(html) {
    return html
      .replace(/--shiki-light-font-style:(\w+)/g, 'font-style:$1')
      .replace(/;?--shiki-(?:light|dark)(?:-bg|-font-style)?:[^;"]*/g, '');
  },
};

/**
 * A diff's added and removed lines in the family's add and delete colours, as signoff-ui's
 * DiffReview shows them: cyan for added, magenta for removed, text and tint (app/globals.css).
 * File headers (`+++`, `---`) keep the grammar's colours.
 */
const diffLines = (code: string): ShikiTransformer => {
  const kinds = code.split('\n').map((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
    if (line.startsWith('-') && !line.startsWith('---')) return 'del';
    return null;
  });
  return {
    line(node, line) {
      const kind = kinds[line - 1];
      if (kind) this.addClassToHast(node, `diff-${kind}`);
    },
    span(node, line) {
      const kind = kinds[line - 1];
      if (kind) node.properties.style = `color:var(--code-${kind})`;
    },
  };
};

/** Whether a block is a stream of Server-Sent Events: every line a field, or blank. */
export const isEventStream = (code: string): boolean => {
  const lines = code.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every((line) => SSE_LINE.test(line));
};

/** Server-Sent Events: each field name dim, each value through the JSON grammar. */
async function eventStreamHtml(code: string): Promise<string> {
  const lines = code.split('\n').map((line) => SSE_LINE.exec(line));
  const values = lines.map((match) => match?.[3] ?? '');
  return (await getHighlighter()).codeToHtml(values.join('\n'), {
    lang: 'json',
    themes: THEMES,
    defaultColor: 'light-dark()',
    transformers: [
      compactStyles,
      {
        pre(node) {
          this.addClassToHast(node, 'event-stream');
        },
        line(node, line) {
          const match = lines[line - 1];
          if (!match) return;
          node.children.unshift({
            type: 'element',
            tagName: 'span',
            properties: { class: 't-dim' },
            children: [{ type: 'text', value: `${match[1]}:${match[2]}` }],
          });
        },
      },
    ],
  });
}

/** Highlighted `<pre>` for a code block, by its language: source code, output or events. */
export async function highlight(code: string, lang = ''): Promise<string> {
  if (lang === 'sse' || (TERMINAL.has(lang) && isEventStream(code))) return eventStreamHtml(code);
  if (TERMINAL.has(lang)) return terminalHtml(code);
  const language = ALIASES[lang] ?? lang;
  if (!(LANGUAGES as readonly string[]).includes(language)) {
    return `<pre class="shiki" tabindex="0"><code>${escapeHtml(code)}</code></pre>`;
  }
  // Each token's color is a light-dark() pair, so the code follows the page's color-scheme.
  return (await getHighlighter()).codeToHtml(code, {
    lang: language,
    themes: THEMES,
    defaultColor: 'light-dark()',
    transformers: language === 'diff' ? [compactStyles, diffLines(code)] : [compactStyles],
  });
}

/**
 * Prose-like output wraps; source code scrolls sideways, so its lines stay as written. So do a
 * terminal session (`console`), whose output is often in columns, and a stream of events, one
 * event per line.
 */
const WRAPPED = new Set(['', 'text', 'txt', 'plaintext', 'output', 'log']);

const label = (lang: string, title?: string) =>
  title ?? LABELS[lang] ?? (lang ? lang.toUpperCase() : 'Text');

/**
 * The copy button in a block's bar: an icon, as on the sibling sites, drawn by its stylesheet so
 * each block's HTML stays small. With `text`, it copies that (a transcript's commands); without,
 * the code that shows.
 */
const copyButton = (text?: string) => {
  const name = text ? 'Copy the commands' : 'Copy code';
  return `<button type="button" class="copy-button" data-copy${text ? `="${escapeHtml(text)}"` : ''} aria-label="${name}" title="${name}"></button>`;
};

const blockClass = (lang: string) => (WRAPPED.has(lang) ? 'code-block code-wrap' : 'code-block');

/**
 * A code block with its language or file name and a copy button, in a bar above the code so the
 * button never covers it. The button works through the delegated click handler in
 * `CopyButtons`, so the block itself is static HTML. A transcript's button copies its commands.
 */
export async function codeBlock(code: string, lang = '', title?: string): Promise<string> {
  const text = code.replace(/\n$/, '');
  const html = await highlight(text, lang);
  const events = html.includes('event-stream');
  const commands = TERMINAL.has(lang) && !events ? transcriptCommands(text) : null;
  const name = events && !title ? (LABELS.sse ?? '') : label(lang, title);
  const head = `<div class="code-head"><span class="code-label${title ? '' : ' code-label-language'}">${escapeHtml(name)}</span>${copyButton(commands ?? undefined)}</div>`;
  return `<div class="${events ? 'code-block' : blockClass(lang)}" data-code-block>${head}${html}</div>`;
}

/**
 * One code block with a tab per variant, such as the same install for npm, pnpm, Yarn and Bun.
 * The tabs are the block's bar; the choice is remembered across blocks with the same `sync` key
 * (components/docs-enhancements.tsx). Without JavaScript the first tab shows.
 */
export async function codeTabs(
  variants: { label: string; code: string }[],
  lang: string,
  id: string,
  sync = 'package-manager',
): Promise<string> {
  const tabs = variants
    .map(
      (variant, i) =>
        `<button type="button" role="tab" id="${id}-tab-${String(i)}" aria-controls="${id}-panel-${String(i)}" aria-selected="${String(i === 0)}" tabindex="${i === 0 ? '0' : '-1'}" data-value="${escapeHtml(variant.label)}">${escapeHtml(variant.label)}</button>`,
    )
    .join('');
  const panels = await Promise.all(
    variants.map(
      async (variant, i) =>
        `<div role="tabpanel" id="${id}-panel-${String(i)}" aria-labelledby="${id}-tab-${String(i)}"${i === 0 ? '' : ' hidden'}>${await highlight(variant.code, lang)}</div>`,
    ),
  );
  const head = `<div class="code-head"><div role="tablist" class="tab-list" aria-label="Package manager">${tabs}</div>${copyButton()}</div>`;
  return `<div class="${blockClass(lang)} code-tabs" data-code-block data-tabs data-sync="${escapeHtml(sync)}">${head}${panels.join('')}</div>`;
}
