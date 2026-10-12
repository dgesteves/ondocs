import { mcpInstallLinks } from 'ondocs';

import { codeBlock } from '../lib/highlight';

/**
 * How to add an MCP server to Cursor, VS Code, Claude, Claude Code and ChatGPT: the markup and
 * words of `McpInstall` from ondocs/react, made from the same `mcpInstallLinks`, with the site's
 * code blocks. It is a server component because ondocs/react is a client module: importing it
 * into a docs page adds the dialog's code to every page's first load.
 */
export async function McpInstall({ url, name }: { url: string; name: string }) {
  const links = mcpInstallLinks({ url, name });
  const [claudeCode, json] = await Promise.all([
    codeBlock(links.claudeCode, 'sh'),
    codeBlock(links.json, 'json'),
  ]);
  return (
    <div className="ask-mcp">
      <p>
        These docs are an MCP server at <code>{links.url}</code>. Connect your AI tool to it, and
        its agent can search and read them.
      </p>
      <p className="ask-mcp-links">
        <a className="ask-mcp-link button button-secondary" href={links.cursor}>
          Add to Cursor
        </a>
        <a className="ask-mcp-link button button-secondary" href={links.vscode}>
          Add to VS Code
        </a>
        <a className="ask-mcp-link button button-secondary" href={links.claude}>
          Add to Claude
        </a>
      </p>
      <p>Claude Code:</p>
      <div dangerouslySetInnerHTML={{ __html: claudeCode }} />
      <p>ChatGPT: add a custom MCP server with this URL at chatgpt.com/plugins.</p>
      <details>
        <summary>Other clients</summary>
        <div dangerouslySetInnerHTML={{ __html: json }} />
      </details>
    </div>
  );
}
