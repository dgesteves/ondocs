import { createSlugger, decodeEntities } from 'ondocs';
import { Marked, type Token, type TokenizerAndRendererExtension, type Tokens } from 'marked';

import { codeBlock, codeTabs, escapeHtml } from './highlight';

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

/** Callout kinds, and the names other docs frameworks use for them. */
const CALLOUTS: Record<string, { kind: 'note' | 'tip' | 'warning'; title: string } | undefined> = {
  note: { kind: 'note', title: 'Note' },
  info: { kind: 'note', title: 'Note' },
  important: { kind: 'note', title: 'Important' },
  tip: { kind: 'tip', title: 'Tip' },
  warning: { kind: 'warning', title: 'Warning' },
  caution: { kind: 'warning', title: 'Caution' },
  danger: { kind: 'warning', title: 'Warning' },
};

const NOTE = { kind: 'note', title: 'Note' } as const;

/** Inline code longer than this may break inside on a narrow column; shorter code never does. */
export const LONG_CODE = 28;

/**
 * Curly quotes and apostrophes in prose. `prev` is the character before `text`, which decides
 * whether a quote opens or closes.
 */
export function smartQuotes(text: string, prev = ' '): string {
  let out = '';
  let before = prev;
  for (const char of text) {
    if (char === '"' || char === "'") {
      const opens = /[\s([{—–-]/.test(before) || before === '';
      out += char === '"' ? (opens ? '“' : '”') : opens ? '‘' : '’';
    } else out += char;
    before = char;
  }
  return out;
}

/** A number and its unit stay on one line: "1.6 MB", "0.71 ms". */
export const keepUnits = (text: string): string =>
  text.replace(/(\d) (B|KB|kB|MB|GB|TB|ms|s|px)(?=$|[\s.,;:)!?])/g, '$1 $2');

/** npm, then the same command for pnpm, Yarn and Bun, for a block of `npm i` lines only. */
export function packageManagers(code: string): { label: string; code: string }[] | null {
  const lines = code.trim().split('\n');
  const install = /^npm (?:i|install)((?: +[^\s|&;]+)*) *$/;
  if (lines.length === 0 || !lines.every((line) => install.test(line))) return null;
  const variant = (add: string, bare: string, dev: string) =>
    lines
      .map((line) => {
        const args = (install.exec(line)?.[1] ?? '').trim();
        if (!args) return bare;
        return `${add} ${args.replace(/(^| )(?:-D|--save-dev)(?= |$)/, `$1${dev}`)}`;
      })
      .join('\n');
  return [
    { label: 'npm', code: lines.join('\n') },
    { label: 'pnpm', code: variant('pnpm add', 'pnpm install', '-D') },
    { label: 'yarn', code: variant('yarn add', 'yarn', '-D') },
    { label: 'bun', code: variant('bun add', 'bun install', '-d') },
  ];
}

/** A file name written as the block's first line, `// app/page.tsx` or `# wrangler.toml`. */
const FILE_COMMENT = /^(?:\/\/|#|<!--)\s*([\w@./[\]()-]+\.[a-z]{1,5})\s*(?:-->)?\s*$/i;

/**
 * The code block's language, title and code: the title from `title="…"` in the fence's info
 * string, or a first line that names a file, which is then left out of the code.
 */
export function codeParts(text: string, info = ''): { lang: string; title?: string; code: string } {
  const lang = /^\S*/.exec(info)?.[0] ?? '';
  const title = /title=(["'])(.+?)\1/.exec(info)?.[2];
  if (title) return { lang, title, code: text };
  const [first = '', ...rest] = text.split('\n');
  const file = FILE_COMMENT.exec(first);
  if (file && rest.length > 0) {
    return { lang, title: file[1], code: rest.join('\n').replace(/^\n/, '') };
  }
  return { lang, code: text };
}

interface ContainerToken {
  type: 'container';
  raw: string;
  kind: string;
  title: string;
  tokens: Token[];
  /** Tabs only: each tab's label, and its content. */
  labels: string[];
  panels: Token[][];
}

/**
 * `:::note`, `:::tip`, `:::warning` (and `info`, `caution`, `danger`, `important`), `:::steps`
 * and `:::tabs`, as Docusaurus, Starlight and VitePress write containers. In tabs, each
 * `@tab Label` line starts a tab.
 */
const containers: TokenizerAndRendererExtension = {
  name: 'container',
  level: 'block',
  start: (src) => /^:::\w/m.exec(src)?.index,
  tokenizer(src) {
    const match = /^:::(\w+)[ \t]*([^\n]*)\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    const [raw, name = '', title = '', body = ''] = match;
    const kind = name.toLowerCase();
    if (!(kind in CALLOUTS) && kind !== 'steps' && kind !== 'tabs') return undefined;
    const token: ContainerToken = {
      type: 'container',
      raw,
      kind,
      title: title.trim(),
      tokens: [],
      labels: [],
      panels: [],
    };
    if (kind === 'tabs') {
      for (const part of body.split(/^@tab[ \t]+/m).slice(1)) {
        const [label = '', ...content] = part.split('\n');
        token.labels.push(label.trim());
        token.panels.push(this.lexer.blockTokens(content.join('\n'), []));
      }
    } else token.tokens = this.lexer.blockTokens(body, []);
    return token;
  },
  childTokens: ['tokens', 'panels'],
  renderer(generic) {
    const token = generic as unknown as ContainerToken & { tabsId: number };
    if (token.kind === 'steps') {
      return `<div class="steps">${this.parser.parse(token.tokens)}</div>\n`;
    }
    if (token.kind === 'tabs') {
      const id = `tabs-${String(token.tabsId)}`;
      const tabs = token.labels
        .map(
          (label, i) =>
            `<button type="button" role="tab" id="${id}-tab-${String(i)}" aria-controls="${id}-panel-${String(i)}" aria-selected="${String(i === 0)}" tabindex="${i === 0 ? '0' : '-1'}">${escapeHtml(label)}</button>`,
        )
        .join('');
      const panels = token.panels
        .map(
          (panel, i) =>
            `<div role="tabpanel" id="${id}-panel-${String(i)}" aria-labelledby="${id}-tab-${String(i)}"${i === 0 ? '' : ' hidden'}>${this.parser.parse(panel)}</div>`,
        )
        .join('');
      return `<div class="tabs" data-tabs><div role="tablist" class="tab-list">${tabs}</div>${panels}</div>\n`;
    }
    const callout = CALLOUTS[token.kind] ?? NOTE;
    return callout_(callout.kind, token.title || callout.title, this.parser.parse(token.tokens));
  },
};

const callout_ = (kind: string, title: string, html: string) =>
  `<div class="callout callout-${kind}" role="note"><p class="callout-title">${escapeHtml(title)}</p>${html}</div>\n`;

/**
 * Renders a page's Markdown, with heading ids from ondocs's own slugger, the one the chunker
 * uses, so every citation anchor in an answer lands on a heading that exists.
 */
export async function renderMarkdown(
  markdown: string,
): Promise<{ html: string; headings: Heading[] }> {
  const slugify = createSlugger();
  const headings: Heading[] = [];
  // Code is highlighted before rendering, since marked's renderer is synchronous.
  const highlighted = new Map<Tokens.Code, string>();
  let tabsCount = 0;
  // The nearest heading so far, and how many tables are under it: each table's name.
  let section = '';
  const tablesUnder = new Map<string, number>();
  const marked = new Marked({
    extensions: [containers],
    renderer: {
      code(token) {
        return highlighted.get(token) ?? '';
      },
      codespan({ text }) {
        return `<code${text.length > LONG_CODE ? ' class="code-long"' : ''}>${escapeHtml(text)}</code>`;
      },
      heading({ tokens, depth, text }) {
        const id = slugify(text);
        const inner = this.parser.parseInline(tokens);
        const label = decodeEntities(inner.replace(/<[^>]+>/g, ''));
        headings.push({ depth, text: label, id });
        section = label;
        return `<h${String(depth)} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${String(depth)}>\n`;
      },
      // GitHub's alerts, `> [!NOTE]`, are callouts; any other quote is a quote.
      blockquote({ tokens }) {
        const html = this.parser.parse(tokens);
        const alert = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(html);
        if (!alert) return `<blockquote>\n${html}</blockquote>\n`;
        const [marker, name = 'NOTE'] = alert;
        const callout = CALLOUTS[name.toLowerCase()] ?? NOTE;
        const rest = `<p>${html.slice(marker.length)}`.replace(/^<p><\/p>\s*/, '');
        return callout_(callout.kind, callout.title, rest);
      },
      // Every cell carries its column's name, so reference tables can stack into one block per
      // row on narrow screens. Tables of numbers (right-aligned columns) keep their grid. Each
      // table is named after the heading it is under; it becomes a named, focusable region only
      // when it scrolls (components/docs-enhancements.tsx).
      table({ header, rows, align }) {
        const attribute = (value: string | null) => (value ? ` align="${value}"` : '');
        const labels = header.map((cell) =>
          escapeHtml(decodeEntities(this.parser.parseInline(cell.tokens).replace(/<[^>]+>/g, ''))),
        );
        const head = header
          .map((cell) => `<th${attribute(cell.align)}>${this.parser.parseInline(cell.tokens)}</th>`)
          .join('');
        const body = rows
          .map(
            (row) =>
              `<tr>${row
                .map(
                  (cell, i) =>
                    `<td${attribute(cell.align)} data-label="${labels[i] ?? ''}">${this.parser.parseInline(cell.tokens)}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('\n');
        const numeric = align.includes('right');
        const count = (tablesUnder.get(section) ?? 0) + 1;
        tablesUnder.set(section, count);
        const name = section
          ? `${section}${count > 1 ? `, table ${String(count)}` : ''}`
          : labels.slice(0, 3).join(', ');
        return `<div class="table-scroll" data-name="${escapeHtml(`Table: ${decodeEntities(name)}`)}"><table${numeric ? '' : ' class="table-stack"'}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  const tokens = marked.lexer(markdown);
  const code: Tokens.Code[] = [];
  // The character before the next piece of prose, for curly quotes across bold, links and code.
  let prev = ' ';
  void marked.walkTokens(tokens, (token) => {
    switch (token.type) {
      case 'code':
        code.push(token as Tokens.Code);
        break;
      case 'container':
        if ((token as unknown as ContainerToken).kind === 'tabs') {
          (token as unknown as { tabsId: number }).tabsId = ++tabsCount;
        }
        prev = ' ';
        break;
      case 'codespan':
        prev = 'x';
        break;
      case 'text':
      case 'escape':
        if (!('tokens' in token && token.tokens)) {
          const leaf = token as Tokens.Text | Tokens.Escape;
          const text = leaf.text;
          leaf.text = keepUnits(smartQuotes(text, prev));
          prev = text.at(-1) ?? prev;
        }
        break;
      case 'br':
      case 'paragraph':
      case 'heading':
      case 'list_item':
      case 'blockquote':
      case 'table':
      case 'space':
        prev = ' ';
        break;
      default:
        break;
    }
  });
  await Promise.all(
    code.map(async (token) => {
      const { lang, title, code: text } = codeParts(token.text, token.lang ?? '');
      const variants = /^(?:sh|bash|shell)$/.test(lang) && !title ? packageManagers(text) : null;
      highlighted.set(
        token,
        variants
          ? await codeTabs(variants, lang, `pm-${String(++tabsCount)}`)
          : await codeBlock(text, lang, title),
      );
    }),
  );
  return { html: marked.parser(tokens), headings };
}
