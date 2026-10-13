import type { MouseEvent, ReactNode } from 'react';

import type { AskSource } from '../protocol';
import { fenceBody, splitFenced } from '../text/markdown';

export interface AskAnswerProps {
  /** The answer text, possibly still streaming. */
  text: string;
  sources: readonly AskSource[];
  /** Called when a citation is clicked; call `event.preventDefault()` to handle navigation. */
  onNavigate?: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  /**
   * Which Markdown links in the answer stay links. `"all"` (the default): any http(s), mailto or
   * relative URL. `"sources"`: only links to one of the pages in `sources` (at any anchor), so a
   * model steered by injected text cannot put another site's link in front of visitors; any
   * other link shows as its text. Citations (`[1]`) link to their source either way.
   */
  links?: AnswerLinks;
  /**
   * A citation's accessible name, with `{n}` its number and `{title}` its page. Default
   * `"Source {n}: {title}"`.
   */
  citationLabel?: string;
  /** Where the citations and the answer's links point, for an index from another site. */
  sourceUrls?: SourceUrls;
}

export type AnswerLinks = 'all' | 'sources';

/**
 * Where the answer's citations, sources and links point, for a dialog whose endpoint answers from
 * another site's index, such as a copy of that site's docs. A URL whose page is a key of `pages`
 * goes to its value, with its anchor kept: `{ '/docs/setup': '/setup' }` sends
 * `/docs/setup#install` to `/setup#install`. Any other relative URL is resolved against `base`,
 * the other site's address, so it opens there rather than at a page this site does not have.
 */
export interface SourceUrls {
  /** URLs of pages in the endpoint's index, without an anchor, and the URL of each page here. */
  pages?: Record<string, string>;
  /** The address other relative URLs resolve against, such as `https://docs.acme.dev`. */
  base?: string;
}

/**
 * `url` as `sourceUrls` maps it: to its page's URL here, with its anchor, else resolved against
 * `base` when it is relative. Absolute URLs that are not in `pages`, and anchors alone, stay as
 * they are.
 */
