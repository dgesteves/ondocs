// The endpoint on Bun and on Deno, which the docs say it runs on: `createAskHandler` from the
// built package, served by the runtime's own server as the docs show it (`Bun.serve({ fetch:
// handler })`, `Deno.serve(handler)`), and asked a question over HTTP with the mock models. The
// answer must stream back with its sources, and a preflight must get its 204.
//
//   pnpm build
//   node dist/cli.js index examples/nextjs/content/docs --base-url /docs -e mock -o ask-index.json
//   bun scripts/runtime-smoke.mjs ask-index.json
//   deno run --allow-read --allow-net --allow-env scripts/runtime-smoke.mjs ask-index.json
//
// CI's runtimes job runs it on both. Only this script reads the file; the handler gets the parsed
// index, as a Worker or an edge function that imports it does.
import { readFileSync } from 'node:fs';

import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../dist/mock.js';
import { createAskHandler } from '../dist/server.js';

const QUESTION = 'How do I install ondocs?';

const [file] = (globalThis.Deno?.args ?? process.argv.slice(2)).filter(Boolean);
const runtime = globalThis.Bun
  ? `Bun ${globalThis.Bun.version}`
  : globalThis.Deno
    ? `Deno ${globalThis.Deno.version.deno}`
    : null;
if (!runtime || !file) {
  console.error('Usage: bun|deno run scripts/runtime-smoke.mjs <mock ask-index.json>');
  process.exit(2);
}

const index = JSON.parse(readFileSync(file, 'utf8'));
const handler = createAskHandler({
  index,
  model: mockLanguageModel(),
  embeddingModel: mockEmbeddingModel({ dimensions: index.embedding?.dimensions }),
  retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
  allowedOrigins: ['https://docs.example.com'],
});

// Port 0: the runtime picks a free one.
const server = globalThis.Bun
  ? globalThis.Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler })
  : globalThis.Deno.serve({ port: 0, hostname: '127.0.0.1', onListen: () => undefined }, handler);
const port = globalThis.Bun ? server.port : server.addr.port;
const url = `http://127.0.0.1:${String(port)}/api/ask`;

const problems = [];
try {
  const preflight = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://docs.example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  await preflight.body?.cancel();
  if (preflight.status !== 204) problems.push(`the preflight got ${String(preflight.status)}`);
  if (preflight.headers.get('access-control-allow-origin') !== 'https://docs.example.com') {
    problems.push('the preflight has no access-control-allow-origin for the allowed origin');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ question: QUESTION }),
  });
  const body = await response.text();
  const sources = [...body.matchAll(/"type":"source-url","sourceId":"[^"]+","url":"([^"]+)"/g)].map(
    ([, source]) => source,
  );
  const text = [...body.matchAll(/"type":"text-delta","id":"[^"]+","delta":"((?:[^"\\]|\\.)*)"/g)]
    .map(([, delta]) => JSON.parse(`"${delta}"`))
    .join('');
  if (response.status !== 200) problems.push(`the question got ${String(response.status)}`);
  if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
    problems.push(`the answer is ${String(response.headers.get('content-type'))}, not a stream`);
  }
  if (sources.length === 0) problems.push('the answer has no sources');
  if (!/\[\d+\]/.test(text)) problems.push(`the answer cites no source: ${JSON.stringify(text)}`);
  if (problems.length === 0) {
    console.log(
      `✓ ${runtime}: the endpoint answered "${QUESTION}" with ${String(sources.length)} sources (${sources.slice(0, 3).join(', ')}) and a cited answer, and the preflight with a 204.`,
    );
  }
} finally {
  await (globalThis.Bun ? server.stop(true) : server.shutdown());
}
if (problems.length > 0) {
  console.error(`✗ ${runtime}: ${problems.join('; ')}`);
  process.exit(1);
}
