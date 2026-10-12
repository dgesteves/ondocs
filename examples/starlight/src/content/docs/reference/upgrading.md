---
# Generated from examples/nextjs/content/docs/upgrading.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Upgrading'
description: 'The options each minor version renames, old name to new, and the defaults that change with them.'
sidebar:
  order: 38
---

Before 1.0, a minor version can rename an option. The old name keeps working until the next minor version, and says once what it is called now: in the build's output for the plugins, in the server's log for the endpoint, in the terminal for the CLI, and in the browser's console for the dialog.

## 0.9: one name per option

0.9 gives each option one name across `createAskHandler`, `AskDialog`, `mountAskDialog`, the script tag, the plugins and the CLI. The old names still work in 0.9, with a warning, and 0.10 removes them.

| Where                                                                                 | Before 0.9                                 | From 0.9                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| The plugins' `dialog` and `dialog.locales`, `mountAskDialog`, `window.Ondocs.mount()` | `buttonLabel: 'Ask'`, `buttonLabel: false` | `launcher: 'Ask'`, `launcher: false`   |
| The script tag                                                                        | `data-button-label="Ask"`                  | `data-launcher="Ask"`                  |
| `AskDialog`                                                                           | `theme="system"`                           | `theme="auto"`                         |
| `createAskHandler`                                                                    | `maxContextChars: 6000`                    | `retrieval: { maxContextChars: 6000 }` |
| `ondocs init`                                                                         | `--name "Acme Docs"`                       | `--site-name "Acme Docs"`              |

`launcher` takes the same values `buttonLabel` did, and `true` for the default label. When a site sets both names, the new one wins.

Two defaults change in `AskDialog`, so that it matches the plugins and the script tag:

- **The shortcut is ⌘I, or Ctrl+I outside macOS.** It was ⌘K. ⌘K stays with the site's search, and text fields keep ⌘I for italic. Pass `shortcut="k"` to keep ⌘K, as on a site whose only search is this dialog.
- **`theme="auto"`, the default, follows `data-theme` on `<html>`.** A page with `data-theme="dark"` gets the dark dialog whatever the system's setting, as with the plugins and the script tag. A page without one still follows the system, and `theme="light"` or `"dark"` still pins one.

To find the old names in a site:

```sh
git grep -nE 'buttonLabel|data-button-label|theme="system"|maxContextChars|init --name'
```

`maxContextChars` is fine where it is already inside `retrieval`.
