// The files `ondocs init` writes: one ask endpoint and one MCP endpoint per host, with the
// rate limit, the daily budget and, where the endpoint is on another origin than the pages, CORS.
// Each is plain code the site owns afterwards, so it reads as if written by hand.

/** Where the endpoint runs. */
export type Host = 'vercel' | 'netlify' | 'cloudflare' | 'github-pages';

/** How a Cloudflare site is deployed: Pages (with Pages Functions) or a Worker with static assets. */
export type CloudflareMode = 'pages' | 'workers';

export interface TemplateSite {
  /** The site's name, for the model's instructions. */
  name: string;
  /** The index's path in the project, where the build writes it, such as `build/ask-index.json`. */
  indexFile: string;
  /** The index's path on the site, from its root: `/ask-index.json`. */
  indexPath: string;
  /** The site's public URL, with its base path: `https://acme.github.io/docs`. */
  url?: string;
  /** The site's other locales, each with an index of its own at `<locale>/ask-index.json`. */
  locales?: string[];
}

/** A locale's index file, next to the default one: `build/fr/ask-index.json`. */
const localeFile = (site: TemplateSite, locale: string): string => {
  const slash = site.indexFile.lastIndexOf('/');
  return `${site.indexFile.slice(0, slash + 1)}${locale}/${site.indexFile.slice(slash + 1)}`;
};

/** A locale's index path on the site: `/fr/ask-index.json`. */
const localePath = (site: TemplateSite, locale: string): string =>
  site.indexPath.replace(/^\/?/, `/${locale}/`);

/** The index files to bundle with a function: the default one, and each locale's. */
export const indexFiles = (site: TemplateSite): string[] => [
  site.indexFile,
  ...(site.locales ?? []).map((locale) => localeFile(site, locale)),
];

/**
 * The ask handler's `indexes`, one line, when the site has other locales: each loaded as
 * `load(fileOrPath)` writes it. Empty without.
 */
function indexesOption(site: TemplateSite, pad: string, load: (locale: string) => string): string {
  if (!site.locales?.length) return '';
  const key = (locale: string) => (/^[a-z_$][\w$]*$/i.test(locale) ? locale : quote(locale));
  return [
    `${pad}// Each locale's index, which the dialog asks for on that locale's pages.`,
    `${pad}indexes: {`,
    ...site.locales.map((locale) => `${pad}  ${key(locale)}: ${load(locale)},`),
    `${pad}},`,
    '',
  ].join('\n');
}

export interface GeneratedFile {
  /** Relative to the project root. */
  path: string;
  content: string;
  /** What it is, for init's summary. */
  description: string;
  /**
   * An edit to a config file the site already has that only adds to it (a key, a table), so
   * init makes it without asking.
   */
  addition?: boolean;
}

/** Text as `//` comment lines of at most 100 characters. */
export function comment(text: string, pad = ''): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && pad.length + 3 + line.length + 1 + word.length > 100) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((text) => `${pad}// ${text}`).join('\n');
}

const HEADER = (what: string, ...paragraphs: string[]) =>
  [
    comment(
      `${what} Written by \`npx ondocs init\`: edit it as you like, and init asks before it overwrites it.`,
    ),
    ...paragraphs.map((paragraph) => comment(paragraph)),
  ].join('\n//\n');

const MODEL = 'gpt-5.4-mini';
const EMBEDDING = 'text-embedding-3-small';

/** The client IP header each host sets, replacing whatever the client sent. */
const CLIENT_IP: Record<Host, string | null> = {
  vercel: null, // X-Forwarded-For, which Vercel overwrites: the limiter's default
  netlify: 'x-nf-client-connection-ip',
  cloudflare: 'cf-connecting-ip',
  'github-pages': 'cf-connecting-ip',
};

const HOST_NAMES: Record<Host, string> = {
  vercel: 'Vercel',
  netlify: 'Netlify',
  cloudflare: 'Cloudflare',
  'github-pages': 'Cloudflare',
};

const quote = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function limiter(host: Host, limit: number): string {
  const header = CLIENT_IP[host];
  return header
    ? `memoryRateLimit({ limit: ${String(limit)}, windowMs: 60_000, trustedHeader: '${header}' })`
    : `memoryRateLimit({ limit: ${String(limit)}, windowMs: 60_000 })`;
}

