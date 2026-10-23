// The framework guides and the examples, as someone new to ondocs reads them. Each plugin's guide
// shows the dialog answering on their machine, with no key, right after adding the plugin and
// before deploying; the pages that list the plugins list VitePress, and `ondocs dev` names it
// too; the Fumadocs and Nextra guides open with why to add ondocs there, and the Astro guide says
// what it adds to starlight-llms-txt; and the example READMEs say they are demos and send people
// to the guide, which links each demo's source.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex, createSlugger, parseFrontmatter } from '../src';
import { DEV_USAGE, INDEX_FILES, findIndexFile } from '../src/cli/dev';
import { main } from '../src/cli/main';
import { mockEmbeddingModel } from '../src/mock';
import { writeIndexFile } from '../src/node';
import { corpus } from './helpers';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const DOCS = 'examples/nextjs/content/docs';
const REPO = 'https://github.com/dgesteves/ondocs';

/** A docs page's body, without its frontmatter. */
const page = (slug: string) => parseFrontmatter(read(`${DOCS}/${slug}.md`)).body;

/** Text outside fenced code blocks. */
const prose = (body: string) => body.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '');

/** A page's `## ` headings, in order. */
const headings = (body: string) =>
  [...prose(body).matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? '');

/** The text under a `## ` heading, up to the next one. */
const section = (body: string, heading: string) => {
  const lines = body.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`no "## ${heading}" section`);
  const rest = lines.slice(start + 1).join('\n');
  const end = rest.search(/^## /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
};

