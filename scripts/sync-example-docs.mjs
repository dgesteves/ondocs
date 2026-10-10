// Generates the Docusaurus, Starlight and VitePress examples' docs from the website's, so the four
// sites share one set of pages: examples/nextjs/content/docs is the source, and the other three
// are written from it.
//
//   pnpm build && node scripts/sync-example-docs.mjs           # write them
//   pnpm build && node scripts/sync-example-docs.mjs --check   # exit 1 if they are out of date
//
// Each page keeps its text. What changes per site is the frontmatter, where a page lives (and so
// its URL), and the links between pages, which point at that site's URLs. Every link is checked:
// its page must exist and its anchor must be a heading on it, slugged as ondocs and the
// frameworks slug headings (the VitePress example slugs them with ondocs's own `slugify`). Needs the built package (dist) for ondocs's own slugger.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { createSlugger, parseFrontmatter } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(root, 'examples/nextjs/content/docs');
const DOCUSAURUS = join(root, 'examples/docusaurus');
const STARLIGHT = join(root, 'examples/starlight/src/content/docs');
const VITEPRESS = join(root, 'examples/vitepress');
/** Starlight pages written by hand, which the sync leaves alone. */
const STARLIGHT_OWN = new Set(['changelog.md']);

/** The website's sidebar sections, in order, and the folder each is in on Starlight. */
const SECTIONS = [
  ['Get started', 'get-started'],
  ['Integrations', 'integrations'],
  ['Guides', 'guides'],
  ['Reference', 'reference'],
];

const check = process.argv.includes('--check');

// The source pages, in sidebar order.
const pages = readdirSync(SOURCE)
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const slug = file.replace(/\.md$/, '');
    const { data, body } = parseFrontmatter(readFileSync(join(SOURCE, file), 'utf8'));
    const section = SECTIONS.findIndex(([name]) => name === data.section);
    if (section === -1) throw new Error(`${file}: unknown section ${JSON.stringify(data.section)}`);
    return {
      slug,
      title: String(data.title),
      description: String(data.description ?? ''),
      section,
      order: Number(data.order ?? 99),
      body: body.replace(/^\n+/, ''),
    };
  })
  .sort((a, b) => a.section - b.section || a.order - b.order);
const bySlug = new Map(pages.map((page) => [page.slug, page]));

/** Each page's heading anchors, as the frameworks generate them. */
const anchors = new Map(
  pages.map((page) => {
    const slugify = createSlugger();
    const ids = new Set();
    for (const segment of outsideCode(page.body)) {
      for (const match of segment.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm))
        ids.add(slugify(match[1]));
    }
    return [page.slug, ids];
  }),
);

/** The page's text outside fenced code blocks, which links are never rewritten in. */
function outsideCode(text) {
  return text.split(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})\s*$/m);
}

