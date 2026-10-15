import type { ReactNode } from 'react';

import { mcpInstallLinks } from '../mcp-install';

export interface McpInstallProps {
  /** The MCP server's absolute URL, e.g. `https://docs.example.com/api/mcp`. */
  url: string;
  /** Its name in the client, e.g. `acme-docs`. */
  name: string;
  /** Extra classes on the install links, e.g. your theme's button classes. */
  buttonClassName?: string;
}

/**
 * How to connect an AI tool to the docs' MCP server: "Add to Cursor", "Add to VS Code" and "Add to
 * Claude" links, the Claude Code, Codex and Gemini CLI commands, where to add it in ChatGPT, and
 * the JSON and Codex's TOML for any other client. Plain markup with `ask-mcp-*` classes, so a docs
 * theme styles it as its own content; it needs no JavaScript.
 */
export function McpInstall({ url, name, buttonClassName }: McpInstallProps): ReactNode {
  const links = mcpInstallLinks({ url, name });
  const button = ['ask-mcp-link', buttonClassName].filter(Boolean).join(' ');
  return (
    <div className="ask-mcp">
      <p>
        These docs are an MCP server at <code>{links.url}</code>. Connect your AI tool to it, and
        its agent can search and read them.
      </p>
      <p className="ask-mcp-links">
        <a className={button} href={links.cursor}>
          Add to Cursor
        </a>{' '}
        <a className={button} href={links.vscode}>
          Add to VS Code
        </a>{' '}
        <a className={button} href={links.claude}>
          Add to Claude
        </a>
      </p>
      <p>Claude Code:</p>
      <pre>
        <code>{links.claudeCode}</code>
      </pre>
      <p>Codex:</p>
      <pre>
        <code>{links.codex}</code>
      </pre>
      <p>Gemini CLI:</p>
      <pre>
        <code>{links.gemini}</code>
      </pre>
      <p>ChatGPT: add a custom MCP server with this URL at chatgpt.com/plugins.</p>
      <details>
        <summary>Other clients</summary>
        <pre>
          <code>{links.json}</code>
        </pre>
        <p>Codex, in ~/.codex/config.toml:</p>
        <pre>
          <code>{links.codexToml}</code>
        </pre>
      </details>
    </div>
  );
}