function limiterComment(host: Host, what: string): string {
  const header = CLIENT_IP[host];
  return header
    ? `// ${what} per client, keyed on ${header}, the client IP ${HOST_NAMES[host]} sets.`
    : `// ${what} per client, keyed on the client IP Vercel sets in X-Forwarded-For.`;
}

/**
 * The bot check, on once TURNSTILE_SECRET_KEY is set where the endpoint runs (`secret` reads it),
 * indented by `pad`.
 */
function challengeOption(secret: string, pad: string): string {
  return [
    comment(
      "A bot check on each question, once TURNSTILE_SECRET_KEY holds a Turnstile widget's secret key. Give the dialog the widget's site key as challenge.turnstile.",
      pad,
    ),
    `${pad}...(${secret}`,
    `${pad}  ? { challenge: turnstile({ secretKey: ${secret} }) }`,
    `${pad}  : {}),`,
  ].join('\n');
}

/** The options both kinds of ask endpoint share, after `index`, indented by `pad`. */
function askOptions(
  site: TemplateSite,
  host: Host,
  pad: string,
  openai = 'openai',
  secret = 'process.env.TURNSTILE_SECRET_KEY',
): string {
  return [
    `model: ${openai}('${MODEL}'),`,
    '// The model the plugins and the CLI embed pages with when OPENAI_API_KEY is set as the site',
    '// builds. The index records its model, and a different one here fails loudly. An index built',
    '// without a key has no vectors: it is searched by keywords, and this model is never called.',
    `embeddingModel: ${openai}.embedding('${EMBEDDING}'),`,
    `siteName: ${quote(site.name)},`,
    limiterComment(host, '10 questions a minute'),
    `rateLimit: ${limiter(host, 10)},`,
    '// A daily cap for the endpoint, counted per instance: about 500 answers. Set a spend limit',
    '// with your model provider as well; it is the only hard cap.',
    'budget: { requestsPerDay: 500, tokensPerDay: 1_500_000 },',
    '// A question asked again is answered from memory, without a model call.',
    'answerCache: true,',
  ]
    .map((line) => `${pad}${line}`)
    .concat(challengeOption(secret, pad))
    .join('\n');
}