/** What a page says before its first `## ` heading. */
const intro = (body: string) => body.slice(0, body.search(/^## /m)).trim();

/** The plugin guides, with the scripts each framework's own starter has. */
const GUIDES = [
  {
    slug: 'docusaurus',
    example: 'docusaurus',
    build: 'npm run build',
    start: 'npm start',
    index: 'build/ask-index.json',
  },
  {
    slug: 'astro',
    example: 'starlight',
    build: 'npm run build',
    start: 'npm run dev',
    index: 'dist/ask-index.json',
  },
  {
    slug: 'vitepress',
    example: 'vitepress',
    build: 'npm run docs:build',
    start: 'npm run docs:dev',
    index: '.vitepress/dist/ask-index.json',
  },
];

describe('each plugin guide', () => {
  it.each(GUIDES)(
    'the $slug guide shows the dialog answering with no key right after adding the plugin, before deploying',
    ({ slug, build, start, index }) => {
      const body = page(slug);
      const all = headings(body);
      const local = all.findIndex((heading) => /^See it working\b.*, with no key$/.test(heading));
      const deploy = all.findIndex((heading) => heading.startsWith('Deploy the endpoint'));
      expect(local, `${slug}.md has no "See it working …, with no key" section`).toBeGreaterThan(
        -1,
      );
      // Only installing and adding the plugin come first, and deploying comes after.
      expect(
        all.slice(0, local).filter((heading) => !/^(Install|Add it to)\b/.test(heading)),
      ).toEqual([]);
      expect(local).toBeLessThan(deploy);

      // Three commands: build, `ondocs dev`, and the site's dev server pointed at it.
      const text = section(body, all[local] ?? '');
      const block = /```sh\n([\s\S]*?)```/.exec(text)?.[1] ?? '';
      const commands = block
        .trim()
        .split('\n')
        .map((line) => line.replace(/\s+#.*$/, ''));
      const endpoint = 'http://localhost:8787/api/ask';
      expect(commands).toEqual([build, 'npx ondocs dev', `ASK_ENDPOINT=${endpoint} ${start}`]);
      expect(DEV_USAGE).toContain('(default: 8787)');
      // It names the file the build writes, which is one `ondocs dev` looks for.
      expect(block).toContain(`writes ${index}`);
      expect(INDEX_FILES).toContain(index);
      // And it links the deploy steps, which come next.
      expect(text).toContain(`](/docs/${slug}#${createSlugger()(all[deploy] ?? '')})`);
    },
  );

  it.each(GUIDES)('the $slug guide links its live demo’s source', ({ slug, example }) => {
    const demo = page(slug)
      .split('\n')
      .find((line) => line.startsWith('Live demo:'));
    expect(demo).toContain(`(${REPO}/tree/main/examples/${example})`);
    expect(existsSync(join(root, 'examples', example, 'README.md'))).toBe(true);
  });
});

describe('getting started', () => {
  it('sends plugin users to their guide, past the CLI, endpoint and dialog steps', () => {
    const text = section(page('getting-started'), 'Pick your setup');
    const note = text
      .split(/\n\s*\n/)
      .find((paragraph) => paragraph.includes('skip the steps below'));
    expect(note).toBeDefined();
    for (const plugin of ['Starlight', 'Astro', 'Docusaurus', 'VitePress']) {
      expect(note).toContain(plugin);
    }
    expect(note).toMatch(/with no key/);
    expect(note).toContain('npx ondocs init');
  });
});

describe('VitePress, wherever the docs list the plugins', () => {
  it('is named in each sentence that names Docusaurus and Starlight', () => {
    const pages = [
      'ask-dialog',
      'indexing',
      'workers-ai',
      'getting-started',
      ...GUIDES.map((guide) => guide.slug),
    ];
    const missing = pages.flatMap((slug) =>
      prose(page(slug))
        .split(/(?<=[.;:])\s+|\n+/)
        .filter((sentence) => sentence.includes('Docusaurus') && sentence.includes('Starlight'))
        .filter((sentence) => !sentence.includes('VitePress'))
        // Sizes come from the benchmarks page's table, which measures Docusaurus and Starlight.
        .filter((sentence) => !sentence.includes('KB'))
        .map((sentence) => `${slug}.md: ${sentence}`),
    );
    expect(missing).toEqual([]);
  });

  it('gets the Workers AI options in each plugin’s own config', () => {
    const text = section(page('workers-ai'), 'Keywords, or meaning too');
    const blocks = [...text.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((match) => match[2] ?? '');
    const forms = {
      'Starlight or Astro': /^ondocs\(\{$/m,
      Docusaurus: /^ {4}'ondocs\/docusaurus',$/m,
      VitePress: /^export default withOndocs\(defineConfig\(/m,
    };
    for (const [label, form] of Object.entries(forms)) {
      const block = blocks.find((code) => code.startsWith(`// ${label},`));
      expect(block, `no block for ${label}`).toBeDefined();
      expect(block).toMatch(form);
      expect(block).toContain("embedding: 'workers-ai:@cf/baai/bge-small-en-v1.5'");
    }
    // `ondocs({ … })` is the Astro form, never Docusaurus's.
    for (const code of blocks.filter((code) =>
      (code.split('\n')[0] ?? '').includes('Docusaurus'),
    )) {
      expect(code).not.toMatch(/^ondocs\(/m);
    }
  });
});

describe('ondocs dev', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ondocs-guides-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('names the VitePress plugin when there is no index', () => {
    expect(() => findIndexFile(dir)).toThrow(
      /your site’s build, with the Docusaurus, Astro, Starlight or VitePress plugin/,
    );
  });

  it('tells a VitePress site to start with ASK_ENDPOINT', async () => {
    const file = join(dir, '.vitepress/dist/ask-index.json');
    const { index } = await buildIndex({ documents: corpus, embeddingModel: mockEmbeddingModel() });
    await mkdir(dirname(file), { recursive: true });
    await writeIndexFile(file, index);
    const out: string[] = [];
    const err: string[] = [];
    const controller = new AbortController();
    const code = await main(['dev', '--port', '0'], {
      cwd: dir,
      env: {},
      signal: controller.signal,
      // It has said where it listens: stop it.
      stdout: (line) => {
        out.push(line);
        if (/Endpoint {2}\S+/.test(line)) controller.abort();
      },
      stderr: (line) => err.push(line),
    });
    expect([code, err]).toEqual([0, []]);
    const printed = out.join('\n');
    expect(printed).toContain('.vitepress/dist/ask-index.json');
    const endpoint = /Endpoint {2}(\S+)/.exec(printed)?.[1] ?? '';
    const line = printed.split('\n').find((text) => text.includes(`ASK_ENDPOINT=${endpoint}`));
    expect(line).toMatch(/^ {2}Docusaurus, Astro, Starlight, VitePress {2}start the site with/);
  });
});

describe('the Fumadocs and Nextra guides', () => {
  it('open with when to use ondocs on Fumadocs, and when its own AI chat is enough', () => {
    const text = intro(page('fumadocs'));
    const why = text.split(/\n\s*\n/)[0] ?? '';
    expect(why).toContain('`create-fumadocs-app --ai-chat`');
    expect(why).toContain('`fumadocs-core/mcp`');
    expect(why).toMatch(/keep them/);
    expect(why).toMatch(/one model call/);
    expect(why).toMatch(/rate-limited by default/);
    expect(why).toContain('`ondocs eval`');
    expect(why).toContain('](/docs/mcp)');
  });

  it('open with what Nextra lacks: llms.txt, MCP and a self-hosted Ask AI', () => {
    const why = intro(page('nextra')).split(/\n\s*\n/)[0] ?? '';
    expect(why).toMatch(/^Nextra has no `llms\.txt` or MCP server of its own/);
    expect(why).toContain('Inkeep');
    expect(why).toMatch(/self-hosted/);
  });
});

describe('the Astro guide', () => {
  it('says what ondocs adds next to starlight-llms-txt', () => {
    const text = section(page('astro'), 'Already using starlight-llms-txt?');
    expect(text).toMatch(/^Keep it\./);
    expect(text).toContain('.md');
    expect(text).toContain('](/docs/mcp');
    expect(text).toContain('](/docs/llms-txt#alongside-other-llms-plugins)');
  });
});

describe('the example READMEs', () => {
  const EXAMPLES = [
    { example: 'docusaurus', guide: 'docusaurus' },
    { example: 'starlight', guide: 'astro' },
    { example: 'vitepress', guide: 'vitepress' },
    { example: 'nextjs', guide: 'nextjs' },
  ];

  it.each(EXAMPLES)(
    'examples/$example says it is a demo and sends people to the guide',
    ({ example, guide }) => {
      const readme = read(`examples/${example}/README.md`);
      const lead = readme
        .split(/\n\s*\n/)
        .slice(0, 3)
        .join('\n\n');
      expect(lead).toMatch(/not a starter/);
      expect(lead).toContain(`(https://ondocs.vercel.app/docs/${guide})`);
      expect(existsSync(join(root, DOCS, `${guide}.md`))).toBe(true);
      // While it depends on the package in this repository, it says it installs only here.
      const pkg = JSON.parse(read(`examples/${example}/package.json`)) as {
        dependencies: Record<string, string>;
      };
      const workspace = pkg.dependencies.ondocs?.startsWith('workspace:') ?? false;
      expect(lead.includes('`workspace:*`')).toBe(workspace);
    },
  );
});
