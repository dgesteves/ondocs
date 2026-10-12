/**
 * The destinations of a Markdown document's links and images, to rewrite them. Linear time, like
 * the rest of `text/`: it reads arbitrary files at build time.
 */
import { mapOutsideCodeSpans, splitFenced } from './markdown';

/** A link reference definition, `[label]: destination`, and where its destination starts. */
const DEFINITION = /^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;

/**
 * `markdown` with the destination of each link and image outside code replaced by what `map`
 * returns for it, or left as it is when `map` returns `null`: inline ones, as in `[text](dest)`,
 * `![alt](<dest> "title")`, and link reference definitions, `[label]: dest`.
 */
export function mapLinkDestinations(
  markdown: string,
  map: (destination: string) => string | null,
): string {
  const replace = (destination: string, angled: boolean): string => {
    const mapped = map(destination);
    if (mapped === null) return angled ? `<${destination}>` : destination;
    return angled ? `<${mapped}>` : mapped;
  };
  return splitFenced(markdown)
    .map((segment) => {
      if (segment.code) return segment.text;
      const defined = segment.text.replace(
        DEFINITION,
        (_match, start: string, destination: string) =>
          start +
          (destination.startsWith('<')
            ? replace(destination.slice(1, -1), true)
            : replace(destination, false)),
      );
      return mapOutsideCodeSpans(defined, (prose) => inlineDestinations(prose, replace));
    })
    .join('\n');
}

/**
 * The destinations of inline links and images, `](dest …)`, each replaced by `replace`. A plain
 * destination runs to the first space or the `)` that closes it, with balanced parentheses
 * inside; `<…>` holds one with spaces, on one line. The scan never reads a character twice: it
 * resumes after each destination it reads, and remembers where the next `>` and line break are.
 */
function inlineDestinations(
  text: string,
  replace: (destination: string, angled: boolean) => string,
): string {
  let out = '';
  let last = 0;
  let from = 0;
  // The next `>` and line break at or after the last place they were looked for from.
  let close = -2;
  let newline = -2;
  const nextOf = (char: string, at: number, cached: number): number => {
    if (cached === -1 || cached >= at) return cached;
    return text.indexOf(char, at);
  };
  for (let at = text.indexOf('](', from); at !== -1; at = text.indexOf('](', from)) {
    let start = at + 2;
    while (text[start] === ' ' || text[start] === '\t') start += 1;
    from = start;
    if (text[start] === '<') {
      close = nextOf('>', start + 1, close);
      newline = nextOf('\n', start + 1, newline);
      if (close === -1 || (newline !== -1 && newline < close)) continue;
      out += text.slice(last, start) + replace(text.slice(start + 1, close), true);
      last = from = close + 1;
      continue;
    }
    let end = start;
    let depth = 0;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === ' ' || char === '\t' || char === '\n') break;
    }
    from = Math.max(end, start);
    // Unbalanced parentheses, or text that ends inside it: not a link.
    if (end === start || end === text.length || depth > 0) continue;
    out += text.slice(last, start) + replace(text.slice(start, end), false);
    last = end;
  }
  return out + text.slice(last);
}