/** The options of an MCP endpoint, after `index`. */
function mcpOptions(site: TemplateSite, host: Host, pad: string): string {
  return [
    `siteName: ${quote(docsName(site.name))},`,
    limiterComment(host, '60 tool calls a minute'),
    `rateLimit: ${limiter(host, 60)},`,
  ]
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/** How the MCP tools' descriptions name the docs: "Acme Docs", or "the acme-site docs". */
const docsName = (name: string): string =>
  /\bdocs?\b|documentation/i.test(name) ? name : `the ${name} docs`;

const readIndex = (site: TemplateSite) =>
  `() => readFile(join(process.cwd(), ${quote(site.indexFile)}), 'utf8')`;

/** Where init writes the Netlify Functions, in the folder Netlify builds from. */
const NETLIFY_FUNCTIONS = 'netlify/functions';

/**
 * The index read by its path from the Netlify Function's own file. Netlify runs a function from
 * the root of its bundle, which is the base directory's only when the dependencies are there too:
 * in a workspace that installs them at its root, it is the workspace's root.
 */
const readBundled = (site: TemplateSite) =>
  `() => readFile(new URL(${quote(`${'../'.repeat(NETLIFY_FUNCTIONS.split('/').length)}${site.indexFile}`)}, import.meta.url), 'utf8')`;

/** `api/ask.ts` and `api/mcp.ts`, Vercel Functions, for a static site. */
export function vercelFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  const imports = (names: string) =>
    [
      "import { readFile } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      '',
      ...(names.includes('createAskHandler') ? ["import { openai } from '@ai-sdk/openai';"] : []),
      `import { ${names} } from 'ondocs/server';`,
    ].join('\n');
  const files: GeneratedFile[] = [
    {
      path: 'api/ask.ts',
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Vercel Function.', `It answers from ${site.indexFile}, which the build writes and vercel.json bundles with this function. Set OPENAI_API_KEY in the project's environment variables: the build embeds the pages with it, and this function embeds questions and calls the model.`)}
${imports('createAskHandler, memoryRateLimit, turnstile')}

const handler = createAskHandler({
  index: ${readIndex(site)},
${indexesOption(site, '  ', (locale) => readIndex({ ...site, indexFile: localeFile(site, locale) }))}${askOptions(site, 'vercel', '  ')}
});

export const POST = handler;
// CORS preflights, for a dialog on another origin (list its origin in \`allowedOrigins\`).
export const OPTIONS = handler;
`,
    },
  ];
  if (mcp) {
    files.push({
      path: 'api/mcp.ts',
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Vercel Function.', `It serves ${site.indexFile} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own.`)}
${imports('createMcpHandler, memoryRateLimit')}

const handler = createMcpHandler({
  index: ${readIndex(site)},
${mcpOptions(site, 'vercel', '  ')}
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
`,
    });
  }
  return files;
}

/** `vercel.json`, with the index bundled with each function, keeping everything else. */
export function vercelConfig(
  existing: string | null,
  site: TemplateSite,
  mcp: boolean,
): { content: string } | { error: string } {
  let config: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { error: 'vercel.json is not a JSON object' };
      }
      config = parsed as Record<string, unknown>;
    } catch (error) {
      return { error: `vercel.json is not valid JSON (${(error as Error).message})` };
    }
  }
  const functions =
    typeof config.functions === 'object' && config.functions !== null
      ? { ...(config.functions as Record<string, Record<string, unknown>>) }
      : {};
  // One glob for the default index and each locale's: `build/**/ask-index.json`.
  const include = site.locales?.length
    ? `${site.indexFile.slice(0, site.indexFile.lastIndexOf('/') + 1)}**/${site.indexFile.slice(site.indexFile.lastIndexOf('/') + 1)}`
    : site.indexFile;
  for (const file of mcp ? ['api/ask.ts', 'api/mcp.ts'] : ['api/ask.ts']) {
    const included = functions[file]?.includeFiles;
    if (included !== undefined && included !== include) {
      return {
        error: `vercel.json already sets includeFiles for ${file} (${JSON.stringify(included)}): make it include ${include} as well`,
      };
    }
    functions[file] = { ...functions[file], includeFiles: include };
  }
  return { content: `${JSON.stringify({ ...config, functions }, null, 2)}\n` };
}

/** `netlify/functions/ask.mts` and `mcp.mts`, Netlify Functions, for a static site. */
export function netlifyFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  const imports = (names: string) =>
    [
      "import { readFile } from 'node:fs/promises';",
      '',
      ...(names.includes('createAskHandler') ? ["import { openai } from '@ai-sdk/openai';"] : []),
      `import { ${names} } from 'ondocs/server';`,
    ].join('\n');
  const files: GeneratedFile[] = [
    {
      path: `${NETLIFY_FUNCTIONS}/ask.mts`,
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Netlify Function.', `It answers from ${site.indexFile}, which the build writes and netlify.toml bundles with this function, read by its path from this file. Set OPENAI_API_KEY in the site's environment variables: the build embeds the pages with it, and this function embeds questions and calls the model.`)}
${imports('createAskHandler, memoryRateLimit, turnstile')}

export default createAskHandler({
  index: ${readBundled(site)},
${indexesOption(site, '  ', (locale) => readBundled({ ...site, indexFile: localeFile(site, locale) }))}${askOptions(site, 'netlify', '  ')}
});

export const config = { path: '/api/ask' };
`,
    },
  ];
  if (mcp) {
    files.push({
      path: `${NETLIFY_FUNCTIONS}/mcp.mts`,
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Netlify Function.', `It serves ${site.indexFile}, read by its path from this file, to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own.`)}
${imports('createMcpHandler, memoryRateLimit')}

export default createMcpHandler({
  index: ${readBundled(site)},
${mcpOptions(site, 'netlify', '  ')}
});

export const config = { path: '/api/mcp' };
`,
    });
  }
  return files;
}

/**
 * `netlify.toml`, with `included_files` for each function, appended as tables of their own. A
 * file that already configures one of the functions is not edited: the lines to add are returned
 * as `error` instead.
 */
export function netlifyConfig(
  existing: string | null,
  site: TemplateSite,
  mcp: boolean,
): { content: string } | { error: string } {
  const names = mcp ? ['ask', 'mcp'] : ['ask'];
  const files = indexFiles(site)
    .map((file) => JSON.stringify(file))
    .join(', ');
  const tables = names
    .map((name) => `[functions.${name}]\n  included_files = [${files}]`)
    .join('\n\n');
  const text = existing ?? '';
  const configured = names.filter((name) =>
    new RegExp(`^\\s*\\[\\s*functions\\s*\\.\\s*"?${name}"?\\s*\\]`, 'm').test(text),
  );
  if (configured.length > 0) {
    const included = names.every((name) =>
      new RegExp(
        `\\[\\s*functions\\s*\\.\\s*"?${name}"?\\s*\\][^[]*included_files[^\\]]*${site.indexFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ).test(text),
    );
    if (included) return { content: text };
    return {
      error: `netlify.toml already configures ${configured.map((name) => `[functions.${name}]`).join(' and ')}; add included_files = [${files}] to ${configured.length === 1 ? 'it' : 'each'}`,
    };
  }
  const comment = '# The index the ondocs functions answer from, bundled with them.';
  const separator =
    text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${text}${separator}${comment}\n${tables}\n` };
}

/** The index, read from the site's own static files through the ASSETS binding. */
const assetsIndex = (site: TemplateSite, pad: string) =>
  [
    'async () => {',
    `  const response = await env.ASSETS.fetch(new Request(new URL(${quote(site.indexPath)}, request.url)));`,
    `  if (!response.ok) throw new Error(\`${site.indexPath}: HTTP \${String(response.status)}\`);`,
    '  return response.text();',
    '},',
  ]
    .map((line, i) => (i === 0 ? line : `${pad}${line}`))
    .join('\n');

/** For a site with other locales: a loader of one locale's index from the static assets. */
const assetHelper = (site: TemplateSite, pad: string): string =>
  site.locales?.length
    ? [
        `${pad}// A locale's index, from the site's files.`,
        `${pad}const asset = (path: string) => async () => {`,
        `${pad}  const response = await env.ASSETS.fetch(new Request(new URL(path, request.url)));`,
        `${pad}  if (!response.ok) throw new Error(\`\${path}: HTTP \${String(response.status)}\`);`,
        `${pad}  return response.text();`,
        `${pad}};`,
        '',
      ].join('\n')
    : '';

/**
 * `functions/api/ask.ts` and `mcp.ts`, Cloudflare Pages Functions, for a static site on Pages.
 * They read the index through the ASSETS binding, from the same deployment's files.
 */
export function cloudflarePagesFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  const envType = (secret: boolean) =>
    [
      'interface Env {',
      ...(secret
        ? [
            '  OPENAI_API_KEY: string;',
            "  /** A Turnstile widget's secret key, for a bot check on each question. */",
            '  TURNSTILE_SECRET_KEY?: string;',
          ]
        : []),
      '  ASSETS: { fetch: (request: Request) => Promise<Response> };',
      '}',
    ].join('\n');
  const files: GeneratedFile[] = [
    {
      path: 'functions/api/ask.ts',
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Cloudflare Pages Function.', `It answers from ${site.indexPath}, which the build writes into the site's files, read through the ASSETS binding. Set OPENAI_API_KEY as a secret, for production and previews: in the dashboard (Settings, Variables and Secrets) or with \`npx wrangler pages secret put OPENAI_API_KEY\`. Set it as a build variable too: the build embeds the pages with it.`)}
import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit, turnstile } from 'ondocs/server';

${envType(true)}

let handler: ((request: Request) => Promise<Response>) | undefined;

function create(request: Request, env: Env) {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
${assetHelper(site, '  ')}  return createAskHandler({
    index: ${assetsIndex(site, '    ')}
${indexesOption(site, '    ', (locale) => `asset(${quote(localePath(site, locale))})`)}${askOptions(site, 'cloudflare', '    ', 'openai', 'env.TURNSTILE_SECRET_KEY')}
  });
}

export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  handler ??= create(request, env);
  return handler(request);
};
`,
    },
  ];
  if (mcp) {
    files.push({
      path: 'functions/api/mcp.ts',
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Cloudflare Pages Function.', `It serves ${site.indexPath} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own.`)}
import { createMcpHandler, memoryRateLimit } from 'ondocs/server';

${envType(false)}

let handler: ((request: Request) => Promise<Response>) | undefined;

export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  handler ??= createMcpHandler({
    index: ${assetsIndex(site, '    ')}
${mcpOptions(site, 'cloudflare', '    ')}
  });
  return handler(request);
};
`,
    });
  }
  return files;
}

