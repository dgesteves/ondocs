// Checks that every `ondocs/...` import the docs show resolves in a package: each module is in its
// `exports`, the file it points at is in the package, and each name a docs import statement takes
// from it is in the module's types. The docs deploy from main, so a page can describe a module or
// a name that the version on npm doesn't have yet, and following it then fails a site's build.
//
//   pnpm build && node scripts/check-doc-imports.mjs     # against this checkout's package
//   node scripts/check-doc-imports.mjs --npm ondocs@0.11.0   # against that version on npm
//   node scripts/check-doc-imports.mjs --npm ondocs@latest --warn   # report only, exit 0
//
// The release workflow runs it on the version it has just published, and on npm's latest after
// every other push to main, where a miss is a warning: the docs are ahead of npm until the next
// release. With --npm it downloads the tarball (`npm pack`, which runs none of its scripts) into a
// temporary directory, and reads it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DOCS = 'examples/nextjs/content/docs';

/**
 * @typedef {{ file: string, line: number, specifier: string, names: string[] }} DocImport
 * @typedef {{ file: string, line: number, specifier: string, message: string }} Problem
 */

/**
 * The pages to read, relative to `dir`: the README, the plugin packages' READMEs and the website's
 * docs. The Docusaurus, Starlight and VitePress examples' pages are generated from the website's.
 * @param {string} dir
 * @returns {string[]}
 */
export function docFiles(dir) {
  const pages = readdirSync(join(dir, DOCS)).filter((file) => /\.mdx?$/.test(file));
  const packages = readdirSync(join(dir, 'packages')).filter((name) =>
    existsSync(join(dir, 'packages', name, 'README.md')),
  );
  return [
    'README.md',
    ...packages.sort().map((name) => `packages/${name}/README.md`),
    ...pages.sort().map((file) => `${DOCS}/${file}`),
  ];
}

/**
 * Every module of the package that `text` names in quotes or backticks (`'ondocs/server'`,
 * `` `ondocs/embed/button.css` ``, `"ondocs"`), and the names each import statement takes from
 * it (`import { createAskHandler } from 'ondocs/server'`, `import ondocs from 'ondocs/astro'`,
 * which takes `default`).
 * @param {string} text
 * @param {string} file
 * @returns {DocImport[]}
 */
