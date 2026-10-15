// @ts-check
import { createOpenAI } from '@ai-sdk/openai';
import { mockEmbeddingModel } from 'ondocs/mock';

/**
 * The embedding setup, shared by the CLI (`pnpm index`) and the route handler so the index and
 * the queries always use the same model.
 *
 * With OPENAI_API_KEY set (the CLI reads .env.local), it embeds with OpenAI at 512 dimensions.
 * Without it, it uses the deterministic mock model, so the example runs with no key at all.
 */
const shared = {
  baseUrl: '/docs',
  // `pnpm index` passes --llms-txt public: a Markdown copy of each page at /docs/<slug>.md and
  // every page in /llms-full.txt. The site curates /llms.txt itself (app/llms.txt/route.ts), in
  // its sidebar's order, so --no-llms-index leaves that one out.
  llmsTxt: {
    title: 'ondocs',
    description:
      'Open-source Ask AI for your docs. Cited answers on your own model key, and an MCP server for coding agents, from one index built with your Starlight, Docusaurus or VitePress site. No vendor, no vector database.',
    siteUrl: 'https://ondocs.vercel.app',
    mcp: 'https://ondocs.vercel.app/api/mcp',
  },
};

/** @type {import('ondocs/node').AskConfig} */
const config = process.env.OPENAI_API_KEY
  ? {
      ...shared,
      embeddingModel: createOpenAI().embedding('text-embedding-3-small'),
      embeddingProviderOptions: { openai: { dimensions: 512 } },
    }
  : { ...shared, embeddingModel: mockEmbeddingModel() };

export default config;
