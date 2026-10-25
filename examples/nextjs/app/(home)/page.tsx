import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';

import { AskButton } from '../../components/ask';
import { ArrowRight, GitHubIcon } from '../../components/icons';
import { AgentStrip } from '../../components/landing/agent-strip';
import { Flow } from '../../components/landing/flow';
import { FrameworkPicker, type Framework } from '../../components/landing/framework-picker';
import { HeroDemo } from '../../components/landing/hero-demo';
import { SetupTabs, type SetupTab } from '../../components/landing/setup-tabs';
import { McpInstall } from '../../components/mcp-install';
import { mode } from '../../lib/ai';
import { codeBlock } from '../../lib/highlight';
import { jsonLd, softwareSourceCode } from '../../lib/json-ld';
import { mcpSample } from '../../lib/mcp-sample';
import { sampleAnswer } from '../../lib/sample-answer';
import {
  DEMOS,
  demoUrl,
  GITHUB_URL,
  HOME_DESCRIPTION as description,
  HOME_TITLE as title,
  INSTALL,
  MCP_URL,
  SUGGESTIONS,
} from '../../lib/site';
import { gzippedSize, largestPageAddition } from '../../lib/sizes';

import './landing.css';

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: '/', types: { 'text/plain': '/llms.txt' } },
  openGraph: { type: 'website', siteName: 'ondocs', title, description, url: '/' },
  twitter: { card: 'summary_large_image', title, description },
};

/** The script tag's file on jsDelivr, at the current minor: scripts/sync-cdn-range.mjs moves it. */
const EMBED_SRC = 'https://cdn.jsdelivr.net/npm/ondocs@0.15/dist/embed.global.js';

/** The first screen's framework picker: the line that adds ondocs to each, Starlight first. */
async function frameworks(): Promise<Framework[]> {
  return [
    {
      id: 'starlight',
      label: 'Starlight',
      code: await codeBlock(
        "import ondocs from 'ondocs/starlight';\nstarlight({ title: 'Acme Docs', plugins: [ondocs()] });",
        'js',
        'astro.config.mjs',
      ),
      demo: { href: demoUrl('Starlight'), label: 'See it live on Starlight' },
      guide: { href: '/docs/astro', label: 'Starlight guide' },
    },
    {
      id: 'docusaurus',
      label: 'Docusaurus',
      code: await codeBlock(
        "export default {\n  plugins: ['ondocs/docusaurus'],\n};",
        'ts',
        'docusaurus.config.ts',
      ),
      demo: { href: demoUrl('Docusaurus'), label: 'See it live on Docusaurus' },
      guide: { href: '/docs/docusaurus', label: 'Docusaurus guide' },
    },
    {
      id: 'vitepress',
      label: 'VitePress',
      code: await codeBlock(
        "import { defineConfig } from 'vitepress';\nimport { withOndocs } from 'ondocs/vitepress';\nexport default withOndocs(defineConfig({ title: 'Acme Docs' }));",
        'ts',
        '.vitepress/config.mts',
      ),
      demo: { href: demoUrl('VitePress'), label: 'See it live on VitePress' },
      guide: { href: '/docs/vitepress', label: 'VitePress guide' },
    },
    {
      id: 'nextjs',
      label: 'Next.js',
      code: await codeBlock(
        "import { createAskHandler } from 'ondocs/server';\nexport const POST = createAskHandler({ index, model });",
        'ts',
        'app/api/ask/route.ts',
      ),
      note: 'This site is built this way.',
      guide: { href: '/docs/nextjs', label: 'Next.js guide' },
    },
    {
      id: 'script',
      label: 'Any site',
      code: await codeBlock(
        `<script src="${EMBED_SRC}"\n  data-endpoint="/api/ask" defer></script>`,
        'html',
        'Any page',
      ),
      guide: { href: '/docs/script-tag', label: 'Script tag guide' },
    },
  ];
}

