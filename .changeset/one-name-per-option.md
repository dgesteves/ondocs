---
'ondocs': minor
---

One name per option across the endpoint, the dialog, the script tag, the plugins and the CLI. The old names still work, and say once what they are called now, until 0.10 removes them. [Upgrading](https://ondocs.vercel.app/docs/upgrading) has the table, old name to new.

- **`launcher`** replaces `buttonLabel` in `mountAskDialog`, `window.Ondocs.mount()` and the plugins' `dialog` options, each locale's included, as `AskDialog` already called it. It takes `true`, a label, or `false`. On the script tag, `data-launcher` replaces `data-button-label`.
- **`theme: 'auto'`** replaces `theme: 'system'` on `AskDialog`, the name the plugins and the script tag use.
- **`retrieval.maxContextChars`** replaces `maxContextChars` on `createAskHandler`, next to `topK`. The answer cache keeps its keys.
- **`ondocs init --site-name`** replaces `--name`, as `siteName` names it in the handlers.

Two defaults of `AskDialog` change to match the plugins and the script tag. It opens with ⌘I or Ctrl+I, so ⌘K stays with the site's search; `shortcut="k"` keeps ⌘K. Its default theme, `auto`, follows `data-theme="light"` or `"dark"` on `<html>` when the page sets one, and the system's setting otherwise, as before.
