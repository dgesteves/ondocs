/**
 * How to add a remote MCP server to the clients people use, from its name and URL: one-click
 * install links for Cursor, VS Code and claude.ai, the Claude Code, Codex and Gemini CLI commands,
 * Codex's TOML, and the JSON other clients take. The formats are the clients' documented ones:
 * Cursor's install links (cursor.com/docs/context/mcp/install-links), VS Code's
 * `vscode:mcp/install` URL, claude.ai's prefilled connector form, `claude mcp add --transport
 * http`, `codex mcp add --url` and Codex's `[mcp_servers.<name>]` table, and `gemini mcp add
 * --transport http`. Runtime-neutral: what the docs components render, and what a site can render
 * itself.
 */

export interface McpInstallOptions {
  /** The server's absolute URL, e.g. `https://docs.example.com/api/mcp`. */
  url: string;
  /** A short name for it in the client, e.g. `acme-docs`. Letters, digits, `-` and `_` are safest. */
  name: string;
}

export interface McpInstallLinks {
  url: string;
  name: string;
  /** Opens Cursor's install prompt for the server. */
  cursor: string;
  /** Opens VS Code's install prompt for the server. */
  vscode: string;
  /** The same for VS Code Insiders. */
  vscodeInsiders: string;
  /** Opens claude.ai's "Add custom connector" form, filled in; it applies to Claude Desktop too. */
  claude: string;
  /** Adds the server to Claude Code, for the current project. */
  claudeCode: string;
  /** Adds the server to Codex, which keeps it in `~/.codex/config.toml`. */
  codex: string;
  /** The server's entry in Codex's `~/.codex/config.toml`: `[mcp_servers.<name>]` and `url`. */
  codexToml: string;
  /**
   * Adds the server to Gemini CLI, for the user. `--transport http` is needed: without it, Gemini
   * CLI takes the URL for a command to run (stdio) and cannot connect.
   */
  gemini: string;
  /**
   * An `mcpServers` entry, `{ "mcpServers": { name: { "type": "http", "url": … } } }`, the shape of
   * Claude Code's `.mcp.json`, Cursor's `mcp.json`, Gemini CLI's `settings.json` and most other
   * clients' files.
   */
  json: string;
  /** `.vscode/mcp.json` for VS Code: `{ "servers": { name: { "type": "http", "url": … } } }`. */
  vscodeJson: string;
}

/** Base64 of a string's UTF-8 bytes, in browsers and Node.js alike. */
function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `name` as a client config key and command argument: lowercase, `[a-z0-9_-]`, never empty. */
export function mcpServerName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z\d_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'docs';
}

/** Quotes a shell argument when it needs it. */
const shellArgument = (value: string): string =>
  /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

/**
 * The ways to add the MCP server at `url` to Cursor, VS Code, Claude Code, Codex, Gemini CLI and
 * any client that reads an `mcp.json`.
 */
export function mcpInstallLinks(options: McpInstallOptions): McpInstallLinks {
  const name = mcpServerName(options.name);
  const { url } = options;
  if (!/^https?:\/\//i.test(url)) {
    throw new TypeError(`The MCP server URL must be absolute (got ${JSON.stringify(url)}).`);
  }
  const vscodeConfig = encodeURIComponent(JSON.stringify({ name, type: 'http', url }));
  return {
    url,
    name,
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(base64(JSON.stringify({ url })))}`,
    vscode: `vscode:mcp/install?${vscodeConfig}`,
    vscodeInsiders: `vscode-insiders:mcp/install?${vscodeConfig}`,
    claude: `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(options.name)}&connectorUrl=${encodeURIComponent(url)}`,
    claudeCode: `claude mcp add --transport http ${shellArgument(name)} ${shellArgument(url)}`,
    codex: `codex mcp add ${shellArgument(name)} --url ${shellArgument(url)}`,
    // The URL as a JSON string is a TOML basic string too: quoted, with `"` and `\` escaped.
    codexToml: `[mcp_servers.${name}]\nurl = ${JSON.stringify(url)}`,
    gemini: `gemini mcp add --transport http --scope user ${shellArgument(name)} ${shellArgument(url)}`,
    json: JSON.stringify({ mcpServers: { [name]: { type: 'http', url } } }, null, 2),
    vscodeJson: JSON.stringify({ servers: { [name]: { type: 'http', url } } }, null, 2),
  };
}