async function setupTabs(): Promise<SetupTab[]> {
  const DEPLOY_STEP = {
    title: 'Write the endpoint',
    text: (
      <>
        One function on your host answers from the index, with your model key, rate-limited and on a
        daily budget. <code>npx ondocs init</code> writes it for Vercel, Netlify, Cloudflare, or
        GitHub Pages with Workers AI and no API key, and deploys nothing.
      </>
    ),
    link: { href: '/docs/deployment', label: 'What it writes for each host' },
    code: await codeBlock('npx ondocs init', 'sh'),
  };
  const ASTRO_STEP = {
    title: 'Deploy as you do now',
    text: (
      <>
        With an SSR adapter, the integration serves the ask and MCP endpoints itself: there is no
        file to write. A static site writes its endpoint with <code>npx ondocs init</code>.
      </>
    ),
    link: { href: '/docs/deployment#astro-with-an-adapter', label: 'Astro with an adapter' },
  };
  return [
    {
      id: 'astro',
      label: 'Astro and Starlight',
      summary:
        'A Starlight plugin, and an integration for any other Astro site. It indexes what Starlight’s own search indexes into dist/ask-index.json, and adds the dialog to every page.',
      docs: { href: '/docs/astro', label: 'Astro and Starlight guide' },
      demo: { href: demoUrl('Starlight'), label: 'Live Starlight demo' },
      steps: [
        {
          title: 'Install',
          code: await codeBlock('npm i ondocs ai @ai-sdk/openai', 'sh'),
        },
        {
          title: 'Add the plugin',
          code: await codeBlock(
            "// astro.config.mjs\nimport starlight from '@astrojs/starlight';\nimport ondocs from 'ondocs/starlight';\nimport { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  integrations: [starlight({ title: 'Acme Docs', plugins: [ondocs()] })],\n});",
            'js',
          ),
        },
        ASTRO_STEP,
      ],
    },
    {
      id: 'docusaurus',
      label: 'Docusaurus',
      summary:
        'A Docusaurus 3 plugin. After every build it indexes the pages your site serves into build/ask-index.json, and it adds the dialog behind a floating “Ask AI” button and ⌘I.',
      docs: { href: '/docs/docusaurus', label: 'Docusaurus guide' },
      demo: { href: demoUrl('Docusaurus'), label: 'Live Docusaurus demo' },
      steps: [
        {
          title: 'Install',
          code: await codeBlock('npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk', 'sh'),
        },
        {
          title: 'Add the plugin',
          code: await codeBlock(
            "// docusaurus.config.ts\nexport default {\n  plugins: ['ondocs/docusaurus'],\n};",
            'ts',
          ),
        },
        DEPLOY_STEP,
      ],
    },
    {
      id: 'vitepress',
      label: 'VitePress',
      summary:
        'A VitePress plugin that wraps your config. After every build it indexes the pages your site serves into .vitepress/dist/ask-index.json, and it adds the dialog behind a floating “Ask AI” button and ⌘I.',
      docs: { href: '/docs/vitepress', label: 'VitePress guide' },
      demo: { href: demoUrl('VitePress'), label: 'Live VitePress demo' },
      steps: [
        {
          title: 'Install',
          code: await codeBlock('npm i ondocs ai @ai-sdk/openai', 'sh'),
        },
        {
          title: 'Wrap the config',
          code: await codeBlock(
            "// .vitepress/config.mts\nimport { defineConfig } from 'vitepress';\nimport { withOndocs } from 'ondocs/vitepress';\n\nexport default withOndocs(\n  defineConfig({\n    title: 'Acme Docs',\n  }),\n);",
            'ts',
          ),
        },
        DEPLOY_STEP,
      ],
    },
    {
      id: 'nextjs',
      label: 'Next.js and React',
      summary:
        'Index your content with the CLI, mount the handler as a route, and render the dialog. This site is built exactly this way.',
      docs: { href: '/docs/nextjs', label: 'Next.js and React guide' },
      steps: [
        {
          title: 'Index your content',
          code: await codeBlock(
            'npx ondocs index content --base-url /docs -e openai:text-embedding-3-small',
            'sh',
          ),
        },
        {
          title: 'Mount the endpoint',
          code: await codeBlock(
            "// app/api/ask/route.ts\nimport { openai } from '@ai-sdk/openai';\nimport { createAskHandler } from 'ondocs/server';\nimport index from '../../../ask-index.json';\n\nexport const POST = createAskHandler({\n  index,\n  model: openai('gpt-5.4-mini'),\n  embeddingModel: openai.embedding('text-embedding-3-small'),\n});",
            'ts',
          ),
        },
        {
          title: 'Render the dialog',
          code: await codeBlock(
            "'use client';\nimport { AskDialog } from 'ondocs/react';\nimport 'ondocs/react/styles.css';\nimport 'ondocs/embed/launcher.css';\n\nexport const Ask = () => <AskDialog launcher />;",
            'tsx',
          ),
        },
      ],
    },
    {
      id: 'script',
      label: 'Any site',
      summary:
        'Hugo, Jekyll, Eleventy, MkDocs or plain HTML: index the HTML your generator built, write the endpoint with one command, and add one script tag. The dialog loads the first time it is wanted.',
      docs: { href: '/docs/script-tag', label: 'Script tag guide' },
      steps: [
        {
          title: 'Index the built site',
          code: await codeBlock('npx ondocs index public -e openai:text-embedding-3-small', 'sh'),
        },
        DEPLOY_STEP,
        {
          title: 'Add the script tag',
          code: await codeBlock(
            `<script\n  src="${EMBED_SRC}"\n  data-endpoint="/api/ask"\n  defer\n></script>`,
            'html',
          ),
        },
      ],
    },
  ];
}

