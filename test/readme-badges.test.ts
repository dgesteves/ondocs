import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mcpInstallLinks } from '../src/mcp-install';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const top = read('README.md').split('<!-- npm-readme:video -->')[0] ?? '';
const site = mcpInstallLinks({ name: 'ondocs', url: 'https://ondocs.vercel.app/api/mcp' });
const param = (link: string, name: string) => new URL(link).searchParams.get(name) ?? '';
const link = (pattern: RegExp) => pattern.exec(top)?.[1] ?? '';

describe("the README's badges", () => {
  // GitHub drops cursor:// and vscode: links, so the badges use each editor's https redirect,
  // which must install what mcpInstallLinks gives the site's own MCP endpoint.
  it("add this site's MCP server to Cursor, VS Code, Claude Code and Claude", () => {
    const cursor = link(/\((https:\/\/cursor\.com\/en\/install-mcp\?[^)\s]+)\)/);
    expect(param(cursor, 'name')).toBe(site.name);
    expect(JSON.parse(Buffer.from(param(cursor, 'config'), 'base64').toString('utf8'))).toEqual(
      JSON.parse(Buffer.from(param(site.cursor, 'config'), 'base64').toString('utf8')),
    );

    const vscode = link(/\((https:\/\/insiders\.vscode\.dev\/redirect\/mcp\/install\?[^)\s]+)\)/);
    const { name, ...server } = JSON.parse(decodeURIComponent(site.vscode.split('?')[1] ?? '')) as {
      name: string;
    };
    expect(param(vscode, 'name')).toBe(name);
    expect(JSON.parse(param(vscode, 'config'))).toEqual(server);

    expect(top).toContain(`](${site.claude})`);
    expect(top).toContain('](https://ondocs.vercel.app/docs/mcp)');
    expect(read('examples/nextjs/content/docs/mcp.md')).toContain(site.claudeCode);
  });

  it('deploy the Worker template that is in the repository', () => {
    const deploy = link(/\((https:\/\/deploy\.workers\.cloudflare\.com\/\?url=[^)\s]+)\)/);
    const path = /github\.com\/dgesteves\/ondocs\/tree\/main\/(.+)$/.exec(
      param(deploy, 'url'),
    )?.[1];
    expect(path).toBe('templates/cloudflare-worker');
    expect(existsSync(join(root, path ?? '', 'wrangler.jsonc'))).toBe(true);
  });
});
