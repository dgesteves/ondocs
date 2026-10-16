---
'ondocs': minor
---

`AskButton` from `ondocs/react` is an "Ask AI" button with the shortcut on it, and the `AskDialog` it opens, which takes the same props. Put it in your site's header. The shortcut (⌘I, or `shortcut="k"` for ⌘K) opens the dialog before its code has loaded, and so do `openAskDialog()` and any element with `data-ondocs-open`. It renders the plugins' navbar button, so `ondocs/embed/button.css` gives it their look: filled with the accent, ⌘ or Ctrl by platform without a hydration mismatch, and only the icon on a phone. `children` sets its label and `className` adds your classes. Before, a Next.js site wrote this itself.

`poweredBy` on `AskButton` adds a credit line, off by default, to the end of the dialog's footer: "Answers by ondocs.", whose link opens ondocs.vercel.app in a new tab. `true` shows the new `poweredBy` label, so it is translated with the dialog's other labels. Or pass your own words with `{ondocs}` where the link goes, as in `poweredBy="Answers and docs MCP by {ondocs}."`. A `footer` of your own replaces it.

`createMcpHandler` takes a `version`, which `initialize` and `server/discover` report beside `name`. A server named after your docs can report their version instead of ondocs's: `{ name: 'acme-docs', version: '2.4.0' }`. The default is still the version of ondocs that serves it, and an empty `name` or `version` now falls back to its default.