/** Where the queries behind the two retrieval numbers live, checked on every pull request. */
const QUERIES_URL = `${GITHUB_URL}/blob/main/test/corpus.test.ts`;

/** The official MCP client against the endpoint, in each way clients connect, on every pull request. */
const MCP_CLIENT_TEST_URL = `${GITHUB_URL}/blob/main/test/mcp-client.test.ts`;

const NUMBERS: {
  value: string;
  label: string;
  note: string;
  link?: { href: string; label: string };
}[] = [
  {
    value: '1.6 MB',
    label: 'index for 1,000 chunks',
    note: 'int8 vectors in base64; 0.9 MB gzipped. The same index as float JSON is 7.5 MB.',
  },
  {
    value: '0.71 ms',
    label: 'median query over 1,000 chunks',
    note: 'BM25, cosine scan and fusion, in memory. 6.96 ms at 10,000 chunks.',
  },
  {
    // Measured from the package as the site builds.
    value: gzippedSize('embed.global.js'),
    label: 'script tag on each page, gzipped',
    note: 'The button and shortcut. The dialog loads the first time it is wanted.',
  },
  {
    value: '22 / 22',
    label: 'agent-style searches we wrote, with the right page in the top three',
    note: 'On docusaurus.io’s own docs, keyword-only: no model call. Checked in CI.',
    link: { href: QUERIES_URL, label: 'The queries' },
  },
  {
    value: '20 / 22',
    label: 'the same needs, asked as a person asks',
    note: 'Questions we wrote too. Real Stack Overflow and GitHub questions, in their own words, find the right page far less often.',
  },
  {
    value: '≤ 800',
    label: 'output tokens per answer, by default',
    note: 'With at most 8,000 characters of sources in: one embedding call and one model call.',
  },
];

type Cell = string | { text: string; good?: boolean };

