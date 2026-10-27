// `ondocs init`: writes the ask endpoint, and the MCP endpoint, for a docs site and the host
// it deploys to. Node.js only. It reads the site's config files to tell the framework and the host
// apart, never an .env file or a credential, and it deploys nothing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { version } from '../../package.json' with { type: 'json' };
import { REMOVED_IN } from '../deprecation';
import {
  cloudflarePagesFiles,
  cloudflareWorkerFiles,
  netlifyConfig,
  netlifyFiles,
  nextFiles,
  STANDALONE_DIR,
  standaloneWorkerFiles,
  vercelConfig,
  vercelFiles,
  WORKER_MODULE,
  WORKERS_AI_EMBEDDING,
  workerName,
  type WorkerProvider,
  type WorkerVersions,
  type CloudflareMode,
  type GeneratedFile,
  type Host,
  type TemplateSite,
} from './init-templates';
import type { CliIO } from './main';

export const INIT_USAGE = `Usage: ondocs init [options]

Writes the ask endpoint (POST /api/ask) and the MCP endpoint (/api/mcp) for your docs site and
the host it deploys to, with a rate limit, a daily budget, CORS where the endpoint is on another
origin, and the index bundled the way the host needs. It detects the site (Docusaurus, Starlight,
Astro, Next.js or a static site) and the host (Vercel, Netlify, Cloudflare or GitHub Pages), and
prints what it wrote and the environment variables to set. It never deploys anything and never
reads secrets. Run it again any time: unchanged files stay as they are, and it asks before it
overwrites a file that differs.

Options:
      --host <name>        vercel | netlify | cloudflare | github-pages (default: detected, else
                           asked). github-pages also suits any other static host: the endpoint is
                           a Cloudflare Worker of its own.
      --provider <name>    For github-pages: workers-ai (the default; no API key) or openai
      --site-url <url>     The site's public URL with its base path, for github-pages
                           (default: from the site's config)
      --site-name <text>   The site's name, for the model's instructions (default: its title)
      --build-dir <dir>    A static site's build output folder (default: detected)
      --out <dir>          --build-dir's name before 0.14, which works until 1.0
      --no-mcp             Write the ask endpoint only
      --dry-run            Print what it would write, and write nothing
  -y, --yes                Overwrite files that differ without asking
  -h, --help               Show this help`;

class InitError extends Error {}

const HOSTS: readonly Host[] = ['vercel', 'netlify', 'cloudflare', 'github-pages'];
const HOST_LABELS: Record<Host, string> = {
  vercel: 'Vercel',
  netlify: 'Netlify',
  cloudflare: 'Cloudflare',
  'github-pages': 'GitHub Pages',
};

type SiteKind = 'docusaurus' | 'starlight' | 'astro' | 'vitepress' | 'next' | 'static';

/** What init found out about the site. */
interface Site extends TemplateSite {
  kind: SiteKind;
  /** The framework or generator, for messages: "Docusaurus", "Hugo". */
  label: string;
  /** Astro's SSR adapter package, when the site has one. */
  adapter?: string;
  /** VitePress's config file: `.vitepress/config.mts` or `docs/.vitepress/config.mts`. */
  config?: string;
  /** Next.js's app folder: `app` or `src/app`. */
  appDir?: string;
  /** For a site the CLI indexes (Next.js, static generators): the command that builds the index. */
  indexCommand?: string;
  /** The config file that adds ondocs's plugin, when it already does: `docusaurus.config.ts`. */
  plugin?: string;
  /** Whether that config gives the plugin an `mcp` option already. */
  pluginMcp?: boolean;
  /**
   * Whether the config sets the site's URL, which the plugin resolves a path in `mcp` against: as
   * a literal or as an expression, such as `process.env.SITE_URL ?? 'https://…'`.
   */
  urlInConfig?: boolean;
  /** What init could not tell about the site's locales, to say before it writes. */
  warnings?: string[];
}

interface PackageJson {
  name?: unknown;
  homepage?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  /** npm's, Yarn's and Bun's workspaces: patterns, or `{ packages }`. */
  workspaces?: unknown;
  packageManager?: unknown;
}

/** The project: its root, its package.json and its dependencies. */
interface Project {
  root: string;
  pkg: PackageJson | null;
  deps: Set<string>;
  read: (path: string) => string | null;
  has: (path: string) => boolean;
}

function project(root: string): Project {
  const read = (path: string): string | null => {
    try {
      return readFileSync(join(root, path), 'utf8');
    } catch {
      return null;
    }
  };
  let pkg: PackageJson | null = null;
  try {
    const parsed: unknown = JSON.parse(read('package.json') ?? 'null');
    if (parsed && typeof parsed === 'object') pkg = parsed;
  } catch {
    // Not a Node project, or a broken package.json: detect from the other files.
  }
  const deps = new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
  return { root, pkg, deps, read, has: (path) => existsSync(join(root, path)) };
}

/** The first of `names` that exists in the project. */
const first = (p: Project, names: readonly string[]): string | undefined =>
  names.find((name) => p.has(name));

const configNames = (base: string) =>
  ['ts', 'mts', 'js', 'mjs', 'cjs'].map((extension) => `${base}.${extension}`);

/** A string-valued key from a JS/TS config's source, such as `url: 'https://…'`. */
function configString(source: string | null, key: string): string | undefined {
  if (!source) return undefined;
  return new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]+)\\1`).exec(source)?.[2];
}

/** A JS/TS config's source without its whole-line `//` comments, where a key can be commented out. */
const uncommented = (source: string | null): string =>
  (source ?? '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * Whether a JS/TS config's source sets one of `keys`, to a literal or to an expression, such as
 * `site: process.env.SITE_URL ?? 'https://…'`.
 */
const configSets = (source: string | null, keys: string[]): boolean =>
  new RegExp(`\\b(?:${keys.join('|')})\\s*:`).test(uncommented(source));

/** A key from a YAML or TOML config, such as `site_name: Acme Docs` or `baseURL = "…"`. */
function flatConfigString(source: string | null, key: string): string | undefined {
  if (!source) return undefined;
  const match = new RegExp(
    `^[ \\t]*${key}[ \\t]*[:=][ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^#\\n]*))`,
    'm',
  ).exec(source);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
  return value || undefined;
}

/**
 * Calls `visit` with each character of JS source from `from` that is outside a string or a
 * comment, and the depth of the brackets around it (a closing bracket has its opening one's),
 * until `visit` returns true. Returns that character's index, or -1.
 */
function scanCode(
  source: string,
  from: number,
  visit: (char: string, at: number, depth: number) => boolean,
): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (char === "'" || char === '"' || char === '`') {
      let end = i + 1;
      while (end < source.length && source.charAt(end) !== char) {
        end += source.charAt(end) === '\\' ? 2 : 1;
      }
      i = end;
    } else if (char === '/' && source.charAt(i + 1) === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (char === '/' && source.charAt(i + 1) === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
    } else {
      if (char === '}' || char === ']' || char === ')') depth -= 1;
      if (visit(char, i, depth)) return i;
      if (char === '{' || char === '[' || char === '(') depth += 1;
    }
  }
  return -1;
}

/**
 * The bracket depth at `at` in JS source, and the code character before it, past spaces and
 * comments; null when `at` is in a string or a comment.
 */
function codeAt(source: string, at: number): { depth: number; previous: string } | null {
  const found = { depth: -1, previous: '' };
  const stop = scanCode(source, 0, (char, i, depth) => {
    if (i >= at) {
      found.depth = depth;
      return true;
    }
    if (!/\s/.test(char)) found.previous = char;
    return false;
  });
  return stop === at ? found : null;
}

/**
 * The entries of the object or array literal whose bracket is at `open`, split at its own
 * commas, each without the comments before it.
 */
function literalEntries(source: string, open: number): string[] {
  const entries: string[] = [];
  let start = open + 1;
  const close = scanCode(source, open, (char, i, depth) => {
    if (i === open) return false;
    if (depth === 1 && char === ',') {
      entries.push(source.slice(start, i));
      start = i + 1;
    }
    return depth === 0;
  });
  if (close === -1) return [];
  entries.push(source.slice(start, close));
  return entries
    .map((entry) => entry.replace(/^(?:\s|\/\/[^\n]*|\/\*[^*]*(?:\*(?!\/)[^*]*)*\*\/)*/, ''))
    .filter(Boolean);
}

/** Reads a file next to the config, by a path relative to the config's folder. */
type ReadRelative = (path: string) => string | null;

/** A literal in a config: the source it is in, where its `{` or `[` is, and how to read imports. */
interface Literal {
  source: string;
  at: number;
  read: ReadRelative;
}

/** A value init does not follow, such as a call or a package's export. */
const UNREAD = 'unread';
type Value = Literal | typeof UNREAD;

const LOCALE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;

/**
 * The literal at `from` in JS source: written there, or the variable named there, declared in the
 * same file or imported from a relative one (`import x from './x.mjs'`, `require('./x')`).
 */
function valueAt(source: string, from: number, read: ReadRelative, hops: number): Value {
  const rest = source.slice(from).replace(/^\s+/, '');
  const at = source.length - rest.length;
  if (rest.startsWith('{') || rest.startsWith('[')) return { source, at, read };
  const required = /^require\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/.exec(rest);
  if (required) return exported(required[2] ?? '', 'default', read, hops);
  const name = /^([A-Za-z_$][\w$]*)\s*(?:[,;})\]]|$)/.exec(rest)?.[1];
  return name ? declared(source, name, read, hops) : UNREAD;
}

