---
'ondocs': patch
---

`mcpInstallLinks` also returns `codex` (`codex mcp add <name> --url <url>`), `codexToml` (the `[mcp_servers.<name>]` entry for Codex's `~/.codex/config.toml`) and `gemini` (`gemini mcp add --transport http --scope user <name> <url>`; without `--transport http`, Gemini CLI takes the URL for a command and cannot connect). `McpInstall` from `ondocs/react`, `@theme/OndocsMcp` and `McpInstall.astro` show the Codex and Gemini CLI commands, and Codex's TOML under "Other clients", and `ondocs dev` prints all three commands.