const COMPARISON: { label: string; hosted: Cell; ours: Cell; search: Cell }[] = [
  {
    label: 'What a visitor gets',
    hosted: 'Written answers with citations',
    ours: { text: 'Written answers citing the exact section', good: true },
    search: 'A list of matching pages',
  },
  {
    label: 'Where your docs are indexed',
    hosted: 'On the vendor’s platform',
    ours: { text: 'A static file in your build', good: true },
    search: 'Static files in your build',
  },
  {
    label: 'What you run',
    hosted: 'Nothing, it is hosted',
    ours: 'One function: Vercel, Netlify, Cloudflare or any Request → Response runtime',
    search: 'Nothing',
  },
  {
    label: 'Model and key',
    hosted: 'The vendor’s (Algolia Ask AI: yours)',
    ours: { text: 'Yours, through any AI SDK provider', good: true },
    search: 'None',
  },
  {
    label: 'Account and pricing',
    hosted: 'A vendor account and plan',
    ours: { text: 'None. You pay your model provider per question', good: true },
    search: 'None',
  },
  {
    label: 'For agents',
    hosted: 'Hosted MCP on most plans',
    ours: {
      text: 'Your own MCP endpoint and llms.txt; by default, agent search calls no model',
      good: true,
    },
    search: 'No',
  },
  {
    label: 'Follow-up questions and dashboards',
    hosted: 'Typically included',
    ours: 'Follow-ups, yes. No dashboard: log questions with onFinish',
    search: 'No',
  },
];

function CellText({ cell }: { cell: Cell }) {
  return typeof cell === 'string' ? (
    cell
  ) : (
    <span data-good={cell.good ? '' : undefined}>{cell.text}</span>
  );
}

/** What the For agents section shows an agent searching for. */
const AGENT_QUERY = 'GitHub Pages without an API key';

