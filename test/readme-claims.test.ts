import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const readme = read('README.md');

describe('what the README claims', () => {
  it('states the Node.js version package.json requires', () => {
    const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines;
    const required = /^>=(\d+\.\d+)\.0$/.exec(engines.node)?.[1];
    expect(required).toBeDefined();
    expect(readme).toContain(`Requires Node.js ${String(required)} or later`);
    expect(readme).not.toMatch(/Requires Node \d+ and/);
    expect(read('CONTRIBUTING.md')).toContain(`Node ${String(required)} or later`);
  });

  it('does not say the live demo runs without a model key', () => {
    // The production site answers with OpenAI; only previews and local runs are in mock mode.
    for (const file of [
      'README.md',
      'examples/nextjs/content/docs/local-development.md',
      'examples/nextjs/content/docs/faq.md',
    ]) {
      const text = read(file);
      expect([file, /demo runs in mock mode|website runs in mock mode/.test(text)]).toEqual([
        file,
        false,
      ]);
      expect([file, text.includes('It runs in mock mode, so its answers')]).toEqual([file, false]);
    }
  });

  it('does not call the answers single-turn: the dialog and the endpoint take follow-ups', () => {
    for (const file of [
      'README.md',
      'examples/nextjs/app/(home)/page.tsx',
      'examples/nextjs/content/docs/introduction.md',
      'examples/nextjs/content/docs/faq.md',
      'examples/nextjs/content/docs/limits.md',
    ]) {
      const text = read(file);
      expect([file, /single-turn|each answer stands on its own/i.test(text)]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('calls the benchmark’s memory figure heap, next to what the process grows by', () => {
    // The README no longer has the table; the benchmarks page does, and must say it right.
    const files = ['README.md', 'examples/nextjs/content/docs/benchmarks.md'];
    const headers = files.map((file) => [
      file,
      read(file)
        .split('\n')
        .find((line) => line.startsWith('| Chunks |') && line.includes('Cold load')),
    ]);
    expect(headers.filter(([, header]) => header !== undefined).map(([file]) => file)).toContain(
      'examples/nextjs/content/docs/benchmarks.md',
    );
    for (const [file, header] of headers) {
      if (header === undefined) continue;
      expect([file, header]).toEqual([
        file,
        expect.stringMatching(/Heap retained \|\s+Process memory \(peak\)/),
      ]);
    }
  });

  it('compares it only with tools that exist, in terms it can back', () => {
    for (const file of [
      'README.md',
      'examples/nextjs/app/(home)/page.tsx',
      'examples/nextjs/content/docs/introduction.md',
      'examples/nextjs/content/docs/faq.md',
    ]) {
      const text = read(file);
      // markprompt.com is gone.
      expect([file, text.includes('Markprompt')]).toEqual([file, false]);
      // Algolia's pricing for open source, and Ask AI in VitePress (a 2.0 alpha), are not ours to state.
      expect([file, /Ask AI\*\* is free|free for open-source/i.test(text)]).toEqual([file, false]);
    }
  });

  it('says the integration needs a deployed endpoint and a rate limit, not five lines alone', () => {
    expect(readme).not.toContain('That is the whole integration');
    const setup = readme.slice(
      readme.indexOf('## Pick your setup'),
      readme.indexOf('## For agents'),
    );
    expect(setup).toMatch(/endpoint you deploy as one function/);
    expect(setup).toMatch(/rate-limited by default/);
  });

  it('stays one screen: about 800 to 1,200 words of prose', () => {
    const prose = readme
      .replace(/```[\s\S]*?```/g, '')
      .replace(/<!-- npm-readme:image[\s\S]*?-->/g, '');
    const words = prose.match(/\S+/g)?.length ?? 0;
    expect(words).toBeGreaterThan(800);
    expect(words).toBeLessThan(1200);
  });

  it('leads with what it is now: people and agents, from one static index', () => {
    expect(readme.split('\n')[2]).toBe(
      '**Make your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor. Agent traffic costs you no model tokens.**',
    );
    const manifest = JSON.parse(read('package.json')) as {
      description: string;
      keywords: string[];
    };
    expect(manifest.description).toMatch(/people and by agents/);
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(['mcp', 'mcp-server', 'llms-txt', 'ask-ai', 'ai-search', 'utility']),
    );
  });
});