export function findImports(text, file) {
  const lineOf = (/** @type {number} */ index) => text.slice(0, index).split('\n').length;
  /** @type {Map<number, DocImport>} */
  const found = new Map();
  for (const match of text.matchAll(/(['"`])(ondocs(?:\/[\w.@-]+)*)\1/g)) {
    // A placeholder such as `ondocs/...` names no module.
    if (match[2]?.split('/').some((part) => /^\.+$/.test(part))) continue;
    found.set(match.index, {
      file,
      line: lineOf(match.index),
      specifier: match[2] ?? 'ondocs',
      names: [],
    });
  }
  const statement =
    /\bimport\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s*(['"])(ondocs(?:\/[\w.@-]+)*)\3/g;
  for (const match of text.matchAll(statement)) {
    const [whole, defaultName, named = '', quote] = match;
    const at = match.index + whole.lastIndexOf(quote ?? "'", whole.length - 2);
    const entry = found.get(at);
    if (!entry) continue;
    if (defaultName && defaultName !== 'type') entry.names.push('default');
    for (const part of named.split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) entry.names.push(name);
    }
  }
  return [...found.values()];
}

/**
 * The files an `exports` target names, for every condition (`types`, `import`, `default`...).
 * @param {unknown} target
 * @returns {string[]}
 */
function targetFiles(target) {
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) return target.flatMap(targetFiles);
  if (target && typeof target === 'object') return Object.values(target).flatMap(targetFiles);
  return [];
}

/**
 * The names a declaration file exports: `export declare function a`, `export interface B`,
 * `export default function`, `export { c, type D, e as f }`, and what an `export * from './x'`
 * brings in from the file next to it.
 * @param {string} path
 * @param {Set<string>} [seen]
 * @returns {Set<string>}
 */
export function exportedNames(path, seen = new Set()) {
  const names = new Set();
  if (seen.has(path) || !existsSync(path)) return names;
  seen.add(path);
  const text = readFileSync(path, 'utf8');
  if (/^export\s+default\b/m.test(text)) names.add('default');
  for (const match of text.matchAll(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|namespace)\s+([\w$]+)/gm,
  )) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  for (const match of text.matchAll(/^export\s+\*\s+as\s+([\w$]+)\s+from/gm)) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of text.matchAll(/^export\s+\*\s+from\s*['"](\.[^'"]+)['"]/gm)) {
    const from = resolve(dirname(path), match[1] ?? '');
    const candidates = [from, from.replace(/\.js$/, '.d.ts'), `${from}.d.ts`];
    const next = candidates.find(
      (candidate) => candidate.endsWith('.d.ts') && existsSync(candidate),
    );
    if (next) for (const name of exportedNames(next, seen)) names.add(name);
  }
  return names;
}

/**
 * What doesn't resolve in the package at `packageDir` (its package.json, and the files beside it).
 * @param {DocImport[]} imports
 * @param {string} packageDir
 * @returns {Problem[]}
 */
export function checkImports(imports, packageDir) {
  const manifest =
    /** @type {{ name: string, version: string, exports?: Record<string, unknown> }} */ (
      JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    );
  const exportsMap = manifest.exports ?? {};
  const at = `${manifest.name}@${manifest.version}`;
  /** @type {Problem[]} */
  const problems = [];
  for (const entry of imports) {
    const { file, line, specifier } = entry;
    const subpath = specifier === manifest.name ? '.' : `.${specifier.slice(manifest.name.length)}`;
    if (!(subpath in exportsMap)) {
      problems.push({
        file,
        line,
        specifier,
        message: `${at} does not export ${specifier}: its package.json has no "${subpath}" in exports`,
      });
      continue;
    }
    const target = exportsMap[subpath];
    const missing = targetFiles(target).filter((path) => !existsSync(join(packageDir, path)));
    if (missing.length > 0) {
      problems.push({
        file,
        line,
        specifier,
        message: `${at} exports ${specifier} as ${missing.join(', ')}, which is not in the package`,
      });
      continue;
    }
    if (entry.names.length === 0) continue;
    const types =
      target && typeof target === 'object' && 'types' in target ? target.types : undefined;
    if (typeof types !== 'string') continue;
    const names = exportedNames(join(packageDir, types));
    for (const name of entry.names.filter((n) => !names.has(n))) {
      problems.push({
        file,
        line,
        specifier,
        message:
          name === 'default'
            ? `${specifier} in ${at} has no default export`
            : `${specifier} in ${at} does not export ${name}`,
      });
    }
  }
  return problems;
}

/**
 * Downloads `spec` (such as `ondocs@0.11.0`) from npm into a new temporary directory, unpacked,
 * and returns that directory and the package's.
 * @param {string} spec
 * @returns {{ dir: string, packageDir: string }}
 */
export function fetchPackage(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'ondocs-published-'));
  const output = execFileSync(
    'npm',
    ['pack', spec, '--json', '--ignore-scripts', '--prefer-online', '--pack-destination', dir],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const [packed] = /** @type {{ filename: string }[]} */ (JSON.parse(output));
  if (!packed) throw new Error(`npm pack ${spec} gave no tarball`);
  execFileSync('tar', ['-xzf', join(dir, packed.filename), '-C', dir]);
  return { dir, packageDir: join(dir, 'package') };
}

/**
 * Prints each problem, as a GitHub annotation in a workflow, and returns how many there were.
 * @param {Problem[]} problems
 * @param {'error' | 'warning'} level
 */
function report(problems, level) {
  for (const { file, line, message } of problems) {
    console.log(
      process.env.GITHUB_ACTIONS === 'true'
        ? `::${level} file=${file},line=${String(line)}::${message}`
        : `${file}:${String(line)}: ${message}`,
    );
  }
}

// Run as a script (the real path, so a symlinked checkout still runs it), not imported by a test.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const npmAt = args.indexOf('--npm');
  const spec = npmAt === -1 ? undefined : args[npmAt + 1];
  if (npmAt !== -1 && !spec) throw new Error('--npm needs a package spec, such as ondocs@latest');
  const warn = args.includes('--warn');
  const pages = docFiles(root);
  const imports = pages.flatMap((file) =>
    findImports(readFileSync(join(root, file), 'utf8'), file),
  );
  const fetched = spec ? fetchPackage(spec) : undefined;
  try {
    const packageDir = fetched?.packageDir ?? root;
    const problems = checkImports(imports, packageDir);
    const { name, version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const where = spec ? `${name}@${version} on npm` : `this checkout's ${name}@${version}`;
    const modules = new Set(imports.map((entry) => entry.specifier)).size;
    const statements = imports.filter((entry) => entry.names.length > 0).length;
    if (problems.length === 0) {
      console.log(
        `✓ ${String(modules)} modules, named ${String(imports.length)} times in ${String(pages.length)} pages, and the names in ${String(statements)} import statements resolve in ${where}.`,
      );
    } else {
      report(problems, warn ? 'warning' : 'error');
      console.log(
        `${warn ? '!' : '✗'} ${String(problems.length)} of the docs' imports do not resolve in ${where}.` +
          (warn ? ' The docs are ahead of it until the next release.' : ''),
      );
      if (!warn) process.exitCode = 1;
    }
  } finally {
    if (fetched) rmSync(fetched.dir, { recursive: true, force: true });
  }
}
