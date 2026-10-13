import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';

import { parseFrontmatter } from 'ondocs';

import { lastModified } from './git';
import { renderMarkdown, type Heading } from './markdown';

const DOCS_DIR = path.join(process.cwd(), 'content/docs');

/**
 * Sidebar groups, in order. A page is in its `group` frontmatter, else its `section`, the one
 * the other examples' sidebars share (scripts/sync-example-docs.mjs), under this site's name
 * for it.
 */
export const SECTIONS = [
  'Get started',
  'Frameworks',
  'For agents',
  'Deploy & operate',
  'Guides',
  'Reference',
] as const;

const SECTION_GROUPS: Partial<Record<string, string>> = { Integrations: 'Frameworks' };

/** The group the header's Integrations link opens, on the docs home, and is current in. */
export const INTEGRATIONS_SECTION = 'Frameworks';

/**
 * How many cards a row a section of the docs home has: three when its count divides by three,
 * else two, so no row is left with one card alone.
 */
export const cardColumns = (count: number): 2 | 3 => (count % 3 === 0 ? 3 : 2);

export interface DocMeta {
  slug: string;
  title: string;
  /** The sidebar's shorter name for it: `label` frontmatter, else the title. */
  label: string;
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
  headings: Heading[];
  /** When the page's file last changed in git, when the build has that history. */
  updated: Date | undefined;
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
  const title = typeof data.title === 'string' ? data.title : slug;
  const section = typeof data.section === 'string' ? data.section : 'Reference';
  return {
    meta: {
      slug,
      title,
      label: typeof data.label === 'string' ? data.label : title,
      description: typeof data.description === 'string' ? data.description : '',
      section: typeof data.group === 'string' ? data.group : (SECTION_GROUPS[section] ?? section),
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

/** What the sidebar and the docs bar need of each page: they are sent to the browser as props. */
export interface NavSection {
  title: string;
  docs: { slug: string; label: string }[];
}

export const getNavSections = cache(async (): Promise<NavSection[]> =>
  (await getSections()).map((section) => ({
    title: section.title,
    docs: section.docs.map(({ slug, label }) => ({ slug, label })),
  })),
);

/** The id of a group on the docs home, which the header's Integrations link goes to. */
export const sectionId = (title: string): string =>
  title === INTEGRATIONS_SECTION
    ? 'integrations'
    : title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

export const getDoc = cache(async (slug: string): Promise<Doc | null> => {
  const doc = await readDoc(slug);
  if (!doc) return null;
  const { html, headings } = await renderMarkdown(doc.body);
  const docs = await getDocs();
  const index = docs.findIndex((other) => other.slug === slug);
  return {
    ...doc.meta,
    html,
    headings,
    updated: lastModified(path.join(DOCS_DIR, `${slug}.md`)),
    previous: docs[index - 1] ?? null,
    next: docs[index + 1] ?? null,
  };
});