/** The Worker module for a Cloudflare Worker with static assets: the endpoints, then the files. */
export const WORKER_MODULE = 'worker/ondocs.ts';

export function cloudflareWorkerFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  return [
    {
      path: WORKER_MODULE,
      description: `the Worker: POST /api/ask${mcp ? ' and /api/mcp' : ''}; other requests get the static files`,
      content: `${HEADER("The Worker's entry point: the ask endpoint and the MCP endpoint, then the site's files.", `It answers from ${site.indexPath}, which the build writes into the static assets, read through the ASSETS binding. Set OPENAI_API_KEY with \`npx wrangler secret put OPENAI_API_KEY\`, and in the build's environment: the build embeds the pages with it.`, `A Worker that has its own entry point already can call \`ondocs(request, env)\` from it: it answers the endpoints' paths and returns null for every other request.`)}
import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, ${mcp ? 'createMcpHandler, ' : ''}memoryRateLimit, turnstile } from 'ondocs/server';

interface Env {
  OPENAI_API_KEY: string;
  /** A Turnstile widget's secret key, for a bot check on each question. */
  TURNSTILE_SECRET_KEY?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

type Handler = (request: Request) => Promise<Response>;
let handlers: { ask: Handler${mcp ? '; mcp: Handler' : ''} } | undefined;

function create(request: Request, env: Env) {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  // One copy of the index for both endpoints, loaded on the first request.
  let text: Promise<string> | undefined;
  const index = () =>
    (text ??= (async () => {
      const response = await env.ASSETS.fetch(new Request(new URL(${quote(site.indexPath)}, request.url)));
      if (!response.ok) throw new Error(\`${site.indexPath}: HTTP \${String(response.status)}\`);
      return response.text();
    })().catch((error: unknown) => {
      text = undefined;
      throw error;
    }));
${assetHelper(site, '  ')}  return {
    ask: createAskHandler({
      index,
${indexesOption(site, '      ', (locale) => `asset(${quote(localePath(site, locale))})`)}${askOptions(site, 'cloudflare', '      ', 'openai', 'env.TURNSTILE_SECRET_KEY')}
    }),${
      mcp
        ? `
    mcp: createMcpHandler({
      index,
${mcpOptions(site, 'cloudflare', '      ')}
    }),`
        : ''
    }
  };
}

/** Answers the endpoints' paths, or returns null for any other request. */
export function ondocs(request: Request, env: Env): Promise<Response> | null {
  const { pathname } = new URL(request.url);
  if (pathname !== '/api/ask'${mcp ? " && pathname !== '/api/mcp'" : ''}) return null;
  handlers ??= create(request, env);
  return ${mcp ? "pathname === '/api/ask' ? handlers.ask(request) : handlers.mcp(request)" : 'handlers.ask(request)'};
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return ondocs(request, env) ?? env.ASSETS.fetch(request);
  },
};
`,
    },
  ];
}

/** The folder of the Worker that answers for a site on GitHub Pages or another static host. */
export const STANDALONE_DIR = 'ondocs-worker';

/** A Worker name from the site's: lowercase letters, digits and dashes, at most 63 characters. */
export function workerName(name: string): string {
  const slug = name
    .normalize('NFKD')
    // The accents NFKD splits off.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .replace(/-+$/, '');
  return `${slug || 'docs'}-ask`;
}

/** The models a standalone Worker answers with: Workers AI's, with no key, or OpenAI's. */
export type WorkerProvider = 'workers-ai' | 'openai';

/** The Workers AI model the template answers with, and the embedding model it suggests. */
export const WORKERS_AI_CHAT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const WORKERS_AI_EMBEDDING = '@cf/baai/bge-small-en-v1.5';

export interface WorkerVersions {
  ondocs: string;
  ai: string;
  openai: string;
  workersAi: string;
  wrangler: string;
  typescript: string;
  workersTypes: string;
}

/**
 * A Cloudflare Worker of its own, for a site served by GitHub Pages or any other static host: it
 * fetches the index from the live site, follows its deploys, and answers the site's pages across
 * origins (CORS for the site's origin only). With `workers-ai`, Workers AI embeds the questions
 * and writes the answers, so there is no API key; `templates/cloudflare-worker` is this Worker.
 */
export function standaloneWorkerFiles(
  site: TemplateSite & { url: string },
  mcp: boolean,
  versions: WorkerVersions,
  provider: WorkerProvider = 'workers-ai',
): GeneratedFile[] {
  const dir = STANDALONE_DIR;
  const indexUrl = new URL(site.indexPath.replace(/^\/+/, ''), `${site.url.replace(/\/+$/, '')}/`);
  const workersAi = provider === 'workers-ai';
  const name = workerName(site.name);
  return [
    {
      path: `${dir}/package.json`,
      description: 'the Worker’s dependencies and scripts',
      content: `${JSON.stringify(
        {
          name,
          private: true,
          type: 'module',
          scripts: { dev: 'wrangler dev', deploy: 'wrangler deploy', typecheck: 'tsc' },
          dependencies: {
            ...(workersAi ? {} : { '@ai-sdk/openai': versions.openai }),
            ai: versions.ai,
            ondocs: versions.ondocs,
            ...(workersAi ? { 'workers-ai-provider': versions.workersAi } : {}),
          },
          devDependencies: {
            '@cloudflare/workers-types': versions.workersTypes,
            typescript: versions.typescript,
            wrangler: versions.wrangler,
          },
          // npm 12 runs no install scripts unless allowed. Wrangler's esbuild and workerd set up
          // their binaries in one; fsevents (macOS file watching) has a prebuilt fallback.
          allowScripts: { esbuild: true, workerd: true, fsevents: false },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${dir}/tsconfig.json`,
      description: 'TypeScript for the Worker, with the Workers runtime types',
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            moduleResolution: 'Bundler',
            lib: ['ES2022'],
            types: ['@cloudflare/workers-types'],
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ['src'],
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${dir}/wrangler.jsonc`,
      description: 'the Worker’s configuration, with the site’s URL',
      content: `// The Worker that answers questions for ${site.name}. Written by \`npx ondocs init\`.
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(name)},
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",${
    workersAi
      ? `
  // Workers AI embeds the questions and writes the answers: no API key to set.
  "ai": { "binding": "AI" },`
      : ''
  }
  "vars": {
    // The site the Worker answers for: it reads the index at ${indexUrl.href}.
    "SITE_URL": ${JSON.stringify(site.url.replace(/\/+$/, ''))}${
      workersAi
        ? `,
    // The Workers AI model that writes the answers. About 100 questions a day fit in Workers AI's
    // free allowance with this one; the ondocs Workers AI guide compares others.
    "CHAT_MODEL": ${JSON.stringify(WORKERS_AI_CHAT_MODEL)}`
        : ''
    }
  }
}
`,
    },
    {
      path: `${dir}/src/index.ts`,
      description: `the Worker: POST /api/ask${mcp ? ' and /api/mcp' : ''}, from the live site’s index`,
      content: workersAi ? workersAiWorker(site, mcp) : openaiWorker(site, mcp),
    },
  ];
}

const CORS = `      // The site's pages post here from their own origin.
      headers: cors,`;

/** What both Workers share: the CORS headers, and `fetch`, which answers the two paths. */
function workerFetch(mcp: boolean): string {
  return `export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api/ask'${mcp ? " && pathname !== '/api/mcp'" : ''}) {
      return new Response('Not found', { status: 404 });
    }
    handlers ??= create(env).catch((error: unknown) => {
      handlers = undefined;
      throw error;
    });
    let ready: Awaited<typeof handlers>;
    try {
      ready = await handlers;
    } catch (error) {
      // The index could not be fetched or used; the next request tries again.
      console.error('[ondocs]', error);
      return Response.json(
        { error: { code: 'internal_error', message: 'The ask endpoint is misconfigured.' } },
        { status: 500, headers: corsFor(env) },
      );
    }
    return ${mcp ? "pathname === '/api/ask' ? ready.ask(request) : ready.mcp(request)" : 'ready.ask(request)'};
  },
};
`;
}

const SITE_AND_CORS = `/** The site's URL, with a trailing slash, as a base for its files' URLs. */
const siteOf = (env: Env): URL => {
  let end = env.SITE_URL.length;
  while (env.SITE_URL[end - 1] === '/') end -= 1;
  return new URL(\`\${env.SITE_URL.slice(0, end)}/\`);
};

/** CORS for the site's origin, and only for it. The dialog reads Retry-After on a 429. */
const corsFor = (env: Env): Record<string, string> => ({
  'access-control-allow-origin': siteOf(env).origin,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'retry-after',
  'access-control-max-age': '86400',
  vary: 'origin',
});`;

function mcpEntry(site: TemplateSite, mcp: boolean): string {
  return mcp
    ? `
    mcp: createMcpHandler({
      index,
${mcpOptions(site, 'github-pages', '      ')}
      // Results link to the pages on the site, not on this Worker.
      siteUrl: siteOf(env).origin,
    }),`
    : '';
}

function workersAiWorker(site: TemplateSite & { url: string }, mcp: boolean): string {
  return `${HEADER(
    `The Worker that answers questions for ${site.name}, with Workers AI: no API key to set, and within Workers AI's free daily allowance for a small site.`,
    `It fetches the index from the live site, SITE_URL${site.indexPath}, and checks it again every five minutes, so it follows the site's deploys. The site's pages call it across origins, so it sends CORS headers for SITE_URL's origin, and only for it.`,
    `Questions are embedded with the Workers AI model the index records, as with \`ondocs index -e workers-ai:${WORKERS_AI_EMBEDDING}\`, and matched on keywords for an index built without one. CHAT_MODEL, in wrangler.jsonc, writes the answers.`,
    'Deploy with `npx wrangler deploy`.',
  )}
import {
  createAskHandler,${mcp ? '\n  createMcpHandler,' : ''}
  memoryRateLimit,
  remoteIndex,
  turnstile,
} from 'ondocs/server';
import { createWorkersAI } from 'workers-ai-provider';

interface Env {
  /** The site's URL, with its base path. */
  SITE_URL: string;
  /** The Workers AI model that writes the answers. */
  CHAT_MODEL: string;
  AI: Ai;
  /** A Turnstile widget's secret key, for a bot check on each question. */
  TURNSTILE_SECRET_KEY?: string;
}

type Handler = (request: Request) => Promise<Response>;
let handlers: Promise<{ ask: Handler${mcp ? '; mcp: Handler' : ''} }> | undefined;

${SITE_AND_CORS}

/** The endpoints, made on the first request, once the index has been fetched. */
async function create(env: Env) {
  const index = remoteIndex(new URL(${quote(site.indexPath.replace(/^\/+/, ''))}, siteOf(env)));
  const workersai = createWorkersAI({ binding: env.AI });
  // Questions are embedded as the index was: with its Workers AI model. An index embedded with
  // another provider's model is searched by keywords instead.
  const { embedding } = await index();
  const embeddingModel = embedding?.model.startsWith('@cf/')
    ? workersai.textEmbedding(embedding.model)
    : undefined;
  if (embedding && !embeddingModel) {
    console.warn(
      \`[ondocs] The index was embedded with \${embedding.model}, which Workers AI does not run, so questions are matched on keywords. Build it with -e workers-ai:${WORKERS_AI_EMBEDDING}, or -e none.\`,
    );
  }
  const cors = corsFor(env);
  return {
    ask: createAskHandler({
      index,
${indexesOption(site, '      ', (locale) => `remoteIndex(new URL(${quote(localePath(site, locale).replace(/^\/+/, ''))}, siteOf(env)))`)}      model: workersai(env.CHAT_MODEL),
      ...(embeddingModel ? { embeddingModel } : {}),
      siteName: ${quote(site.name)},
      ${limiterComment('github-pages', '10 questions a minute')}
      rateLimit: ${limiter('github-pages', 10)},
${comment("A daily cap, counted per instance: about Workers AI's free allowance of 10,000 neurons with Llama 4 Scout, at some 3,000 tokens a question. On the Workers Free plan nothing is charged past the allowance; on Workers Paid, raise these to what you will spend.", '      ')}
      budget: { requestsPerDay: 100, tokensPerDay: 300_000 },
      // A question asked again is answered from memory, without a model call.
      answerCache: true,
${challengeOption('env.TURNSTILE_SECRET_KEY', '      ')}
${CORS}
    }),${mcpEntry(site, mcp)}
  };
}

${workerFetch(mcp)}`;
}

function openaiWorker(site: TemplateSite & { url: string }, mcp: boolean): string {
  return `${HEADER(
    `The Worker that answers questions for ${site.name}, with OpenAI.`,
    `It fetches the index from the live site, SITE_URL${site.indexPath}, and checks it again every five minutes, so it follows the site's deploys. The site's pages call it across origins, so it sends CORS headers for SITE_URL's origin, and only for it.`,
    'Questions are embedded with the OpenAI model the index records, and matched on keywords for an index built without one.',
    'Set the key with `npx wrangler secret put OPENAI_API_KEY`, and deploy with `npx wrangler deploy`.',
  )}
import { createOpenAI } from '@ai-sdk/openai';
import {
  createAskHandler,${mcp ? '\n  createMcpHandler,' : ''}
  memoryRateLimit,
  remoteIndex,
  turnstile,
} from 'ondocs/server';

interface Env {
  /** The site's URL, with its base path. */
  SITE_URL: string;
  OPENAI_API_KEY: string;
  /** A Turnstile widget's secret key, for a bot check on each question. */
  TURNSTILE_SECRET_KEY?: string;
}

type Handler = (request: Request) => Promise<Response>;
let handlers: Promise<{ ask: Handler${mcp ? '; mcp: Handler' : ''} }> | undefined;

${SITE_AND_CORS}

/** The endpoints, made on the first request, once the index has been fetched. */
async function create(env: Env) {
  const index = remoteIndex(new URL(${quote(site.indexPath.replace(/^\/+/, ''))}, siteOf(env)));
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  // Questions are embedded as the index was: with its OpenAI model. An index embedded with
  // another provider's model is searched by keywords instead.
  const { embedding } = await index();
  const model = embedding?.model.replace(/^openai\\//, '');
  const embeddingModel =
    model?.startsWith('text-embedding-') ? openai.embedding(model) : undefined;
  if (embedding && !embeddingModel) {
    console.warn(
      \`[ondocs] The index was embedded with \${embedding.model}, which this Worker does not run, so questions are matched on keywords.\`,
    );
  }
  const cors = corsFor(env);
  return {
    ask: createAskHandler({
      index,
${indexesOption(site, '      ', (locale) => `remoteIndex(new URL(${quote(localePath(site, locale).replace(/^\/+/, ''))}, siteOf(env)))`)}      model: openai('${MODEL}'),
      ...(embeddingModel ? { embeddingModel } : {}),
      siteName: ${quote(site.name)},
      ${limiterComment('github-pages', '10 questions a minute')}
      rateLimit: ${limiter('github-pages', 10)},
      // A daily cap for the endpoint, counted per instance: about 500 answers. Set a spend limit
      // with OpenAI as well; it is the only hard cap.
      budget: { requestsPerDay: 500, tokensPerDay: 1_500_000 },
      // A question asked again is answered from memory, without a model call.
      answerCache: true,
${challengeOption('env.TURNSTILE_SECRET_KEY', '      ')}
${CORS}
    }),${mcpEntry(site, mcp)}
  };
}

${workerFetch(mcp)}`;
}

/** `app/api/ask/route.ts` and `app/api/mcp/route.ts`, for a Next.js app. */
export function nextFiles(
  site: TemplateSite,
  host: Host,
  appDir: string,
  mcp: boolean,
): GeneratedFile[] {
  const depth = appDir.split('/').length + 2;
  const importPath = `${'../'.repeat(depth)}${site.indexFile}`;
  const files: GeneratedFile[] = [
    {
      path: `${appDir}/api/ask/route.ts`,
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Next.js route handler.', `It answers from ${site.indexFile}, which \`ondocs index\` writes before the build, imported so it is bundled with the route. Set OPENAI_API_KEY where the app builds and runs.`)}
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit, turnstile } from 'ondocs/server';

import index from '${importPath}';

const handler = createAskHandler({
  index,
${askOptions(site, host, '  ')}
});

export { handler as OPTIONS, handler as POST };
`,
    },
  ];
  if (mcp) {
    files.push({
      path: `${appDir}/api/mcp/route.ts`,
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Next.js route handler.', `It serves ${site.indexFile} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own. Importing the same file as the ask route keeps one copy of the index in memory.`)}
import { createMcpHandler, memoryRateLimit } from 'ondocs/server';

import index from '${importPath}';

const handler = createMcpHandler({
  index,
${mcpOptions(site, host, '  ')}
});

export { handler as DELETE, handler as GET, handler as OPTIONS, handler as POST };
`,
    });
  }
  return files;
}