/** The first match of `pattern` in JS source that is code, not a string or a comment. */
function codeMatch(source: string, pattern: RegExp): RegExpExecArray | undefined {
  for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
    if (codeAt(source, match.index)) return match;
  }
  return undefined;
}

const escapeName = (name: string): string => name.replace(/\$/g, '\\$');

/** The literal the variable `name` holds in JS source: declared there, or imported. */
function declared(source: string, name: string, read: ReadRelative, hops: number): Value {
  if (hops > 3) return UNREAD;
  const id = escapeName(name);
  const declaration = codeMatch(
    source,
    new RegExp(`(?<![\\w$.])(?:const|let|var)\\s+${id}\\s*(?::[^=]*)?=(?!=)\\s*`),
  );
  if (declaration) {
    return valueAt(source, declaration.index + declaration[0].length, read, hops + 1);
  }
  const imported = codeMatch(
    source,
    new RegExp(`\\bimport\\s+${id}\\s+from\\s*(['"])(\\.{1,2}\\/[^'"]+)\\1`),
  );
  if (imported) return exported(imported[2] ?? '', 'default', read, hops + 1);
  for (const match of source.matchAll(
    /\bimport\s*\{([^}]*)\}\s*from\s*(['"])(\.{1,2}\/[^'"]+)\2/g,
  )) {
    for (const specifier of (match[1] ?? '').split(',')) {
      const [original, alias] = specifier.trim().split(/\s+as\s+/);
      if (original && (alias ?? original) === name) {
        return exported(match[3] ?? '', original, read, hops + 1);
      }
    }
  }
  return UNREAD;
}

/** The literal a relative file exports as `name` (or as its default export). */
function exported(path: string, name: string, read: ReadRelative, hops: number): Value {
  if (hops > 3) return UNREAD;
  const extensions = ['', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json'];
  const candidates = [
    ...extensions.map((extension) => `${path}${extension}`),
    ...extensions.slice(1).map((extension) => `${path}/index${extension}`),
  ];
  for (const file of candidates) {
    const source = read(file);
    if (source === null) continue;
    const near: ReadRelative = (relativePath) =>
      read(posix.join(posix.dirname(file), relativePath));
    if (file.endsWith('.json')) {
      const at = source.search(/[{[]/);
      return at === -1 ? UNREAD : { source, at, read: near };
    }
    const id = escapeName(name);
    const start =
      name === 'default'
        ? codeMatch(source, /\bexport\s+default\s+|\bmodule\.exports\s*=\s*/)
        : codeMatch(
            source,
            new RegExp(
              `\\bexport\\s+(?:const|let|var)\\s+${id}\\s*(?::[^=]*)?=\\s*|\\b(?:module\\.)?exports\\.${id}\\s*=\\s*`,
            ),
          );
    if (start) return valueAt(source, start.index + start[0].length, near, hops + 1);
    // `export { name }`, declared further up.
    return name === 'default' ? UNREAD : declared(source, name, near, hops + 1);
  }
  return UNREAD;
}

/**
 * The value `key` is set to in JS source, at the shallowest depth it is set at: `key: …` or the
 * shorthand `{ key }`, followed to its literal. `null` when `key` is not set.
 */
function propertyValue(source: string, key: string, read: ReadRelative): Value | null {
  let best: { depth: number; value: Value } | null = null;
  const pattern = new RegExp(
    `(?<![\\w$.]|(?:const|let|var)\\s+)${key}(?:\\s*:(?!:)\\s*|(?=\\s*[,}]))`,
    'g',
  );
  for (const match of source.matchAll(pattern)) {
    const code = codeAt(source, match.index);
    if (!code || (best && code.depth >= best.depth)) continue;
    const shorthand = !match[0].includes(':');
    // `{ key }` is an object's shorthand, but not an import's, an export's or a destructuring.
    if (
      shorthand &&
      ((code.previous !== '{' && code.previous !== ',') ||
        /\b(?:import|export|const|let|var)\s+(?:type\s+)?\{[^{}]*$/.test(
          source.slice(0, match.index),
        ))
    ) {
      continue;
    }
    best = {
      depth: code.depth,
      value: shorthand
        ? declared(source, key, read, 0)
        : valueAt(source, match.index + match[0].length, read, 0),
    };
  }
  return best?.value ?? null;
}

/** The text of the literal at `literal.at`, brackets included. */
const literalText = ({ source, at }: Literal): string => {
  const close = scanCode(source, at, (_, i, depth) => i > at && depth === 0);
  return close === -1 ? source.slice(at) : source.slice(at, close + 1);
};

/** The string a `key: '…'` entry gives, if it is one. */
const entryString = (entry: string, key: string): string | undefined =>
  new RegExp(`^${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`).exec(entry)?.[2];

/**
 * The locales of a site other than its default, from its config, and whether the config sets them
 * in a way init does not read (a call, or a package's export). Docusaurus's and Astro's
 * `i18n: { defaultLocale, locales: [...] }`, with Astro's `{ path, codes }` entries by their path,
 * or Starlight's and VitePress's `locales: { root, fr, ... }` (every key but `root`, and not a
 * VitePress locale that only links to another site). A variable is followed to its declaration, in
 * the same file or one it imports with a relative path, which `read` reads.
 */
function readLocales(
  source: string | null,
  starlight: boolean,
  read: ReadRelative,
): { locales: string[]; unread: boolean } {
  const none = { locales: [], unread: false };
  if (!source) return none;
  if (starlight) {
    const value = propertyValue(source, 'locales', read);
    if (value === null) return none;
    if (value === UNREAD || value.source.charAt(value.at) !== '{') {
      return { locales: [], unread: value === UNREAD };
    }
    const keys = literalEntries(value.source, value.at).flatMap((entry) => {
      const match = /^(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:\s*/.exec(entry);
      const key = match?.[2] ?? match?.[3];
      if (!match || !key || key === 'root' || !LOCALE.test(key)) return [];
      // A VitePress locale with a `link` of its own is another site's: it has no pages here.
      const own = entry.slice(match[0].length);
      const links =
        own.startsWith('{') &&
        literalEntries(own, 0).some((field) =>
          /^(?:https?:)?\/\//.test(entryString(field, 'link') ?? ''),
        );
      return links ? [] : [key];
    });
    return { locales: [...new Set(keys)], unread: false };
  }
  // Docusaurus's and Astro's `i18n`, or, without one, the config's own `locales`.
  const i18n = propertyValue(source, 'i18n', read);
  if (i18n === UNREAD) return { locales: [], unread: true };
  const scope =
    i18n?.source.charAt(i18n.at) === '{'
      ? { source: literalText(i18n), read: i18n.read }
      : { source, read };
  const list = propertyValue(scope.source, 'locales', scope.read);
  if (list === null) return none;
  if (list === UNREAD || list.source.charAt(list.at) !== '[') {
    return { locales: [], unread: list === UNREAD };
  }
  const defaultLocale = configString(scope.source, 'defaultLocale');
  const locales = literalEntries(list.source, list.at).flatMap((entry) => {
    const quoted = /^(['"`])([^'"`]+)\1/.exec(entry)?.[2];
    if (quoted) return [{ path: quoted, codes: [quoted] }];
    if (!entry.startsWith('{')) return [];
    // Astro's `{ path: 'pt', codes: ['pt-BR', 'pt'] }`, served under its path.
    const fields = literalEntries(entry, 0);
    const path = fields.map((field) => entryString(field, 'path')).find(Boolean);
    const codes = fields.find((field) => /^codes\s*:\s*\[/.test(field)) ?? '';
    return path
      ? [{ path, codes: [...codes.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1] ?? '') }]
      : [];
  });
  const others = locales
    .filter(({ path, codes }) => path !== defaultLocale && !codes.includes(defaultLocale ?? ''))
    .map(({ path }) => path)
    .filter((path) => LOCALE.test(path));
  return { locales: [...new Set(others)], unread: false };
}

/**
 * The locales of a site other than its default, from its config: Docusaurus's and Astro's
 * `i18n: { defaultLocale, locales: [...] }`, or Starlight's and VitePress's `locales: { root, fr,
 * ... }` (every key but `root`). Read from the source, following a variable to the same file or a
 * relative import that `read` reads, so a config that builds them in code is not seen.
 */
export function configLocales(
  source: string | null,
  starlight: boolean,
  read: ReadRelative = () => null,
): string[] {
  return readLocales(source, starlight, read).locales;
}

/**
 * A URL and a base path joined: `https://acme.github.io` and `/docs/` give
 * `https://acme.github.io/docs`. A URL whose path already ends with the base keeps it once, as
 * VitePress's `sitemap.hostname` has it on a project site: `https://acme.github.io/docs/` and
 * `/docs/` give the same.
 */
function joinUrl(url: string | undefined, base: string | undefined): string | undefined {
  if (!url || !/^https?:\/\//.test(url)) return undefined;
  const path = (base ?? '').replace(/^\/+|\/+$/g, '');
  const site = url.replace(/\/+$/, '');
  if (!path || site.replace(/^https?:\/\/[^/]*/, '').endsWith(`/${path}`)) return site;
  return `${site}/${path}`;
}

const STATIC_GENERATORS: { label: string; files: string[]; out: string }[] = [
  { label: 'Hugo', files: ['hugo.toml', 'hugo.yaml', 'hugo.json'], out: 'public' },
  { label: 'MkDocs', files: ['mkdocs.yml', 'mkdocs.yaml'], out: 'site' },
  { label: 'Jekyll', files: ['_config.yml', '_config.yaml'], out: '_site' },
  {
    label: 'Eleventy',
    files: [...configNames('eleventy.config'), '.eleventy.js', '.eleventy.cjs'],
    out: '_site',
  },
];

/** Detects the site's framework, where its build writes the index, its name and its URL. */
function detectSite(
  p: Project,
  flags: { buildDir?: string; name?: string; siteUrl?: string },
): Site {
  const packageName = typeof p.pkg?.name === 'string' ? p.pkg.name : undefined;
  const homepage = typeof p.pkg?.homepage === 'string' ? p.pkg.homepage : undefined;
  const named = (title: string | undefined) => flags.name ?? title ?? packageName ?? 'the docs';
  const url = (found: string | undefined) => flags.siteUrl ?? found ?? joinUrl(homepage, '');

  const docusaurus = first(p, configNames('docusaurus.config'));
  if (docusaurus || p.deps.has('@docusaurus/core')) {
    const source = docusaurus ? p.read(docusaurus) : null;
    return withUrl(
      {
        kind: 'docusaurus',
        label: 'Docusaurus',
        name: named(configString(source, 'title')),
        indexFile: 'build/ask-index.json',
        indexPath: '/ask-index.json',
        // Docusaurus needs `url`.
        urlInConfig: true,
        ...siteLocales(p, docusaurus, source, false, 'build/ask-index.json'),
        ...pluginIn(
          docusaurus,
          source,
          /['"`](?:ondocs\/docusaurus|docusaurus-plugin-ondocs)['"`]/,
        ),
      },
      url(joinUrl(configString(source, 'url'), configString(source, 'baseUrl'))),
    );
  }

  const astro = first(p, configNames('astro.config'));
  if (astro || p.deps.has('astro')) {
    const source = astro ? p.read(astro) : null;
    const starlight = p.deps.has('@astrojs/starlight') || !!source?.includes('@astrojs/starlight');
    const adapter =
      [...p.deps].find((dep) =>
        /^@astrojs\/(?:node|vercel|netlify|cloudflare)$|^astro-.*adapter|adapter-/.test(dep),
      ) ?? (/\badapter\s*:/.test(source ?? '') ? 'an adapter' : undefined);
    const outDir = adapter ? 'dist/client' : 'dist';
    return withUrl(
      {
        kind: starlight ? 'starlight' : 'astro',
        label: starlight ? 'Starlight' : 'Astro',
        name: named(configString(source, 'title')),
        indexFile: `${outDir}/ask-index.json`,
        indexPath: '/ask-index.json',
        ...(adapter ? { adapter } : {}),
        ...(configSets(source, ['site']) ? { urlInConfig: true } : {}),
        ...siteLocales(p, astro, source, starlight, `${outDir}/ask-index.json`),
        ...pluginIn(
          astro,
          source,
          starlight
            ? /['"`](?:ondocs\/starlight|starlight-ondocs)['"`]/
            : /['"`]ondocs\/astro['"`]/,
        ),
      },
      url(joinUrl(configString(source, 'site'), configString(source, 'base'))),
    );
  }

  if (first(p, configNames('next.config')) || p.deps.has('next')) {
    const appDir = p.has('src/app') ? 'src/app' : 'app';
    const content = first(p, ['content/docs', 'content', 'docs']) ?? 'content';
    return withUrl(
      {
        kind: 'next',
        label: 'Next.js',
        name: named(undefined),
        indexFile: 'ask-index.json',
        indexPath: '/ask-index.json',
        appDir,
        indexCommand: `npx ondocs index ${content} --base-url /docs`,
      },
      url(undefined),
    );
  }

  // VitePress, in docs/ as `vitepress init` suggests, or at the root: the plugin builds the index.
  const vitepress = first(p, ['docs/.vitepress', '.vitepress']);
  if (vitepress) {
    const config = first(
      p,
      ['mts', 'ts', 'mjs', 'js'].map((extension) => `${vitepress}/config.${extension}`),
    );
    const source = config ? p.read(config) : null;
    return withUrl(
      {
        kind: 'vitepress',
        label: 'VitePress',
        name: named(configString(source, 'title')),
        indexFile: `${vitepress}/dist/ask-index.json`,
        indexPath: '/ask-index.json',
        config: config ?? `${vitepress}/config.mts`,
        // `sitemap.hostname`, or withOndocs's own `siteUrl`.
        ...(configSets(source, ['hostname', 'siteUrl']) ? { urlInConfig: true } : {}),
        ...siteLocales(p, config, source, true, `${vitepress}/dist/ask-index.json`),
        ...pluginIn(config, source, /['"`]ondocs\/vitepress['"`]/),
      },
      url(joinUrl(configString(source, 'hostname'), configString(source, 'base'))),
    );
  }

  const generator = STATIC_GENERATORS.find(({ files }) => files.some((file) => p.has(file)));
  const out = (flags.buildDir ?? generator?.out)?.replace(/^\.\/|\/+$/g, '');
  if (!out) {
    const html = HTML_FOLDERS.find((dir) => hasHtml(p, dir));
    throw new InitError(
      'No Docusaurus, Astro, Next.js, VitePress, Hugo, MkDocs, Jekyll or Eleventy config here. ' +
        (html
          ? `${html}/ has HTML files: if it is the folder the site deploys, run npx ondocs init --build-dir ${html}.`
          : 'Run init in the site’s folder. For plain HTML, pass the folder of its HTML files with --build-dir <dir>, as in npx ondocs init --build-dir public.'),
    );
  }
  const source =
    first(p, generator && 'files' in generator ? generator.files : [])?.toString() ?? null;
  const config = source ? p.read(source) : null;
  const foundUrl =
    flatConfigString(config, 'site_url') ??
    flatConfigString(config, 'baseURL') ??
    joinUrl(flatConfigString(config, 'url'), flatConfigString(config, 'baseurl'));
  return withUrl(
    {
      kind: 'static',
      label: generator?.label ?? 'static',
      name: named(
        flatConfigString(config, 'site_name') ?? flatConfigString(config, 'title') ?? undefined,
      ),
      indexFile: `${out}/ask-index.json`,
      indexPath: '/ask-index.json',
      indexCommand: `npx ondocs index ${out} -o ${out}/ask-index.json`,
    },
    url(foundUrl?.replace(/\/+$/, '')),
  );
}

const withUrl = (site: Site, url: string | undefined): Site => (url ? { ...site, url } : site);

/**
 * `{ plugin: file }` when the config file's source names ondocs's plugin, as `pattern` finds it,
 * with `pluginMcp` when the source sets an `mcp` option too. The plugin's `mcp` is never `false`,
 * so `route: { mcp: false }`, and a commented-out line, are not one.
 */
const pluginIn = (
  file: string | undefined,
  source: string | null,
  pattern: RegExp,
): { plugin?: string; pluginMcp?: boolean } =>
  file && source && pattern.test(source)
    ? {
        plugin: file,
        ...(/\bmcp\s*:(?!\s*false\b)/.test(uncommented(source)) ? { pluginMcp: true } : {}),
      }
    : {};

/** Where a plain HTML site keeps its pages, in the order init looks. */
const HTML_FOLDERS = ['public', 'site', '_site', 'dist', 'build', 'out', 'www'];

/** Whether `dir` in the project holds an HTML file. */
function hasHtml(p: Project, dir: string): boolean {
  try {
    return readdirSync(join(p.root, dir)).some((file) => /\.html?$/i.test(file));
  } catch {
    return false;
  }
}

/**
 * Whether `url` is a template's placeholder rather than a site's address: on a domain kept for
 * examples (example.com, .org and .net, and the .example, .test, .invalid and .localhost
 * domains), localhost, or a host named like `your-docusaurus-site`.
 */
export function placeholderUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    /(?:^|\.)example\.(?:com|org|net)$/.test(host) ||
    /(?:^|\.)(?:example|test|invalid|localhost)$/.test(host) ||
    /^your[-.]/.test(host)
  );
}

/**
 * The locales the last build wrote an index for, next to the default one: `build/fr/ask-index.json`
 * beside `build/ask-index.json`. `null` before a build that wrote the default one.
 */
function builtLocales(p: Project, indexFile: string): string[] | null {
  if (!p.has(indexFile)) return null;
  const dir = posix.dirname(indexFile);
  const name = posix.basename(indexFile);
  try {
    return readdirSync(join(p.root, dir), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && LOCALE.test(entry.name) && p.has(`${dir}/${entry.name}/${name}`),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
}

/**
 * The site's other locales: the ones its config names, as init reads it, and the ones its last
 * build wrote an index for, with a warning for each the two disagree on, or when the config sets
 * them in code init does not read and there is no build to take them from.
 */
function siteLocales(
  p: Project,
  file: string | undefined,
  source: string | null,
  starlight: boolean,
  indexFile: string,
): { locales?: string[]; warnings?: string[] } {
  const config = file ?? 'the config';
  // A file the config imports, by its path from the config's folder. Never an .env file.
  const read: ReadRelative = (path) =>
    file && !/(?:^|\/)\.env/.test(path) ? p.read(posix.join(posix.dirname(file), path)) : null;
  const named = readLocales(source, starlight, read);
  const built = builtLocales(p, indexFile);
  const dir = `${posix.dirname(indexFile)}/`;
  const warnings: string[] = [];
  let locales = named.locales;
  if (!built) {
    if (named.unread) {
      warnings.push(
        `${config} sets its locales in code init does not read, so the endpoint gets no index for them, and they are answered from the default one. Build the site with the ondocs plugin, then run init again: it takes them from the indexes the build writes in ${dir}.`,
      );
    }
  } else {
    const extra = built.filter((locale) => !named.locales.includes(locale));
    const missing = named.locales.filter((locale) => !built.includes(locale));
    if (extra.length > 0) {
      warnings.push(
        `The last build wrote an index for ${extra.join(', ')} in ${dir}, which init did not find in ${config}: the endpoint gets ${extra.length === 1 ? 'it' : 'them'} too.`,
      );
    }
    if (missing.length > 0) {
      warnings.push(
        `${config} names ${missing.join(', ')}, but the last build wrote no ${missing.map((locale) => `${dir}${locale}/${posix.basename(indexFile)}`).join(' or ')}: build every locale before you deploy, as the endpoint reads ${missing.length === 1 ? 'that file' : 'those files'} for ${missing.length === 1 ? 'its' : 'their'} questions.`,
      );
    }
    locales = [...named.locales, ...extra];
  }
  return {
    ...(locales.length > 0 ? { locales } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** The wrangler config file, if any. */
const WRANGLER = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

/** Hosts the project's files point at, in the order they are checked. */
function detectHosts(p: Project, pages = true): Host[] {
  const hosts: Host[] = [];
  if (p.has('vercel.json') || p.has('.vercel')) hosts.push('vercel');
  if (p.has('netlify.toml') || p.has('.netlify')) hosts.push('netlify');
  if (first(p, WRANGLER)) hosts.push('cloudflare');
  if (pages && deploysToPages(p)) hosts.push('github-pages');
  return hosts;
}

/** A host the site deploys to, and the folder whose files name it. */
interface FoundHost {
  host: Host;
  at: Project;
}

/**
 * The hosts the site's folder points at, then those a folder above it does, up to its
 * workspace's or repository's root, where a monorepo keeps the netlify.toml or vercel.json of a
 * site in one of its packages. A GitHub Pages workflow above counts only when nothing else names
 * a host: a repository has its workflows at its root, whatever they deploy.
 */
function findHosts(p: Project, above: Project[]): FoundHost[] {
  const found: FoundHost[] = detectHosts(p).map((host) => ({ host, at: p }));
  for (const folder of above) {
    for (const host of detectHosts(folder, false)) {
      if (!found.some((other) => other.host === host)) found.push({ host, at: folder });
    }
  }
  const pages = found.length === 0 ? above.find(deploysToPages) : undefined;
  return pages ? [{ host: 'github-pages', at: pages }] : found;
}

/** A path from one folder to another, with forward slashes: `..`, `website/build`. */
const pathFrom = (from: string, to: string): string => relative(from, to).split(sep).join('/');

/**
 * The package patterns of a pnpm workspace (pnpm-workspace.yaml) or an npm, Yarn or Bun one
 * (package.json's `workspaces`), when `p` is a workspace's root, else null.
 */
function workspacePatterns(p: Project): string[] | null {
  const yaml = p.read('pnpm-workspace.yaml');
  if (yaml !== null) {
    const inline = /^packages\s*:\s*\[([^\]\n]*)\]/m.exec(yaml)?.[1];
    if (inline !== undefined) {
      return inline
        .split(',')
        .map((item) => item.trim().replace(/^(['"])(.*)\1$/, '$2'))
        .filter(Boolean);
    }
    // A block list under `packages:`, up to the next key.
    const lines = yaml.split('\n');
    const start = lines.findIndex((line) => /^packages\s*:/.test(line));
    const patterns: string[] = [];
    for (const line of start === -1 ? [] : lines.slice(start + 1)) {
      if (/^\s*(?:#.*)?$/.test(line)) continue;
      const item = /^\s+-\s*(['"]?)([^'"#\s]+)\1\s*(?:#.*)?$/.exec(line)?.[2];
      if (!item) break;
      patterns.push(item);
    }
    return patterns;
  }
  const workspaces = p.pkg?.workspaces;
  const list: unknown =
    workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)
      ? (workspaces as { packages?: unknown }).packages
      : workspaces;
  return Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string')
    : null;
}

/** A workspace pattern, such as `packages/*`, as a regular expression for a package's folder. */
const globPattern = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/^\.\//, '')
      .replace(/\/+$/, '')
      .split('/')
      .map((part) =>
        part === '**'
          ? '.*'
          : part
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '[^/]'),
      )
      .join('/')}$`,
  );

/** Whether the folder `dir`, from the workspace's root, is one of its packages. */
const inWorkspace = (dir: string, patterns: string[]): boolean =>
  patterns.some((pattern) => !pattern.startsWith('!') && globPattern(pattern).test(dir)) &&
  !patterns.some((pattern) => pattern.startsWith('!') && globPattern(pattern.slice(1)).test(dir));

/** Whether `p` is a workspace's or a repository's root, where init stops looking up. */
const isRoot = (p: Project): boolean => workspacePatterns(p) !== null || p.has('.git');

/**
 * The folders above the project, nearest first, up to its workspace's or repository's root. None
 * when the project is at such a root, or in neither.
 */
function foldersAbove(p: Project): Project[] {
  if (isRoot(p)) return [];
  const folders: Project[] = [];
  for (let dir = dirname(p.root); dir !== dirname(dir); dir = dirname(dir)) {
    const folder = project(dir);
    folders.push(folder);
    if (isRoot(folder)) return folders;
  }
  return [];
}

/** The folders of a workspace's packages, from its root, that `parts` of a pattern match. */
function expandPattern(root: string, dir: string, parts: string[], out: Set<string>): void {
  const [part, ...rest] = parts;
  if (part === undefined) {
    out.add(dir);
    return;
  }
  if (!part.includes('*')) {
    expandPattern(root, posix.join(dir, part), rest, out);
    return;
  }
  // Deep enough for `packages/**`, without walking a whole repository.
  if (dir.split('/').length > 4) return;
  let children: string[];
  try {
    children = readdirSync(join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('.'));
  } catch {
    return;
  }
  if (part === '**') expandPattern(root, dir, rest, out);
  const match = globPattern(part === '**' ? '*' : part);
  for (const child of children.filter((name) => match.test(name))) {
    expandPattern(root, posix.join(dir, child), part === '**' ? parts : rest, out);
  }
}

/** The framework of the site whose config file is in the folder, for messages, if there is one. */
function siteConfigLabel(p: Project): string | undefined {
  if (first(p, configNames('docusaurus.config'))) return 'Docusaurus';
  const astro = first(p, configNames('astro.config'));
  if (astro) {
    return p.deps.has('@astrojs/starlight') || !!p.read(astro)?.includes('@astrojs/starlight')
      ? 'Starlight'
      : 'Astro';
  }
  if (first(p, configNames('next.config'))) return 'Next.js';
  if (first(p, ['docs/.vitepress', '.vitepress'])) return 'VitePress';
  return STATIC_GENERATORS.find(({ files }) => files.some((file) => p.has(file)))?.label;
}

/** The workspace's packages that have a site's config, by their folder from its root. */
function workspaceSites(root: Project, patterns: string[]): { dir: string; label: string }[] {
  const dirs = new Set<string>();
  for (const pattern of patterns.filter((item) => !item.startsWith('!'))) {
    const parts = pattern.replace(/^\.\//, '').split('/').filter(Boolean);
    expandPattern(root.root, '', parts, dirs);
  }
  return [...dirs]
    .filter((dir) => dir && dir !== '.' && inWorkspace(dir, patterns))
    .sort()
    .flatMap((dir) => {
      const label = siteConfigLabel(project(join(root.root, dir)));
      return label ? [{ dir, label }] : [];
    });
}

/** The package manager, and where its install steps run. */
interface Installer {
  pm: 'pnpm' | 'yarn' | 'bun' | 'npm';
  /** Yarn 2 or later, where `yarn add` at the workspace's root needs no -W. */
  berry: boolean;
  /** The site's folder, where init runs. */
  cwd: string;
  /** The site's package name, when it is a package of a workspace. */
  member?: string;
  /** The workspace's root, when the site is in one. */
  workspaceRoot?: string;
}

/**
 * The package manager of the site, from a lockfile in its folder or one above it, up to its
 * workspace's root, else from a package.json's `packageManager`, else npm.
 */
function installer(p: Project, above: Project[]): Installer {
  const folders = [p, ...above];
  const declared = folders
    .map((folder) =>
      /^(pnpm|yarn|bun|npm)@(\d+)/.exec(
        typeof folder.pkg?.packageManager === 'string' ? folder.pkg.packageManager : '',
      ),
    )
    .find(Boolean);
  const lock = folders
    .map((folder) =>
      folder.has('pnpm-lock.yaml')
        ? 'pnpm'
        : folder.has('yarn.lock')
          ? 'yarn'
          : folder.has('bun.lock') || folder.has('bun.lockb')
            ? 'bun'
            : folder.has('package-lock.json')
              ? 'npm'
              : undefined,
    )
    .find(Boolean);
  const pm = lock ?? (declared?.[1] as Installer['pm'] | undefined) ?? 'npm';
  const berry =
    pm === 'yarn' &&
    (folders.some((folder) => folder.has('.yarnrc.yml')) ||
      (declared?.[1] === 'yarn' && Number(declared[2]) >= 2));
  const root = above.at(-1);
  const patterns = root ? workspacePatterns(root) : null;
  const name = typeof p.pkg?.name === 'string' ? p.pkg.name : undefined;
  return {
    pm,
    berry,
    cwd: p.root,
    ...(root && patterns && name && inWorkspace(pathFrom(root.root, p.root), patterns)
      ? { member: name }
      : {}),
    ...(root && patterns ? { workspaceRoot: root.root } : {}),
  };
}

/**
 * The command, run in the site's folder, that adds packages to the package in `dir`: the site's
 * own (`pnpm --filter <name> add`, `yarn workspace <name> add` in a workspace), the workspace's
 * root (`pnpm add -w`), or another folder (`cd <dir> && …`).
 */
function addCommand(ctx: Installer, dir: string, dev: boolean): string {
  const flag = dev ? (ctx.pm === 'bun' ? ' -d' : ' -D') : '';
  const add = ctx.pm === 'npm' ? `npm i${flag}` : `${ctx.pm} add${flag}`;
  if (dir === ctx.cwd) {
    // pnpm and Yarn add to a workspace's package by its name, from any of its folders.
    if (ctx.member && (ctx.pm === 'pnpm' || ctx.pm === 'yarn')) {
      const by = ctx.pm === 'pnpm' ? '--filter' : 'workspace';
      return `${ctx.pm} ${by} ${ctx.member} add${flag}`;
    }
    return add;
  }
  if (dir === ctx.workspaceRoot && ctx.pm === 'pnpm') return `pnpm add -w${flag}`;
  const atRoot =
    dir === ctx.workspaceRoot && ctx.pm === 'yarn' && !ctx.berry ? `yarn add -W${flag}` : add;
  return `cd ${pathFrom(ctx.cwd, dir)} && ${atRoot}`;
}

/** A string in one table of a TOML file, such as netlify.toml's `[build]` `base`. */
function tomlString(source: string | null, table: string, key: string): string | undefined {
  let inTable = false;
  for (const line of (source ?? '').split('\n')) {
    const header = /^\s*\[([^\]]*)\]/.exec(line);
    if (header) inTable = header[1]?.trim() === table;
    else if (inTable) {
      const value = flatConfigString(line, key);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/**
 * The folder the host builds the site from, where its functions go: the site's own, or, for a
 * host configured in a folder above it, that folder, or for Netlify the `base` directory its
 * netlify.toml names there.
 */
function hostBase(host: Host, at: Project, p: Project): Project {
  if (at.root === p.root) return p;
  const base =
    host === 'netlify' ? tomlString(at.read('netlify.toml'), 'build', 'base') : undefined;
  const dir = resolve(at.root, (base ?? '').replace(/^\/+/, ''));
  return dir === resolve(p.root) ? p : dir === at.root ? at : project(dir);
}

/**
 * A GitHub Pages workflow, or the gh-pages package or a script that runs it. Not a `docusaurus
 * deploy` script: every new Docusaurus site has one, wherever it is hosted.
 */
function deploysToPages(p: Project): boolean {
  const scripts = Object.values(p.pkg?.scripts ?? {}).filter((s) => typeof s === 'string');
  if (p.deps.has('gh-pages') || scripts.some((s) => /\bgh-pages\b/.test(s))) {
    return true;
  }
  const dir = join(p.root, '.github', 'workflows');
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));
  } catch {
    return false;
  }
  return files.some((file) =>
    /actions\/deploy-pages|actions\/upload-pages-artifact|peaceiris\/actions-gh-pages|JamesIves\/github-pages-deploy-action/.test(
      p.read(join('.github', 'workflows', file)) ?? '',
    ),
  );
}

/** Cloudflare Pages (`pages_build_output_dir`, or no wrangler config) or a Worker with assets. */
function cloudflareMode(p: Project): { mode: CloudflareMode; file?: string } {
  const file = first(p, WRANGLER);
  if (!file) return { mode: 'pages' };
  const source = p.read(file) ?? '';
  if (source.includes('pages_build_output_dir')) return { mode: 'pages', file };
  return { mode: 'workers', file };
}

/**
 * The keys of the JSON object whose brace is at `open`, its own and not its values', each with
 * where its value starts.
 */
function jsonKeys(source: string, open: number): Map<string, number> {
  const keys = new Map<string, number>();
  if (open === -1) return keys;
  let start = open + 1;
  scanCode(source, open, (char, i, depth) => {
    if (i === open) return false;
    if (depth === 1 && char === ',') start = i + 1;
    else if (depth === 1 && char === ':') {
      const name = /"((?:[^"\\\n]|\\.)*)"\s*$/.exec(source.slice(start, i))?.[1];
      if (name !== undefined && !keys.has(name)) keys.set(name, i + 1);
    }
    return depth === 0;
  });
  return keys;
}

/** The string a JSON value at `at` is, if it is one. */
const jsonString = (source: string, at: number): string | undefined =>
  /^\s*"([^"]*)"/.exec(source.slice(at))?.[1];

/**
 * The wrangler config with the Worker's entry point and the ASSETS binding added, or why it
 * cannot be edited safely, with what to add by hand.
 */
export function wranglerWorkerConfig(
  file: string,
  source: string,
): { content: string } | { error: string } {
  const main = WORKER_MODULE;
  const byHand = `${file}: set main to "${main}" and the static assets' binding to "ASSETS"`;
  if (file.endsWith('.toml')) {
    const lines = source.split('\n');
    const header = (line: string) => /^\s*\[/.test(line);
    const firstTable = lines.findIndex(header);
    const top = firstTable === -1 ? lines : lines.slice(0, firstTable);
    const mainLine = top.find((line) => /^\s*main\s*=/.test(line));
    if (mainLine && !mainLine.includes(main)) {
      return {
        error: `${file} has its own entry point (${mainLine.trim()}): call ondocs(request, env) from ${main} in it`,
      };
    }
    const assets = lines.findIndex((line) => /^\s*\[\s*assets\s*\]\s*$/.test(line));
    if (assets === -1) {
      return /^\s*assets\s*=/m.test(source)
        ? { error: byHand }
        : {
            error: `${file} has no [assets] (a Worker with static assets) nor pages_build_output_dir (Pages)`,
          };
    }
    const end = lines.findIndex((line, i) => i > assets && header(line));
    const table = lines.slice(assets + 1, end === -1 ? undefined : end);
    const binding = table.find((line) => /^\s*binding\s*=/.test(line));
    if (binding && !/["']ASSETS["']/.test(binding)) {
      return { error: `${file}: the static assets' binding must be "ASSETS" (${binding.trim()})` };
    }
    const out = [...lines];
    if (!binding) out.splice(assets + 1, 0, 'binding = "ASSETS"');
    if (!mainLine) {
      const name = out.findIndex(
        (line, i) => /^\s*name\s*=/.test(line) && (firstTable === -1 || i < firstTable),
      );
      out.splice(name === -1 ? 0 : name + 1, 0, `main = "${main}"`);
    }
    return { content: out.join('\n') };
  }
  // JSON, with comments in a .jsonc: edited as text, so the comments stay. Only the object's own
  // keys count: an environment's "main" or "assets" (env.staging.main) is not the Worker's.
  const keys = jsonKeys(
    source,
    scanCode(source, 0, (char) => char === '{'),
  );
  const mainKey = keys.get('main');
  const mainValue = mainKey === undefined ? undefined : jsonString(source, mainKey);
  if (mainKey !== undefined && mainValue !== main) {
    return {
      error: `${file} has its own entry point ("main": "${String(mainValue)}"): call ondocs(request, env) from ${main} in it`,
    };
  }
  const assetsKey = keys.get('assets');
  const open = assetsKey === undefined ? -1 : source.indexOf('{', assetsKey);
  if (assetsKey === undefined || source.slice(assetsKey, open).trim() !== '') {
    return {
      error: `${file} has no "assets" (a Worker with static assets) nor "pages_build_output_dir" (Pages)`,
    };
  }
  const close = scanCode(source, open, (_, i, depth) => i > open && depth === 0);
  const object = source.slice(open, close + 1);
  const bindingKey = jsonKeys(object, 0).get('binding');
  const binding = bindingKey === undefined ? undefined : jsonString(object, bindingKey);
  if (bindingKey !== undefined && binding !== 'ASSETS') {
    return {
      error: `${file}: the static assets' binding must be "ASSETS" ("${String(binding)}")`,
    };
  }
  const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? '  ';
  let out = source;
  if (bindingKey === undefined) {
    const at = open + 1;
    // `"assets": { "directory": "./build" }` stays on one line; a multi-line object gets a line.
    // An empty object gets no comma after it: a .json file allows none.
    const inline = !object.includes('\n');
    const comma = literalEntries(object, 0).length > 0 ? ',' : '';
    const insert = inline
      ? ` "binding": "ASSETS"${comma || ' '}`
      : `\n${indent}${indent}"binding": "ASSETS"${comma}`;
    out = `${out.slice(0, at)}${insert}${out.slice(at)}`;
  }
  if (mainKey === undefined) {
    // After "name", where a config usually says what the Worker is, else first.
    const top = scanCode(out, 0, (char) => char === '{');
    const nameKey = jsonKeys(out, top).get('name');
    const lineStart = nameKey === undefined ? -1 : out.lastIndexOf('\n', nameKey) + 1;
    const lineEnd = nameKey === undefined ? -1 : out.indexOf('\n', nameKey);
    const name = /^([ \t]*)"name"\s*:\s*"[^"]*"\s*,[^\n]*$/.exec(
      lineStart === -1 ? '' : out.slice(lineStart, lineEnd === -1 ? undefined : lineEnd),
    );
    if (name) {
      const at = lineStart + name[0].length;
      out = `${out.slice(0, at)}\n${String(name[1])}"main": "${main}",${out.slice(at)}`;
    } else {
      if (top === -1) return { error: byHand };
      out = `${out.slice(0, top + 1)}\n${indent}"main": "${main}",${out.slice(top + 1)}`;
    }
  }
  return { content: out };
}

/** One file of the plan, with what init does with it. */
interface Change extends GeneratedFile {
  /** `create`: new; `update`: exists and differs; `same`: already as it would write it. */
  status: 'create' | 'update' | 'same';
}

interface Plan {
  site: Site;
  host: Host;
  /** Where the files go, when the host is configured in a folder above the site's. */
  where?: string;
  changes: Change[];
  /** Edits init could not make safely, with what to do by hand. */
  manual: string[];
  /** Variables to set: what they are for, and where. */
  env: { name: string; when: string; how: string }[];
  next: string[];
}

/** What the CLI's index step needs to know without a key. */
const WITHOUT_KEY =
  ' (it embeds with OPENAI_API_KEY; -e none builds a keyword-only index without it)';

/** The dependency ranges init writes into a standalone Worker's package.json. */
const WORKER_VERSIONS: WorkerVersions = {
  ondocs: `^${version}`,
  ai: '^7.0.0',
  openai: '^4.0.0',
  workersAi: '^4.0.0',
  wrangler: '^4.0.0',
  typescript: '^6.0.0',
  workersTypes: '^5.20261001.0',
};

/** What the functions import: the server entry, the AI SDK and its OpenAI provider. */
const FUNCTION_PACKAGES = ['ondocs', 'ai', '@ai-sdk/openai'];

/** The command that adds those of `packages` the package in `p`'s folder lacks, if any. */
function install(p: Project, packages: string[], ctx: Installer, dev = false): string | null {
  const missing = packages.filter((name) => !p.deps.has(name));
  if (missing.length === 0 || !p.pkg) return null;
  return `${addCommand(ctx, p.root, dev)} ${missing.join(' ')}`;
}

/**
 * The packages the site needs for the dialog and the endpoint it was given. `functions`: init
 * writes the endpoint into the site's own project (not a standalone Worker), as functions that
 * import ondocs/server and @ai-sdk/openai.
 */
function sitePackages(site: Site, openai = true, functions = false): string[] {
  // A React site's dialog renders with the site's React, and these two. The Starlight, Astro and
  // VitePress plugins mount ondocs/embed/standalone, whose dialog brings its own React, Radix and
  // cmdk, as the script tag on a static site does.
  const dialog =
    site.kind === 'docusaurus' || site.kind === 'next' ? ['@radix-ui/react-dialog', 'cmdk'] : [];
  // The plugins embed the pages with OpenAI when OPENAI_API_KEY is set as the site builds. A
  // static site is indexed with npx, so it needs the models only for its functions; the
  // standalone Worker has a package.json of its own.
  const models =
    site.kind === 'static' && !functions ? [] : openai ? ['ai', '@ai-sdk/openai'] : ['ai'];
  return ['ondocs', ...models, ...dialog];
}

/**
 * How to add the dialog, for the site's framework, pointed at `endpoint` when it is not /api/ask,
 * embedding the pages with `embedding` when given, and naming the MCP endpoint at `mcp`, when
 * given, for llms.txt. `null` when the site's config already adds the plugin and there is no
 * option to give it.
 */
function dialogStep(
  site: Site,
  endpoint: string | null,
  embedding?: string,
  mcp?: string,
): string | null {
  // An `mcp` option the config already has stays as it is.
  const named = site.pluginMcp ? undefined : mcp;
  const fields = [
    ...(endpoint ? [`endpoint: '${endpoint}'`] : []),
    ...(named ? [`mcp: '${named}'`] : []),
    ...(embedding ? [`embedding: '${embedding}'`] : []),
  ];
  const option = fields.length > 0 ? `{ ${fields.join(', ')} }` : '';
  // A path needs the site's URL in the config: without it, the build stops and says so.
  const urlFirst =
    named?.startsWith('/') && !site.urlInConfig
      ? `; set ${site.kind === 'vitepress' ? `sitemap.hostname in ${site.config ?? '.vitepress/config.mts'}` : 'site in astro.config'} to the site's URL first, which the path is resolved against`
      : '';
  const notes = [
    ...(named ? [`mcp points agents that read llms.txt at the MCP endpoint${urlFirst}`] : []),
    ...(embedding
      ? [
          'the embedding needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN as the site builds; leave it out for a keyword-only index',
        ]
      : []),
  ];
  const why = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  if (site.plugin) {
    return option ? `Pass ${option} to the ondocs plugin in ${site.plugin}${why}` : null;
  }
  switch (site.kind) {
    case 'docusaurus':
      return option
        ? `Add the plugin to docusaurus.config: plugins: [['ondocs/docusaurus', ${option}]]${why}`
        : "Add the plugin to docusaurus.config: plugins: ['ondocs/docusaurus']";
    case 'starlight':
      return `Add the plugin to Starlight in astro.config: plugins: [ondocs(${option})], from 'ondocs/starlight'${why}`;
    case 'astro':
      return `Add the integration to astro.config: integrations: [ondocs(${option})], from 'ondocs/astro'${why}`;
    case 'vitepress':
      return `Wrap the config in ${site.config ?? '.vitepress/config.mts'} in withOndocs, from 'ondocs/vitepress': export default withOndocs(defineConfig({ ... })${option ? `, ${option}` : ''})${why}`;
    case 'next':
      return `Render <AskDialog launcher${endpoint ? ` endpoint="${endpoint}"` : ''} /> from 'ondocs/react' in your layout, with 'ondocs/react/styles.css' and 'ondocs/embed/launcher.css'`;
    case 'static':
      return `Add to your base template: <script src="https://cdn.jsdelivr.net/npm/ondocs@${version.split('.').slice(0, 2).join('.')}/dist/embed.global.js" data-endpoint="${endpoint ?? '/api/ask'}" defer></script>`;
  }
}

/** The files and steps for `site` on `host`. */
function planFor(
  p: Project,
  site: Site,
  host: Host,
  mcp: boolean,
  provider: WorkerProvider,
  hostAt: Project,
  ctx: Installer,
): Omit<Plan, 'changes'> & {
  files: GeneratedFile[];
} {
  // Where the endpoint's files go: the site's folder, or, for a host configured in a folder above
  // it, the folder the host builds from, where the functions find the index by its path from
  // there. A Next.js app's routes, and the GitHub Pages Worker, stay with the site.
  const base = site.kind === 'next' || host === 'github-pages' ? p : hostBase(host, hostAt, p);
  const hosted: Site =
    base === p ? site : { ...site, indexFile: pathFrom(base.root, join(p.root, site.indexFile)) };
  if (hosted.indexFile.startsWith('../')) {
    throw new InitError(
      `${HOST_LABELS[host]} builds from ${pathFrom(p.root, base.root)}/, which does not hold the site's ${site.indexFile}: run init in the folder ${HOST_LABELS[host]} builds from, or set its base directory to one that holds the site.`,
    );
  }
  /** A path in the folder the host builds from, and in the folder of its config, from the site's. */
  const inBase = (path: string): string => pathFrom(p.root, join(base.root, path));
  const inConfig = (path: string): string => pathFrom(p.root, join(hostAt.root, path));
  const moved = (generated: GeneratedFile[]): GeneratedFile[] =>
    generated.map((file) => ({ ...file, path: inBase(file.path) }));
  const files: GeneratedFile[] = [];
  const manual: string[] = [];
  const env: Plan['env'] = [];
  // The install steps, which come first, then the rest.
  const installs: string[] = [];
  const next: string[] = [];
  const key = 'OPENAI_API_KEY';
  // Where the pages are embedded: by the plugin as the site builds, or by `ondocs index`.
  const build =
    site.kind === 'next' || site.kind === 'static' ? 'the index build' : 'the site\u2019s build';
  // The plugins build a keyword-only index without a key; `ondocs index` needs -e none for one.
  const keyless =
    site.kind === 'next' || site.kind === 'static'
      ? 'without it there, add -e none to the index command for a keyword-only index, which works too'
      : 'without it there, the index is keyword-only, which works too';
  // Where one variable serves the build and the endpoint: the build can do without the key, but
  // the endpoint cannot, as a model writes every answer.
  const answersNeedIt = `without it, ${mcp ? 'the MCP endpoint works and ' : ''}off-topic questions are refused, but the Ask box cannot answer; for no key at all, init --host github-pages writes a Worker that answers with Workers AI`;
  // A site whose Worker answers with Workers AI embeds with it too, or not at all. Functions in
  // a folder above the site's import their packages from there.
  const elsewhere = base !== p;
  const needed = sitePackages(
    site,
    !(host === 'github-pages' && provider === 'workers-ai'),
    host !== 'github-pages' && !elsewhere,
  );
  addStep(installs, install(p, needed, ctx));

  const edit = (
    path: string,
    description: string,
    result: { content: string } | { error: string },
  ): void => {
    if ('error' in result) manual.push(result.error);
    else files.push({ path, content: result.content, description, addition: true });
  };

  if (site.kind === 'next' && host !== 'github-pages') {
    files.push(...nextFiles(site, host, site.appDir ?? 'app', mcp));
    env.push({
      name: key,
      when: `for the app and ${build}`,
      how: `in ${HOST_LABELS[host]}'s environment variables; ${answersNeedIt}`,
    });
    next.push(
      `Build the index before the app, as a "prebuild" script: ${String(site.indexCommand)}${WITHOUT_KEY}`,
    );
    addStep(next, dialogStep(site, null));
  } else if (host === 'github-pages') {
    if (!site.url) {
      throw new InitError(
        'The Worker fetches the index from the live site, so it needs the site’s URL: pass --site-url https://<user>.github.io/<repo>.',
      );
    }
    const indexed = site.kind === 'next' ? { ...site, indexFile: 'public/ask-index.json' } : site;
    files.push(
      ...standaloneWorkerFiles({ ...indexed, url: site.url }, mcp, WORKER_VERSIONS, provider),
    );
    const workersAi = provider === 'workers-ai';
    if (workersAi) {
      env.push({
        name: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN',
        when: `for ${build}, optional`,
        how: `repository secrets, to embed the pages with ${WORKERS_AI_EMBEDDING} for semantic search (a token allowed to run Workers AI); without them, nothing is embedded and questions are matched on keywords`,
      });
    } else {
      env.push({
        name: key,
        when: 'for the Worker',
        how: `cd ${STANDALONE_DIR} && npx wrangler secret put ${key}`,
      });
      env.push({
        name: key,
        when: `for ${build}`,
        how: `a repository secret, for a GitHub Actions build; ${keyless}`,
      });
    }
    const spec = workersAi ? ` -e workers-ai:${WORKERS_AI_EMBEDDING}` : '';
    // A project site, at https://user.github.io/repo, serves its pages under /repo. The Worker
    // links to them by their URLs in the index, on SITE_URL's origin, so the URLs need the path.
    const base = site.kind === 'static' ? new URL(`${site.url}/`).pathname.replace(/\/+$/, '') : '';
    if (site.indexCommand) {
      next.push(
        `Build the index with the site: ${site.kind === 'next' ? `${site.indexCommand} -o public/ask-index.json` : site.indexCommand}${base ? ` --base-url ${base}` : ''}${spec}${workersAi ? ' (with the two Cloudflare variables set; -e none builds a keyword-only index without them)' : WITHOUT_KEY}`,
      );
    }
    next.push(
      `cd ${STANDALONE_DIR} && npm install && npx wrangler deploy${workersAi ? '' : ` (after wrangler secret put ${key})`}: it prints the Worker's URL, https://${standaloneName(site)}.<your-subdomain>.workers.dev`,
    );
    addStep(
      next,
      dialogStep(
        site,
        `https://${standaloneName(site)}.<your-subdomain>.workers.dev/api/ask`,
        workersAi && site.kind !== 'next' && site.kind !== 'static'
          ? `workers-ai:${WORKERS_AI_EMBEDDING}`
          : undefined,
        mcp ? `https://${standaloneName(site)}.<your-subdomain>.workers.dev/api/mcp` : undefined,
      ),
    );
  } else if (host === 'vercel') {
    files.push(...moved(vercelFiles(hosted, mcp)));
    edit(
      inConfig('vercel.json'),
      `bundles ${site.locales?.length ? 'the index of each locale' : hosted.indexFile} with the function${mcp ? 's' : ''}`,
      vercelConfig(hostAt.read('vercel.json'), hosted, mcp),
    );
    env.push({
      name: key,
      when: `for the functions and ${build}`,
      how: `in the project's Settings, Environment Variables; ${answersNeedIt}`,
    });
  } else if (host === 'netlify') {
    files.push(...moved(netlifyFiles(hosted, mcp)));
    edit(
      inConfig('netlify.toml'),
      `bundles ${site.locales?.length ? 'the index of each locale' : hosted.indexFile} with the function${mcp ? 's' : ''}`,
      netlifyConfig(hostAt.read('netlify.toml'), hosted, mcp),
    );
    env.push({
      name: key,
      when: `for the functions and ${build}`,
      how: `in the site's Environment variables, or netlify env:set ${key}; ${answersNeedIt}`,
    });
  } else {
    const { mode, file } = cloudflareMode(hostAt);
    if (mode === 'pages') {
      files.push(...moved(cloudflarePagesFiles(hosted, mcp)));
      env.push({
        name: key,
        when: 'for the functions',
        how: `npx wrangler pages secret put ${key}, or the project's Variables and Secrets`,
      });
      env.push({ name: key, when: `for ${build}`, how: `a build variable; ${keyless}` });
    } else {
      files.push(...moved(cloudflareWorkerFiles(hosted, mcp)));
      if (file) {
        edit(
          inConfig(file),
          `sets main to ${WORKER_MODULE}, and the static assets' binding to ASSETS`,
          wranglerWorkerConfig(inConfig(file), hostAt.read(file) ?? ''),
        );
      }
      env.push({ name: key, when: 'for the Worker', how: `npx wrangler secret put ${key}` });
      env.push({ name: key, when: `for ${build}`, how: `a build variable; ${keyless}` });
    }
  }

  if (site.kind === 'static' && site.indexCommand && host !== 'github-pages') {
    next.push(`Build the index after the site: ${site.indexCommand}${WITHOUT_KEY}`);
  }
  if (site.kind !== 'next' && host !== 'github-pages') {
    // The plugins take `mcp`; the script tag has nothing to name it in. Always the path: a URL
    // made from package.json's homepage can be the repository's page, as npm init sets it.
    addStep(
      next,
      dialogStep(site, null, undefined, mcp && site.kind !== 'static' ? '/api/mcp' : undefined),
    );
  }
  next.push('Deploy as you do now. init has deployed nothing.');

  // The functions' own packages, where they are when that is not the site's folder, and their
  // types; or a package.json, where there is none for the host to install them from.
  const functions = posix.dirname(files[0]?.path ?? '.');
  if (elsewhere) {
    addStep(
      installs,
      install(base, FUNCTION_PACKAGES, ctx)?.concat(
        ` (the functions in ${functions} import them)`,
      ) ?? null,
    );
  }
  const own = elsewhere ? base : p;
  if (!own.pkg && (elsewhere || site.kind === 'static') && host !== 'github-pages') {
    installs.push(
      `${elsewhere ? `cd ${pathFrom(p.root, base.root)} && ` : ''}npm init -y && npm i ${(elsewhere ? FUNCTION_PACKAGES : needed).join(' ')} (the functions import them, and the host installs them from package.json)`,
    );
  }
  if (site.kind !== 'next' && (host === 'vercel' || host === 'netlify')) {
    addStep(
      installs,
      install(own, ['@types/node'], ctx, true)?.concat(" (the functions' types)") ?? null,
    );
  }

  // The host's config file, which init found in a folder above the site's.
  const config =
    host === 'cloudflare'
      ? first(hostAt, WRANGLER)
      : host === 'vercel'
        ? first(hostAt, ['vercel.json', '.vercel'])
        : first(hostAt, ['netlify.toml', '.netlify']);
  const builds =
    host === 'cloudflare'
      ? ''
      : `, and builds from ${elsewhere ? `${pathFrom(p.root, base.root)}/` : 'this folder'}`;
  const reads =
    host === 'cloudflare'
      ? ''
      : `, and read the index as ${hosted.indexFile}${elsewhere ? ', its path from there' : ''}`;
  const where =
    hostAt === p || site.kind === 'next' || host === 'github-pages' || !config
      ? undefined
      : `${HOST_LABELS[host]} is configured in ${inConfig(config)}, above the site's folder${builds}: the endpoint's files go in ${functions}${reads}.`;
  return {
    site,
    host,
    ...(where ? { where } : {}),
    files,
    manual,
    env,
    next: [...installs, ...next],
  };
}

const standaloneName = (site: Site): string => workerName(site.name);

const addStep = (next: string[], step: string | null): void => {
  if (step) next.push(step);
};

function parseInitFlags(args: string[]) {
  try {
    const { values } = parseArgs({
      args,
      allowNegative: true,
      strict: true,
      options: {
        host: { type: 'string' },
        provider: { type: 'string' },
        'site-url': { type: 'string' },
        'site-name': { type: 'string' },
        // --site-name's name before 0.9.
        name: { type: 'string' },
        'build-dir': { type: 'string' },
        // --build-dir's name before 0.14: `ondocs index -o` names the file it writes instead.
        out: { type: 'string' },
        mcp: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    const host = values.host;
    if (host !== undefined && !HOSTS.includes(host as Host)) {
      throw new InitError(`--host must be one of ${HOSTS.join(', ')}.`);
    }
    const given = values.provider;
    if (given !== undefined && given !== 'workers-ai' && given !== 'openai') {
      throw new InitError('--provider must be workers-ai or openai.');
    }
    const provider: WorkerProvider | undefined = given;
    const siteUrl = values['site-url'];
    if (siteUrl !== undefined && !/^https?:\/\/[^/]/.test(siteUrl)) {
      throw new InitError(`--site-url must be an absolute http(s) URL (got ${siteUrl}).`);
    }
    const name = values['site-name'] ?? values.name;
    const buildDir = values['build-dir'] ?? values.out;
    return {
      ...(host ? { host: host as Host } : {}),
      ...(provider ? { provider: provider } : {}),
      ...(siteUrl ? { siteUrl: siteUrl.replace(/\/+$/, '') } : {}),
      ...(name ? { name } : {}),
      deprecated: [
        ...(values.name === undefined
          ? []
          : [`--name is now --site-name. The old name still works until ${REMOVED_IN}.`]),
        ...(values.out === undefined
          ? []
          : [`--out is now --build-dir. The old name still works until ${REMOVED_IN}.`]),
      ],
      ...(buildDir ? { buildDir } : {}),
      mcp: values.mcp ?? true,
      dryRun: values['dry-run'] ?? false,
      yes: values.yes ?? false,
      help: values.help ?? false,
    };
  } catch (error) {
    if (error instanceof InitError) throw error;
    throw new InitError((error as Error).message);
  }
}

async function chooseHost(found: FoundHost[], p: Project, io: CliIO): Promise<Host> {
  const detected = found.map(({ host }) => host);
  const choices = detected.length > 1 ? detected : HOSTS;
  // A host configured in a folder above the site's says where.
  const named = found
    .map(({ host, at }) =>
      at === p ? HOST_LABELS[host] : `${HOST_LABELS[host]} (in ${pathFrom(p.root, at.root)}/)`,
    )
    .join(' and ');
  if (!io.prompt) {
    throw new InitError(
      detected.length > 1
        ? `This site has config for ${named}: pick one with --host ${detected.join('|')}.`
        : `No vercel.json, netlify.toml, wrangler config or GitHub Pages workflow here: pass --host ${HOSTS.join('|')}.`,
    );
  }
  const lines = [
    detected.length > 1
      ? `This site has config for ${named}. Which one serves it?`
      : 'Where is the site hosted?',
    ...choices.map(
      (host, i) =>
        `  ${String(i + 1)}. ${HOST_LABELS[host]}${host === 'github-pages' ? ', or another static host (the endpoint runs as a Cloudflare Worker)' : ''}`,
    ),
  ];
  for (const line of lines) io.stdout(line);
  for (;;) {
    const answer = (await io.prompt(`Choose 1-${String(choices.length)}: `)).trim();
    const host = choices[Number(answer) - 1] ?? choices.find((h) => h === answer);
    if (host) return host;
  }
}

async function confirm(io: CliIO, question: string): Promise<boolean> {
  if (!io.prompt) return false;
  return /^y(es)?$/i.test((await io.prompt(`${question} [y/N] `)).trim());
}

/** Runs `ondocs init`. Returns the exit code: 0 done, 1 something left undone, 2 usage. */
export async function init(args: string[], io: CliIO): Promise<number> {
  let flags: ReturnType<typeof parseInitFlags>;
  try {
    flags = parseInitFlags(args);
  } catch (error) {
    io.stderr((error as Error).message);
    io.stderr(`\n${INIT_USAGE}`);
    return 2;
  }
  if (flags.help) {
    io.stdout(INIT_USAGE);
    return 0;
  }
  for (const warning of flags.deprecated) io.stderr(`! ${warning}`);
  try {
    const p = project(io.cwd);
    // A workspace's root, whose sites are in its packages: say which, rather than take a
    // dependency of the root's for a site.
    const patterns = workspacePatterns(p);
    if (patterns && !flags.buildDir && !siteConfigLabel(p)) {
      const sites = workspaceSites(p, patterns);
      const docs = sites.find(({ dir }) => /(?:^|\/)(?:docs?|website|site)$/.test(dir)) ?? sites[0];
      if (docs) {
        const listed = sites.slice(0, 8).map(({ dir, label }) => `${dir} (${label})`);
        throw new InitError(
          `This is a workspace's root, and its sites are packages of their own: ${listed.join(', ')}${sites.length > 8 ? `, and ${String(sites.length - 8)} more` : ''}. Run init in the docs site's folder, as in: cd ${docs.dir} && npx ondocs init`,
        );
      }
    }
    const site = detectSite(p, flags);
    const above = foldersAbove(p);
    const ctx = installer(p, above);
    const detected = findHosts(p, above);

    // Astro with an adapter: the integration serves the endpoints itself, on any host.
    if ((site.kind === 'astro' || site.kind === 'starlight') && site.adapter) {
      const packages = install(p, sitePackages(site), ctx);
      io.stdout(
        [
          `${site.label} with ${site.adapter}: nothing to write. The ondocs integration serves POST /api/ask and /api/mcp itself, through the adapter, from the index it builds.`,
          '',
          'Set OPENAI_API_KEY where the site builds and where it runs. Pass route: { model, rateLimit, budget } to ondocs() to change the model or the limits; route: false turns it off.',
          // llms.txt names the MCP route only with an absolute URL to give.
          ...(site.urlInConfig
            ? []
            : [
                '',
                "Set site in astro.config to the site's URL, so llms.txt names /api/mcp for agents.",
              ]),
          ...(packages ? ['', `Install: ${packages}`] : []),
        ].join('\n'),
      );
      return 0;
    }

    const host =
      flags.host ??
      (detected.length === 1 && detected[0] ? detected[0].host : await chooseHost(detected, p, io));
    const hostAt = detected.find((found) => found.host === host)?.at ?? p;
    for (const warning of site.warnings ?? []) io.stderr(`! ${warning}`);
    let resolved = site;
    // A URL from the site's config can be its template's, as a new Docusaurus site's is.
    const placeholder = !flags.siteUrl && site.url && placeholderUrl(site.url) ? site.url : null;
    if (host === 'github-pages' && (!site.url || placeholder) && io.prompt) {
      if (placeholder) {
        io.stdout(
          `The site's config has ${placeholder} as its URL, which looks like a placeholder.`,
        );
      }
      const answer = (
        await io.prompt('The site’s public URL, with its base path (https://user.github.io/repo): ')
      ).trim();
      if (/^https?:\/\/[^/]/.test(answer)) resolved = { ...site, url: answer.replace(/\/+$/, '') };
    }
    if (host === 'github-pages' && placeholder && resolved.url === placeholder) {
      io.stderr(
        `! The site's URL, ${placeholder}, looks like a template's placeholder, and the Worker reads the index from it. Set the site's real URL in its config, or run init again with --site-url.`,
      );
    }
    if (flags.provider === 'workers-ai' && host !== 'github-pages') {
      throw new InitError(
        '--provider workers-ai is for --host github-pages, whose endpoint is a Cloudflare Worker of its own with a Workers AI binding.',
      );
    }
    const planned = planFor(
      p,
      resolved,
      host,
      flags.mcp,
      flags.provider ?? 'workers-ai',
      hostAt,
      ctx,
    );
    const changes: Change[] = planned.files.map((file) => {
      const existing = p.read(file.path);
      const status = existing === null ? 'create' : existing === file.content ? 'same' : 'update';
      return { ...file, status };
    });
    const plan: Plan = { ...planned, changes };
    return await apply(plan, flags, io);
  } catch (error) {
    if (error instanceof InitError) {
      io.stderr(`✗ ${error.message}`);
      return 2;
    }
    io.stderr(`✗ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function apply(
  plan: Plan,
  flags: { dryRun: boolean; yes: boolean },
  io: CliIO,
): Promise<number> {
  const { site, host } = plan;
  const where =
    host === 'github-pages' ? 'GitHub Pages, answered by a Cloudflare Worker' : HOST_LABELS[host];
  const article = /^[AEIOU]/.test(site.label) ? 'an' : 'a';
  io.stdout(`${flags.dryRun ? 'Dry run: ' : ''}${article} ${site.label} site on ${where}.`);
  if (site.locales?.length && site.kind !== 'next') {
    io.stdout(
      `Its other locales, ${site.locales.join(', ')}, are answered from their own indexes, as the dialog asks.`,
    );
  }
  if (plan.where) io.stdout(plan.where);
  io.stdout('');

  const written: Change[] = [];
  const skipped: Change[] = [];
  for (const change of plan.changes) {
    if (change.status === 'same') continue;
    if (flags.dryRun) {
      written.push(change);
      continue;
    }
    if (change.status === 'update' && !change.addition && !flags.yes) {
      if (
        !(await confirm(
          io,
          `${change.path} exists and differs from what init writes. Overwrite it?`,
        ))
      ) {
        skipped.push(change);
        continue;
      }
    }
    await mkdir(dirname(join(io.cwd, change.path)), { recursive: true });
    await writeFile(join(io.cwd, change.path), change.content);
    written.push(change);
  }

  const width = Math.max(...plan.changes.map((change) => change.path.length), 0);
  const verb = (change: Change): string => {
    if (skipped.includes(change)) return 'skipped';
    if (change.status === 'same') return 'unchanged';
    if (flags.dryRun) return change.status === 'create' ? 'would create' : 'would update';
    return change.status === 'create' ? 'created' : 'updated';
  };
  const verbWidth = flags.dryRun ? 12 : 9;
  for (const change of plan.changes) {
    io.stdout(
      `  ${verb(change).padEnd(verbWidth)}  ${change.path.padEnd(width)}  ${change.description}`,
    );
  }
  for (const line of plan.manual) io.stdout(`  ${'by hand'.padEnd(verbWidth)}  ${line}`);

  if (flags.dryRun) {
    for (const change of written) {
      io.stdout('');
      io.stdout(`--- ${change.path}`);
      io.stdout(change.content.replace(/\n$/, ''));
    }
  }

  io.stdout('');
  io.stdout('Set (init reads none of these):');
  for (const variable of plan.env) {
    io.stdout(`  ${variable.name}, ${variable.when}: ${variable.how}`);
  }
  io.stdout('');
  io.stdout('Next:');
  plan.next.forEach((step, i) => {
    io.stdout(`  ${String(i + 1)}. ${step}`);
  });

  if (skipped.length > 0) {
    io.stderr('');
    io.stderr(
      `! Left ${skipped.map((change) => change.path).join(', ')} as ${skipped.length === 1 ? 'it is' : 'they are'}. Rerun with --dry-run to see what init would write, or --yes to overwrite.`,
    );
    return 1;
  }
  return plan.manual.length > 0 ? 1 : 0;
}