export function mapSourceUrl(url: string, sourceUrls: SourceUrls | undefined): string {
  // An anchor alone is a place on the page the visitor is on.
  if (!sourceUrls || url.startsWith('#')) return url;
  const hash = url.indexOf('#');
  const page = hash === -1 ? url : url.slice(0, hash);
  const anchor = hash === -1 ? '' : url.slice(hash);
  const { pages = {}, base } = sourceUrls;
  // A page matches with or without a trailing slash.
  const trimmed = page.replace(/(.)\/+$/, '$1');
  const key = [page, trimmed, `${trimmed}/`].find((candidate) => Object.hasOwn(pages, candidate));
  if (key !== undefined) return `${pages[key] ?? ''}${anchor}`;
  if (!base || /^[a-z][a-z\d+.-]*:/i.test(url)) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** `safeHref`, then `sourceUrls`: a link the model wrote must be safe before it is mapped. */
export function mappedHref(href: string, sourceUrls: SourceUrls | undefined): string | null {
  const safe = safeHref(href);
  return safe === null ? null : safeHref(mapSourceUrl(safe, sourceUrls));
}

/** A URL's page, as `origin + path` without a trailing slash, resolved against the current page. */
function pageOf(url: string): string | null {
  try {
    const base = typeof location === 'undefined' ? 'http://localhost/' : location.href;
    const { origin, pathname } = new URL(url, base);
    return `${origin}${pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Whether `href` opens one of the source pages, as `sourceUrls` maps them. */
function linksToSource(
  href: string,
  sources: Map<number, AskSource>,
  sourceUrls: SourceUrls | undefined,
): boolean {
  const page = pageOf(href);
  return (
    page !== null &&
    [...sources.values()].some((source) => pageOf(mapSourceUrl(source.url, sourceUrls)) === page)
  );
}

const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** The source numbers an answer cites, e.g. `[1]`, `[2][3]` or `[1, 4]`. */
export function citedSourceIds(text: string): Set<number> {
  const ids = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    for (const id of (match[1] ?? '').split(',')) ids.add(Number(id.trim()));
  }
  return ids;
}

/**
 * Allows http(s) and mailto URLs and every relative reference (`/docs`, `docs/a`, `../a`, `?q=1`,
 * `#top`); anything else (`javascript:`, `data:`) is dropped. Protocol-relative tricks are rejected
 * too: browsers read `//evil.com`, `/\\evil.com` and `/<tab>/evil.com` as another host, so a
 * leading `//`, backslashes and control characters never pass. A relative reference whose first
 * segment has a colon would read as a scheme to some parsers, so it is dropped as well.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  // eslint-disable-next-line no-control-regex
  if (!trimmed || /[\\\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    const firstSegment = /^[^/?#]*/.exec(trimmed)?.[0] ?? '';
    return trimmed.startsWith('//') || firstSegment.includes(':') ? null : trimmed;
  }
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Renders a model answer: paragraphs, bullet and numbered lists, fenced and inline code, bold,
 * links, and `[n]` citations as links to their sources.
 *
 * Model output is untrusted, so this never produces HTML from it: everything is a React text node
 * or element, link targets are allow-listed, and a citation only renders as a link if its number
 * matches a source the server sent.
 */
export function AskAnswer({
  text,
  sources,
  onNavigate,
  className,
  links = 'all',
  citationLabel = 'Source {n}: {title}',
  sourceUrls,
}: AskAnswerProps): ReactNode {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const blocks: ReactNode[] = [];
  let key = 0;
  for (const segment of splitFenced(text)) {
    if (segment.code) {
      // Streaming: an unclosed fence is still a code block, so code renders as it arrives. A long
      // line scrolls sideways, so the block takes focus: keyboard users can scroll it too.
      blocks.push(
        <pre key={`b${String(key++)}`} className="ask-pre" tabIndex={0}>
          <code>{fenceBody(segment.text)}</code>
        </pre>,
      );
    } else {
      blocks.push(
        ...prose(segment.text, byId, onNavigate, links, citationLabel, sourceUrls, () => key++),
      );
    }
  }
  return <div className={className ?? 'ask-markdown'}>{blocks}</div>;
}

const BULLET = /^[-*+]\s+/;
const NUMBERED = /^\d+[.)]\s+/;
type LineKind = 'ul' | 'ol' | 'p';
const kindOf = (line: string): LineKind =>
  BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : 'p';

/**
 * Paragraphs and lists. Within a paragraph block, consecutive lines of one kind are grouped, so
 * "To install:" directly followed by "1. …" lines renders as a paragraph and then a list.
 */
function prose(
  text: string,
  sources: Map<number, AskSource>,
  onNavigate: AskAnswerProps['onNavigate'],
  links: AnswerLinks,
  citationLabel: string,
  sourceUrls: SourceUrls | undefined,
  nextKey: () => number,
): ReactNode[] {
  const inline = (line: string): ReactNode[] =>
    renderInline(line, sources, onNavigate, links, citationLabel, sourceUrls);
  const out: ReactNode[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const runs: { kind: LineKind; lines: string[] }[] = [];
    for (const line of block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      const kind = kindOf(line);
      const run = runs.at(-1);
      if (run?.kind === kind) run.lines.push(line);
      else runs.push({ kind, lines: [line] });
    }
    for (const run of runs) {
      const key = `b${String(nextKey())}`;
      if (run.kind === 'p') {
        out.push(<p key={key}>{inline(run.lines.join(' '))}</p>);
        continue;
      }
      const marker = run.kind === 'ul' ? BULLET : NUMBERED;
      const items = run.lines.map((line, i) => <li key={i}>{inline(line.replace(marker, ''))}</li>);
      out.push(run.kind === 'ul' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
    }
  }
  return out;
}

function renderInline(
  text: string,
  sources: Map<number, AskSource>,
  onNavigate: AskAnswerProps['onNavigate'],
  links: AnswerLinks,
  citationLabel: string,
  sourceUrls: SourceUrls | undefined,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [raw, code, bold, label, href, citations] = match;
    if (code !== undefined) {
      out.push(<code key={key++}>{code}</code>);
    } else if (bold !== undefined) {
      out.push(<strong key={key++}>{bold}</strong>);
    } else if (label !== undefined && href !== undefined) {
      const safe = mappedHref(href, sourceUrls);
      const target =
        safe && (links === 'all' || linksToSource(safe, sources, sourceUrls)) ? safe : null;
      out.push(
        target ? (
          <a
            key={key++}
            href={target}
            onClick={(event) => onNavigate?.(target, event)}
            {...(/^https?:/.test(target) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (citations !== undefined) {
      const ids = citations.split(',').map((id) => Number(id.trim()));
      if (ids.every((id) => sources.has(id))) {
        for (const id of ids) {
          const source = sources.get(id);
          const href = source ? mappedHref(source.url, sourceUrls) : null;
          if (!source || !href) {
            out.push(`[${String(id)}]`);
            continue;
          }
          out.push(
            <a
              key={key++}
              className="ask-citation"
              href={href}
              title={source.heading ? `${source.title} › ${source.heading}` : source.title}
              aria-label={citationLabel
                .replace(/\{n\}/g, String(id))
                .replace(/\{title\}/g, () => source.title)}
              onClick={(event) => onNavigate?.(href, event)}
            >
              {id}
            </a>,
          );
        }
      } else {
        out.push(raw);
      }
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