export default async function Home() {
  const [tabs, picker, initial, agent, tryIt] = await Promise.all([
    setupTabs(),
    frameworks(),
    sampleAnswer(SUGGESTIONS[0] ?? ''),
    mcpSample(AGENT_QUERY),
    codeBlock(`$ ${INSTALL}\n$ npx ondocs index ./docs -e mock\n$ npx ondocs dev`, 'console'),
  ]);
  const agentResult = agent
    ? await codeBlock(
        JSON.stringify({ results: agent.results }, null, 2),
        'json',
        `search({ query: "${agent.query}" })`,
      )
    : null;
  return (
    <main id="content" className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(softwareSourceCode()) }}
      />
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="hero-badge">
              <span className="hero-badge-dot" aria-hidden="true" />
              Open source · MIT
            </p>
            <h1 id="hero-title" className="hero-title">
              {/* The category stays on one line. */}
              Open-source Ask&nbsp;AI for your docs.
            </h1>
            <p className="hero-lead">
              Cited answers on your own model key, and an MCP server for coding agents, from one
              index built with your Starlight, Docusaurus or VitePress site. No vendor, no vector
              database.
            </p>
            <div className="hero-actions">
              <Link href="/docs/getting-started" className="button button-primary">
                Get started
                <ArrowRight />
              </Link>
              <a href="#demos" className="button button-secondary">
                See the live demos
              </a>
              <AskButton className="button button-ghost hero-ask">Ask these docs</AskButton>
            </div>
            <FrameworkPicker frameworks={picker} />
          </div>
          <HeroDemo suggestions={SUGGESTIONS} initial={initial} mode={mode} />
          <div className="hero-band">
            <AgentStrip url={MCP_URL} name="ondocs" />
            {/* Each item says where it is measured or checked. */}
            <ul className="proof">
              <li>
                <Link href="/docs/benchmarks#bundle-size">
                  Up to {largestPageAddition()} of JavaScript per page. The dialog loads on first
                  use.
                </Link>
              </li>
              <li>
                <Link href="/docs/deployment#write-the-endpoint-with-init">
                  Rate limit, daily budget and answer cache in every ask endpoint{' '}
                  <code>ondocs init</code> writes.
                </Link>
              </li>
              <li>
                <Link href="/docs/mcp#keyword-only-or-hybrid-search">
                  Agent search calls no model, by default.
                </Link>
              </li>
              <li>
                <a href={MCP_CLIENT_TEST_URL}>
                  MCP checked in CI with the official TypeScript client.
                </a>
              </li>
              <li>
                Live on{' '}
                {DEMOS.map(({ label, href }, i) => (
                  <Fragment key={label}>
                    {i === 0 ? '' : i === DEMOS.length - 1 ? ' and ' : ', '}
                    <a href={href}>{label}</a>
                  </Fragment>
                ))}
                .
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="demos" aria-labelledby="demos-title">
        <div className="container">
          <p className="eyebrow">Live demos</p>
          <h2 id="demos-title" className="section-title">
            These docs, on real Starlight, Docusaurus and VitePress sites.
          </h2>
          <p className="section-lead">
            Each site is built with its framework&rsquo;s plugin, and its Ask dialog answers from
            this site&rsquo;s endpoint. Open one and ask it something.
          </p>
          <div className="principles demos">
            {DEMOS.map(({ label, href, entry }) => (
              <div key={href}>
                <h3>{label}</h3>
                <p>
                  Built with <code>{entry}</code>.
                </p>
                <a href={href} className="text-link">
                  {new URL(href).host}
                  <ArrowRight />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="setup-title">
        <div className="container">
          <p className="eyebrow">Set up</p>
          <h2 id="setup-title" className="section-title">
            One line for Starlight, Docusaurus and VitePress. A script tag for everything else.
          </h2>
          <p className="section-lead">
            Every setup has the same two halves: an index built with your site, and one function
            that answers from it. The plugins do the first half for you.
          </p>
          <SetupTabs tabs={tabs} />
        </div>
      </section>

      <section className="section" aria-labelledby="agents-title">
        <div className="container">
          <p className="eyebrow">For agents</p>
          <h2 id="agents-title" className="section-title">
            The same index, for the agents that read your docs.
          </h2>
          <p className="section-lead">
            Coding agents and AI apps search and read your docs over MCP, with their own model.
            Search is keyword-only by default, so it calls no model at all. Connect yours to these
            docs:
          </p>
          <div className="agents">
            <McpInstall url={MCP_URL} name="ondocs" />
            {agent && agentResult ? (
              <figure className="agents-result">
                <div dangerouslySetInnerHTML={{ __html: agentResult }} />
                <figcaption>
                  What an agent gets back: the first of the {agent.found} sections this site’s MCP
                  server found, asked while the page was built.
                </figcaption>
              </figure>
            ) : null}
          </div>
          <div className="principles">
            <div>
              <h3>search and fetch</h3>
              <p>
                Ranked sections with a snippet and a link to the anchor, then the page or section as
                Markdown: the shape ChatGPT’s connectors expect, over MCP 2026-07-28 and 2025-11-25.
              </p>
            </div>
            <div>
              <h3>llms.txt and .md pages</h3>
              <p>
                The plugins also write <code>llms.txt</code>, <code>llms-full.txt</code> and a
                Markdown copy of every page, and leave alone what another llms plugin writes.
              </p>
            </div>
            <div>
              <h3>Add to Cursor, VS Code, Claude</h3>
              <p>
                With the plugins’ <code>mcp</code> option, a docs page shows the install links and
                the Claude Code command for your endpoint.
              </p>
            </div>
          </div>
          <Link href="/docs/mcp" className="text-link">
            The MCP server
            <ArrowRight />
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="how-title">
        <div className="container">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title" className="section-title">
            Indexed when you deploy. Searched in memory when someone asks.
          </h2>
          <p className="section-lead">
            Docs change when you deploy, not between requests, so the index is a file built with the
            site instead of a database kept in sync with it.
          </p>
          <Flow />
          <div className="principles">
            <div>
              <h3>Keywords and meaning</h3>
              <p>
                BM25 finds exact names like <code>createAskHandler</code> and error codes; vectors
                find paraphrases. Reciprocal rank fusion merges the two rankings by rank alone.
              </p>
            </div>
            <div>
              <h3>A gate before the model</h3>
              <p>
                Most off-topic questions get “I don’t know” before the model is called, fast and
                free. One that shares enough words with your docs can still reach it, and the model
                is told to answer from the sources alone.
              </p>
            </div>
            <div>
              <h3>Citations that land</h3>
              <p>
                Pages are split at every heading, so <span className="inline-cite">1</span> opens
                the section an answer came from, at the URL your framework serves.
              </p>
            </div>
          </div>
          <Link href="/docs/retrieval" className="text-link">
            How retrieval works
            <ArrowRight />
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="numbers-title">
        <div className="container">
          <p className="eyebrow">Numbers</p>
          <h2 id="numbers-title" className="section-title">
            Measured, at the sizes a docs site has.
          </h2>
          <dl className="numbers">
            {NUMBERS.map((item) => (
              <div key={item.label} className="number">
                <dt>
                  <span className="number-value">{item.value}</span>
                  <span className="number-label">{item.label}</span>
                </dt>
                <dd>
                  {item.note}
                  {item.link ? (
                    <>
                      {' '}
                      <a href={item.link.href}>{item.link.label}</a>
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="numbers-source">
            From <code>pnpm bench</code> on an Apple M1 Max with Node 24.18: synthetic,
            documentation-shaped corpora with 512-dimension vectors, 1,000 queries per size. Query
            times exclude the embedding API call. <Link href="/docs/benchmarks">All results</Link>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="compare-title">
        <div className="container">
          <p className="eyebrow">Compared</p>
          <h2 id="compare-title" className="section-title">
            A local index like Pagefind’s, plus cited answers. No cloud account.
          </h2>
          <div className="compare-scroll">
            <table className="compare">
              <caption className="sr-only">
                Hosted assistants, ondocs and search-only tools compared
              </caption>
              <thead>
                <tr>
                  <td />
                  <th scope="col">
                    Hosted assistants
                    <span>Kapa, Inkeep, Algolia Ask AI, Biel.ai</span>
                  </th>
                  <th scope="col" className="compare-ours">
                    ondocs
                    <span>A library, on your infrastructure</span>
                  </th>
                  <th scope="col">
                    Search only
                    <span>Pagefind, Orama’s local index</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td data-label="Hosted assistants">
                      <CellText cell={row.hosted} />
                    </td>
                    <td data-label="ondocs" className="compare-ours">
                      <CellText cell={row.ours} />
                    </td>
                    <td data-label="Search only">
                      <CellText cell={row.search} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="not-for">
            <h3>When it’s the wrong tool</h3>
            <ul>
              <li>
                <strong>Past about 50,000 chunks.</strong> Search is an exact scan; at that size an
                approximate index or a vector database is better.
              </li>
              <li>
                <strong>Content that changes per user or per request.</strong> The index is rebuilt
                when you deploy.
              </li>
              <li>
                <strong>Multi-turn chat with a dashboard, and nothing to run.</strong> A hosted
                assistant does that.
              </li>
              <li>
                <strong>Search results with no server at all.</strong> Use Pagefind.
              </li>
            </ul>
            <Link href="/docs/limits" className="text-link">
              Limits and trade-offs
              <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <section className="section cta" aria-labelledby="cta-title">
        <div className="container">
          <h2 id="cta-title" className="cta-title">
            Add it to your docs.
          </h2>
          <p className="section-lead">
            Try it on your own content in two minutes, without an API key: index with the mock model
            and run <code>npx ondocs dev</code>.
          </p>
          <div className="cta-code" dangerouslySetInnerHTML={{ __html: tryIt }} />
          <div className="cta-actions">
            <a href={GITHUB_URL} className="button button-secondary">
              <GitHubIcon />
              Star on GitHub
            </a>
            <Link href="/docs" className="button button-ghost">
              Read the docs
              <ArrowRight />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
