import { describe, expect, it } from 'vitest';

import { mcpInstallLinks, mcpServerName } from '../src';

describe('mcpInstallLinks', () => {
  const links = mcpInstallLinks({ url: 'https://docs.acme.dev/api/mcp', name: 'Acme Docs' });

  it('makes Cursor’s install link, with the server entry as base64 JSON', () => {
    const url = new URL(links.cursor);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      'cursor://anysphere.cursor-deeplink/mcp/install',
    );
    expect(url.searchParams.get('name')).toBe('acme-docs');
    expect(JSON.parse(atob(url.searchParams.get('config') ?? ''))).toEqual({
      url: 'https://docs.acme.dev/api/mcp',
    });
  });

  it('makes VS Code’s install URL, an HTTP server entry with its name', () => {
    expect(links.vscode.startsWith('vscode:mcp/install?')).toBe(true);
    expect(
      JSON.parse(decodeURIComponent(links.vscode.slice('vscode:mcp/install?'.length))),
    ).toEqual({
      name: 'acme-docs',
      type: 'http',
      url: 'https://docs.acme.dev/api/mcp',
    });
    expect(links.vscodeInsiders.startsWith('vscode-insiders:mcp/install?')).toBe(true);
  });

  it('fills in claude.ai’s connector form, and makes the Claude Code command and JSON', () => {
    const claude = new URL(links.claude);
    expect(claude.origin + claude.pathname).toBe('https://claude.ai/customize/connectors');
    expect(Object.fromEntries(claude.searchParams)).toEqual({
      modal: 'add-custom-connector',
      connectorName: 'Acme Docs',
      connectorUrl: 'https://docs.acme.dev/api/mcp',
    });
    expect(links.claudeCode).toBe(
      'claude mcp add --transport http acme-docs https://docs.acme.dev/api/mcp',
    );
    expect(JSON.parse(links.json)).toEqual({
      mcpServers: { 'acme-docs': { type: 'http', url: 'https://docs.acme.dev/api/mcp' } },
    });
    expect(JSON.parse(links.vscodeJson)).toEqual({
      servers: { 'acme-docs': { type: 'http', url: 'https://docs.acme.dev/api/mcp' } },
    });
  });

  it('makes the Codex and Gemini CLI commands, and the table for Codex’s config.toml', () => {
    expect(links.codex).toBe('codex mcp add acme-docs --url https://docs.acme.dev/api/mcp');
    expect(links.codexToml).toBe('[mcp_servers.acme-docs]\nurl = "https://docs.acme.dev/api/mcp"');
    // Without --transport http, Gemini CLI takes the URL for a command to run, over stdio.
    expect(links.gemini).toBe(
      'gemini mcp add --transport http --scope user acme-docs https://docs.acme.dev/api/mcp',
    );
  });

  it('quotes a URL the shell would split, and refuses a relative one', () => {
    const quoted = mcpInstallLinks({ url: "https://x.dev/mcp?a=1&b='2'", name: 'x' });
    expect(quoted.claudeCode).toBe(
      "claude mcp add --transport http x 'https://x.dev/mcp?a=1&b='\\''2'\\'''",
    );
    expect(quoted.codex).toBe("codex mcp add x --url 'https://x.dev/mcp?a=1&b='\\''2'\\'''");
    expect(quoted.gemini).toBe(
      "gemini mcp add --transport http --scope user x 'https://x.dev/mcp?a=1&b='\\''2'\\'''",
    );
    expect(mcpInstallLinks({ url: 'https://x.dev/mcp?q="a\\b"', name: 'x' }).codexToml).toBe(
      '[mcp_servers.x]\nurl = "https://x.dev/mcp?q=\\"a\\\\b\\""',
    );
    expect(() => mcpInstallLinks({ url: '/api/mcp', name: 'x' })).toThrow(/absolute/);
  });

  it('names servers as clients accept them', () => {
    expect(mcpServerName('Café Docs!')).toBe('cafe-docs');
    expect(mcpServerName('my_docs-2')).toBe('my_docs-2');
    expect(mcpServerName('???')).toBe('docs');
  });
});
