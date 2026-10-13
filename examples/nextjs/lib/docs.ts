import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';

import { createSlugger, decodeEntities, parseFrontmatter } from 'ondocs';
import { Marked, type Tokens } from 'marked';

import { codeBlock } from './highlight';

const DOCS_DIR = path.join(process.cwd(), 'content/docs');

/** Sidebar sections, in order. A page names its own in `section` frontmatter. */
export const SECTIONS = ['Get started', 'Integrations', 'Guides', 'Reference'] as const;

/** The section the header's Integrations link opens, on the docs home, and is current in. */
export const INTEGRATIONS_SECTION = 'Integrations';

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  section: string;
  order: number;
}

export interface DocSection {
  title: string;
  docs: DocMeta[];
}

export interface Doc extends DocMeta {
  html: string;
  headings: { depth: number; text: string; id: string }[];
  /** The pages before and after it in sidebar order. */
  previous: DocMeta | null;
  next: DocMeta | null;
}

async function readDoc(slug: string): Promise<{ meta: DocMeta; body: string } | null> {
  let source: string;
  try {
    source = await readFile(path.join(DOCS_DIR, `${slug}.md`), 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(source);
  return {
    meta: {
      slug,
      title: typeof data.title === 'string' ? data.title : slug,
      description: typeof data.description === 'string' ? data.description : '',
      section: typeof data.section === 'string' ? data.section : 'Reference',
      order: typeof data.order === 'number' ? data.order : 99,
    },
    body,
  };
}

/** A page's Markdown, without its frontmatter. */
export const getDocSource = cache(
  async (slug: string): Promise<string | null> => (await readDoc(slug))?.body ?? null,
);

export const getDocs = cache(async (): Promise<DocMeta[]> => {
  const files = (await readdir(DOCS_DIR)).filter((file) => file.endsWith('.md'));
  const docs = await Promise.all(files.map((file) => readDoc(file.replace(/\.md$/, ''))));
  return docs
    .flatMap((doc) => (doc ? [doc.meta] : []))
    .sort(
      (a, b) =>
        sectionRank(a.section) - sectionRank(b.section) ||
        a.order - b.order ||
        a.title.localeCompare(b.title),
    );
});

function sectionRank(section: string): number {
  const rank = (SECTIONS as readonly string[]).indexOf(section);
  return rank === -1 ? SECTIONS.length : rank;
}

/** The pages grouped by section, in sidebar order. */
export const getSections = cache(async (): Promise<DocSection[]> => {
  const sections: DocSection[] = [];
  for (const doc of await getDocs()) {
    const last = sections.at(-1);
    if (last?.title === doc.section) last.docs.push(doc);
    else sections.push({ title: doc.section, docs: [doc] });
  }
  return sections;
});

/**
 * Renders a page with heading ids from ondocs's own slugger, the one the chunker uses, so
 * every citation anchor in an answer lands on a heading that exists.
 */
export const getDoc = cache(async (slug: string): Promise<Doc | null> => {
  const doc = await readDoc(slug);
  if (!doc) return null;
  const slugify = createSlugger();
  const headings: Doc['headings'] = [];
  // Code is highlighted before rendering, since marked's renderer is synchronous.
  const highlighted = new Map<Tokens.Code, string>();
  const marked = new Marked({
    renderer: {
      code(token) {
        return highlighted.get(token) ?? '';
      },
      heading({ tokens, depth, text }) {
        const id = slugify(text);
        const label = decodeEntities(this.parser.parseInline(tokens).replace(/<[^>]+>/g, ''));
        headings.push({ depth, text: label, id });
        return `<h${String(depth)} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${this.parser.parseInline(tokens)}</h${String(depth)}>\n`;
      },
      // Every cell carries its column's name, so reference tables can stack into one block per
      // row on narrow screens. Tables of numbers (right-aligned columns) keep their grid.
      table({ header, rows, align }) {
        const attribute = (value: string | null) => (value ? ` align="${value}"` : '');
        const labels = header.map((cell) =>
          decodeEntities(this.parser.parseInline(cell.tokens).replace(/<[^>]+>/g, '')).replace(
            /"/g,
            '&quot;',
          ),
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
        const name = labels.slice(0, 3).join(', ');
        return `<div class="table-scroll" tabindex="0" role="region" aria-label="Table: ${name}"><table${numeric ? '' : ' class="table-stack"'}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  const tokens = marked.lexer(doc.body);
  const code: Tokens.Code[] = [];
  void marked.walkTokens(tokens, (token) => {
    if (token.type === 'code') code.push(token as Tokens.Code);
  });
  await Promise.all(
    code.map(async (token) => {
      highlighted.set(token, await codeBlock(token.text, token.lang ?? ''));
    }),
  );
  const html = marked.parser(tokens);
  const docs = await getDocs();
  const index = docs.findIndex((other) => other.slug === slug);
  return {
    ...doc.meta,
    html,
    headings,
    previous: docs[index - 1] ?? null,
    next: docs[index + 1] ?? null,
  };
});
