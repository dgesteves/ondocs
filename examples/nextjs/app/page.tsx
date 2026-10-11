import type { Metadata } from 'next';
import Link from 'next/link';

import { AskButton } from '../components/ask';
import { ArrowRight, CopyIcon, GitHubIcon } from '../components/icons';
import { Flow } from '../components/landing/flow';
import { HeroDemo } from '../components/landing/hero-demo';
import { SetupTabs, type SetupTab } from '../components/landing/setup-tabs';
import { mode } from '../lib/ai';
import { codeBlock } from '../lib/highlight';
import { sampleAnswer } from '../lib/sample-answer';
import { GITHUB_URL, INSTALL, SUGGESTIONS, VERSION } from '../lib/site';

import './landing.css';

export const metadata: Metadata = {
  title: { absolute: 'ondocs: make your docs answerable by people and by agents' },
  alternates: { canonical: '/', types: { 'text/plain': '/llms.txt' } },
};

async function setupTabs(): Promise<SetupTab[]> {
  const DEPLOY_STEP = {
    title: 'Write the endpoint',
    text: 'One function on your host answers from the index, with your model key, rate-limited and on a daily budget. init writes it for Vercel, Netlify, Cloudflare, or GitHub Pages with Workers AI and no API key, and deploys nothing.',
    link: { href: '/docs/deployment', label: 'What it writes for each host' },
    code: await codeBlock('npx ondocs init', 'sh'),
  };
  const ASTRO_STEP = {
    title: 'Deploy as you do now',
    text: 'With an SSR adapter, the integration serves the ask and MCP endpoints itself: there is no file to write. A static site writes its endpoint with npx ondocs init.',
    link: { href: '/docs/deployment#astro-with-an-adapter', label: 'Astro with an adapter' },
  };
  return [
    {
      id: 'docusaurus',
      label: 'Docusaurus',
      summary:
        'A Docusaurus 3 plugin. After every build it indexes the pages your site serves into build/ask-index.json, and it adds the dialog behind a floating “Ask AI” button and ⌘I.',
      docs: { href: '/docs/docusaurus', label: 'Docusaurus guide' },
      steps: [
        {
          title: 'Install',
          code: await codeBlock('npm i ondocs ai @ai-sdk/openai @radix-ui/react-dialog cmdk', 'sh'),
        },
        {
          title: 'Add the plugin',
          code: await codeBlock(
            "// docusaurus.config.ts\nexport default {\n  plugins: [['ondocs/docusaurus', { endpoint: '/api/ask' }]],\n};",
            'ts',
          ),
        },
        DEPLOY_STEP,
      ],
    },
    {
      id: 'astro',
      label: 'Astro and Starlight',
      summary:
        'A Starlight plugin, and an integration for any other Astro site. It indexes what Starlight’s own search indexes into dist/ask-index.json, and adds the dialog to every page.',
      docs: { href: '/docs/astro', label: 'Astro and Starlight guide' },
      steps: [
        {
          title: 'Install',
          code: await codeBlock(
            'npm i ondocs ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk',
            'sh',
          ),
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
            '<script\n  src="https://cdn.jsdelivr.net/npm/ondocs@0.8/dist/embed.global.js"\n  data-endpoint="/api/ask"\n  defer\n></script>',
            'html',
          ),
        },
      ],
    },
  ];
}

const NUMBERS = [
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
    value: '22 / 22',
    label: 'agent searches with the right page in the top three',
    note: 'On docusaurus.io’s own docs, keyword-only: no model call. Checked in CI.',
  },
  {
    value: '2.4 KB',
    label: 'script tag on each page, gzipped',
    note: 'The button and shortcut. The dialog loads the first time it is wanted.',
  },
  {
    value: '0',
    label: 'model calls for a question the docs don’t cover',
    note: 'The relevance gate answers “I don’t know” before the model is reached.',
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
    hosted: 'The vendor’s',
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
    hosted: 'Varies by vendor',
    ours: { text: 'An MCP server and llms.txt from the same index', good: true },
    search: 'No',
  },
  {
    label: 'Dashboards and multi-turn chat',
    hosted: 'Typically included',
    ours: 'No. Single-turn answers; log questions with onFinish',
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

function Install({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? 'install install-large' : 'install'}>
      <code>
        <span className="install-prompt" aria-hidden="true">
          $
        </span>
        {INSTALL}
      </code>
      <button
        type="button"
        className="install-copy"
        data-copy={INSTALL}
        aria-label={`Copy “${INSTALL}”`}
      >
        <CopyIcon />
        <span className="copy-label">Copy</span>
      </button>
    </div>
  );
}

export default async function Home() {
  const [tabs, initial] = await Promise.all([setupTabs(), sampleAnswer(SUGGESTIONS[0] ?? '')]);
  return (
    <main id="content" className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="hero-badge">
              <span className="hero-badge-dot" aria-hidden="true" />
              Open source · MIT · v{VERSION}
            </p>
            <h1 id="hero-title" className="hero-title">
              Make your docs answerable, by people and by agents.
            </h1>
            <p className="hero-lead">
              One static index, built with your site, serves a cited Ask box for people, and an MCP
              server and llms.txt for agents. A function you deploy searches it in memory and
              answers with your own model key, citing the exact section. Agents bring their own
              model, so their traffic costs you no model tokens.
            </p>
            <ul className="hero-facts" aria-label="What it does without">
              <li>No vector database</li>
              <li>No vendor</li>
              <li>Your own function and key</li>
              <li>MCP and llms.txt included</li>
            </ul>
            <div className="hero-actions">
              <AskButton className="button button-primary">Try it: ask these docs</AskButton>
              <Install />
            </div>
          </div>
          <HeroDemo suggestions={SUGGESTIONS} initial={initial} mode={mode} />
        </div>
      </section>

      <section className="section" aria-labelledby="setup-title">
        <div className="container">
          <p className="eyebrow">Set up</p>
          <h2 id="setup-title" className="section-title">
            One line for Docusaurus and Starlight. A script tag for everything else.
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
            Search is keyword-only by default, so it calls no model at all. These docs do it at{' '}
            <code>/api/mcp</code>:
          </p>
          <div
            className="agents-code"
            dangerouslySetInnerHTML={{
              __html: await codeBlock(
                'claude mcp add --transport http ondocs https://ondocs.vercel.app/api/mcp',
                'sh',
              ),
            }}
          />
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
                Nothing relevant means “I don’t know”, fast and free. The model only sees questions
                your docs can answer, and is told to answer from the sources alone.
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
                <dd>{item.note}</dd>
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
                    <span>Kapa, Inkeep, Algolia Ask AI, Biel.ai, Markprompt</span>
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
          <Install large />
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
