/**
 * Terminal and tool output, coloured by meaning rather than by a language grammar: the small
 * grammar the three sibling sites share. Prompts dim and the command after them bright; errors
 * red, warnings amber, info dim, ✓ and passes green; ids (rule names, tool names) in the accent;
 * file paths, URLs and line:col positions dim; quoted strings and inline code tinted as strings
 * are in code; and Markdown in the output keeps its structure: headings bold, bullets dim.
 *
 * It returns HTML in the shape Shiki's does (a `<pre>` of `.line` spans), with a `t-<kind>` class
 * per token; app/globals.css colours them for both themes.
 */

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface TerminalOptions {
  /** Names shown in the accent colour wherever they appear, such as rule ids or tool names. */
  ids?: readonly string[];
}

/** A command line: a prompt (`$`, `>` or `❯`) and a space, then the command. */
const PROMPT = /^(\s*)([$>❯])( +)(.*)$/;
const HEADING = /^(\s*)(#{1,6})( +)(.+)$/;
const BULLET = /^(\s*)([-*•]|\d{1,3}[.)])( +)(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** A trailing shell comment on a command line. */
const COMMENT = /(?:^|\s)#\s/;

const POSITION = String.raw`(?::\d+(?::\d+)?)?`;

/**
 * A level word (`error`, `warning`...) where it is a level: first on the line (after any marks),
 * or right before a colon or a closing bracket, as in `error:` and `[warn]`. Not inside a
 * sentence, such as a question about warning callouts.
 */
const level = (words: string) =>
  String.raw`(?<=^[\s✗✖✓✔⚠•*-]*)(?:${words})\b|\b(?:${words})(?=[:\])])`;
const EXTENSIONS =
  'json|jsonc|ts|tsx|mts|cts|js|mjs|cjs|jsx|md|mdx|ya?ml|toml|html|css|txt|astro|vue';

/** Inline tokens, first match wins. No capturing groups inside: each is one group below. */
const INLINE: [kind: string, pattern: string][] = [
  ['bold', String.raw`\*\*[^*\n]+\*\*`],
  ['code', String.raw`\`[^\`\n]+\``],
  ['string', String.raw`(?<![\w'"])"[^"\n]*"|(?<![\w'"])'[^'\n]*'(?!\w)`],
  ['path', String.raw`https?:\/\/[^\s)'",]+`],
  ['path', String.raw`(?:\.{1,2}\/|\/)?(?:[\w@.-]+\/)+[\w@.[\]-]*${POSITION}`],
  ['path', String.raw`(?<![\w-])[\w.-]+\.(?:${EXTENSIONS})${POSITION}(?![\w-])`],
  ['position', String.raw`\b\d+:\d+\b`],
  ['error', `${level('error|errors|Error|ERROR|failed|FAILED|FAIL')}|✗|✖`],
  ['warn', `${level('warn|warning|warnings|Warning|WARN|WARNING')}|⚠`],
  ['info', level('info|INFO')],
  ['ok', `✓|✔|${level('passed|PASS|ok|OK')}`],
  ['dim', '→|←|›'],
];

/** The class each inline kind is drawn with. */
const CLASS: Record<string, string> = {
  string: 'string',
  path: 'dim',
  position: 'dim',
  error: 'error',
  warn: 'warn',
  info: 'dim',
  ok: 'ok',
  dim: 'dim',
  id: 'id',
};

const span = (kind: string, html: string) => `<span class="t-${kind}">${html}</span>`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function inlineTokenizer(options: TerminalOptions): (text: string) => string {
  const patterns = [...INLINE];
  if (options.ids && options.ids.length > 0) {
    const ids = [...options.ids].sort((a, b) => b.length - a.length).map(escapeRegExp);
    // Before paths, so a rule id with a slash (`plugin/rule`) stays an id.
    patterns.splice(2, 0, ['id', String.raw`(?<![\w-])(?:${ids.join('|')})(?![\w-])`]);
  }
  const pattern = new RegExp(patterns.map(([, source]) => `(${source})`).join('|'), 'g');
  return (text) => {
    let out = '';
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      out += escapeHtml(text.slice(last, match.index));
      last = match.index + match[0].length;
      const kind = patterns[match.slice(1).findIndex(Boolean)]?.[0] ?? '';
      const raw = match[0];
      if (kind === 'bold' || kind === 'code') {
        // The Markdown marks stay, dimmed, so the text copies as it was printed.
        const mark = kind === 'bold' ? '**' : '`';
        const inner = escapeHtml(raw.slice(mark.length, -mark.length));
        out += `${span('dim', mark)}${span(kind === 'bold' ? 'bold' : 'string', inner)}${span('dim', mark)}`;
      } else {
        out += span(CLASS[kind] ?? 'dim', escapeHtml(raw));
      }
    }
    return out + escapeHtml(text.slice(last));
  };
}

function renderLine(text: string, inline: (text: string) => string): string {
  const prompt = PROMPT.exec(text);
  if (prompt) {
    const [, indent = '', mark = '', gap = '', rest = ''] = prompt;
    const hash = COMMENT.exec(rest)?.index ?? -1;
    const command = hash === -1 ? rest : rest.slice(0, hash);
    const comment = hash === -1 ? '' : rest.slice(hash);
    return `${indent}${span('prompt', escapeHtml(mark))}${gap}${span('command', escapeHtml(command))}${comment ? span('dim', escapeHtml(comment)) : ''}`;
  }
  const heading = HEADING.exec(text);
  if (heading) {
    const [, indent = '', marks = '', gap = '', rest = ''] = heading;
    return `${indent}${span('dim', marks)}${gap}${span('heading', inline(rest))}`;
  }
  const bullet = BULLET.exec(text);
  if (bullet) {
    const [, indent = '', mark = '', gap = '', rest = ''] = bullet;
    return `${indent}${span('dim', escapeHtml(mark))}${gap}${inline(rest)}`;
  }
  if (TABLE_ROW.test(text)) {
    return text
      .split('|')
      .map((cell) =>
        /^\s*:?-{3,}:?\s*$/.test(cell) ? span('dim', escapeHtml(cell)) : inline(cell),
      )
      .join(span('dim', '|'));
  }
  return inline(text);
}

/** Terminal or tool output as highlighted HTML, a `<pre>` like Shiki's. */
export function terminalHtml(code: string, options: TerminalOptions = {}): string {
  const inline = inlineTokenizer(options);
  const lines = code
    .split('\n')
    .map((line) => `<span class="line">${renderLine(line, inline)}</span>`);
  return `<pre class="shiki terminal" tabindex="0"><code>${lines.join('\n')}</code></pre>`;
}

/**
 * The commands in a transcript, one per line, without their prompts, output or trailing
 * comments: what its Copy button copies. Null when no line has a prompt.
 */
export function transcriptCommands(code: string): string | null {
  const commands = code.split('\n').flatMap((line) => {
    const rest = PROMPT.exec(line)?.[4];
    if (rest === undefined) return [];
    const hash = COMMENT.exec(rest)?.index ?? -1;
    return [(hash === -1 ? rest : rest.slice(0, hash)).trimEnd()];
  });
  return commands.length > 0 ? commands.join('\n') : null;
}
