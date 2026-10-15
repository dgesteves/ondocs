import { mcpInstallLinks } from 'ondocs';

import { CopyIcon } from '../icons';

/**
 * The first screen's line for coding agents: install links for Cursor and VS Code, the Claude
 * Code and Codex commands to copy, and the MCP URL. Static HTML: the copy buttons work through the
 * delegated handler in `CopyButtons`, so the strip adds no client code.
 */
export function AgentStrip({ url, name }: { url: string; name: string }) {
  const links = mcpInstallLinks({ url, name });
  const commands = [
    { label: 'Claude Code', command: links.claudeCode },
    { label: 'Codex', command: links.codex },
  ];
  return (
    <div className="agent-strip">
      <p className="agent-strip-label">For coding agents:</p>
      <ul className="agent-strip-clients">
        <li>
          <a className="agent-chip" href={links.cursor} aria-label="Add these docs to Cursor">
            Cursor
          </a>
        </li>
        <li>
          <a className="agent-chip" href={links.vscode} aria-label="Add these docs to VS Code">
            VS Code
          </a>
        </li>
        {commands.map(({ label, command }) => (
          <li key={label}>
            <button
              type="button"
              className="agent-chip"
              data-copy={command}
              aria-label={`Copy the ${label} command: ${command}`}
              title={command}
            >
              <span className="copy-label">{label}</span>
              <CopyIcon />
            </button>
          </li>
        ))}
      </ul>
      <p className="agent-strip-url">
        <code>{links.url}</code>
        <button
          type="button"
          className="copy-button"
          data-copy={links.url}
          aria-label="Copy the MCP URL"
          title="Copy the MCP URL"
        />
      </p>
    </div>
  );
}