/** Rewrites `](/docs/slug#anchor)` links with `to(page, anchor)`, checking each one. */
function rewriteLinks(page, to) {
  const problems = [];
  const parts = page.body.split(/(^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})\s*$)/m);
  const body = parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\]\(\/docs\/([\w-]+)(#[\w-]+)?\)/g, (_, slug, anchor = '') => {
            const target = bySlug.get(slug);
            if (!target) problems.push(`links to /docs/${slug}, which is not a page`);
            else if (anchor && !anchors.get(slug)?.has(anchor.slice(1))) {
              problems.push(`links to /docs/${slug}${anchor}, which is not a heading there`);
            }
            return `](${to(target ?? { slug }, anchor)})`;
          }),
    )
    .join('');
  if (/\]\(\/docs(?:[/#)])/.test(outsideCode(body).join(''))) {
    problems.push('has a /docs link the sync cannot map');
  }
  for (const problem of problems) failures.push(`${page.slug}.md ${problem}`);
  return body;
}

const failures = [];
const prettierConfig = (await resolveConfig(join(root, 'package.json'))) ?? {};
const header = (page) =>
  `# Generated from examples/nextjs/content/docs/${page.slug}.md by scripts/sync-example-docs.mjs. Edit that file instead.`;
const yaml = (value) => JSON.stringify(value);

/** Every file the sync owns, by absolute path, with its contents. */
const files = new Map();

// Docusaurus: flat pages under docs/ (served at /<slug>, the introduction at /), and a sidebar
// with the website's sections.
for (const page of pages) {
  const frontmatter = [
    '---',
    header(page),
    `title: ${yaml(page.title)}`,
    `description: ${yaml(page.description)}`,
    ...(page.slug === 'introduction' ? ['slug: /'] : []),
    '---',
  ];
  const body = rewriteLinks(page, (target, anchor) => `./${target.slug}.md${anchor}`);
  files.set(join(DOCUSAURUS, 'docs', `${page.slug}.md`), `${frontmatter.join('\n')}\n\n${body}`);
}
const sidebar = SECTIONS.map(([label], index) => ({
  type: 'category',
  label,
  collapsible: false,
  items: pages.filter((page) => page.section === index).map((page) => page.slug),
}));
files.set(
  join(DOCUSAURUS, 'sidebars.ts'),
  [
    '// Generated by scripts/sync-example-docs.mjs from the sections of examples/nextjs/content/docs.',
    "import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';",
    '',
    `const sidebars: SidebarsConfig = { docs: ${JSON.stringify(sidebar)} };`,
    '',
    'export default sidebars;',
    '',
  ].join('\n'),
);

// Starlight: the introduction is the home page; every other page is in its section's folder,
// served at /<section>/<slug>/, ordered in the sidebar by `sidebar.order`.
const starlightUrl = (page) =>
  page.slug === 'introduction' ? '/' : `/${SECTIONS[page.section][1]}/${page.slug}/`;
for (const page of pages) {
  const frontmatter = [
    '---',
    header(page),
    `title: ${yaml(page.title)}`,
    `description: ${yaml(page.description)}`,
    ...(page.slug === 'introduction' ? [] : ['sidebar:', `  order: ${String(page.order)}`]),
    '---',
  ];
  const body = rewriteLinks(page, (target, anchor) =>
    bySlug.has(target.slug) ? `${starlightUrl(target)}${anchor}` : `/${target.slug}/${anchor}`,
  );
  const file =
    page.slug === 'introduction'
      ? join(STARLIGHT, 'index.md')
      : join(STARLIGHT, SECTIONS[page.section][1], `${page.slug}.md`);
  files.set(file, `${frontmatter.join('\n')}\n\n${body}`);
}

// VitePress: flat pages under docs/ (served at /<slug>, with cleanUrls, the introduction at /), each
// with the title as its H1, which VitePress does not add, and a sidebar with the website's sections.
const vitepressUrl = (page) => (page.slug === 'introduction' ? '/' : `/${page.slug}`);
for (const page of pages) {
  const frontmatter = [
    '---',
    header(page),
    `title: ${yaml(page.title)}`,
    `description: ${yaml(page.description)}`,
    '---',
  ];
  const body = rewriteLinks(page, (target, anchor) => `${vitepressUrl(target)}${anchor}`);
  const file = join(
    VITEPRESS,
    'docs',
    page.slug === 'introduction' ? 'index.md' : `${page.slug}.md`,
  );
  files.set(file, `${frontmatter.join('\n')}\n\n# ${page.title}\n\n${body}`);
}
const vitepressSidebar = SECTIONS.map(([text], index) => ({
  text,
  items: pages
    .filter((page) => page.section === index)
    .map((page) => ({ text: page.title, link: vitepressUrl(page) })),
}));
files.set(
  join(VITEPRESS, '.vitepress', 'sidebar.ts'),
  [
    '// Generated by scripts/sync-example-docs.mjs from the sections of examples/nextjs/content/docs.',
    "import type { DefaultTheme } from 'vitepress';",
    '',
    `export const sidebar: DefaultTheme.Sidebar = ${JSON.stringify(vitepressSidebar)};`,
    '',
  ].join('\n'),
);

// Formatted as the repository formats them, so `prettier --check` agrees with `--check` here.
for (const [file, text] of files) {
  files.set(file, await format(text, { ...prettierConfig, filepath: file }));
}

if (failures.length > 0) {
  console.error(`✗ Broken links in examples/nextjs/content/docs:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

/** Files under `dir` that the sync owns: every .md, except Starlight's own pages. */
function owned(dir, keep = new Set()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !keep.has(relative(dir, file)));
}
const existing = [
  ...owned(join(DOCUSAURUS, 'docs')),
  ...owned(STARLIGHT, STARLIGHT_OWN),
  ...owned(join(VITEPRESS, 'docs')),
];
const stale = existing.filter((file) => !files.has(file));
const changed = [...files].filter(([file, text]) => {
  try {
    return readFileSync(file, 'utf8') !== text;
  } catch {
    return true;
  }
});

const show = (file) => relative(root, file);
if (check) {
  if (changed.length === 0 && stale.length === 0) {
    console.log(
      `✓ The Docusaurus, Starlight and VitePress docs match examples/nextjs (${String(pages.length)} pages).`,
    );
    process.exit(0);
  }
  console.error(
    [
      '✗ The Docusaurus, Starlight and VitePress docs are out of date with examples/nextjs/content/docs.',
      ...changed.map(([file]) => `  changed: ${show(file)}`),
      ...stale.map((file) => `  not generated: ${show(file)}`),
      'Run `pnpm build && pnpm examples:sync` and commit the result.',
    ].join('\n'),
  );
  process.exit(1);
}

for (const file of stale) rmSync(file);
for (const [file, text] of changed) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
console.log(
  `✓ Wrote ${String(changed.length)} and removed ${String(stale.length)} files (${String(pages.length)} pages).`,
);
