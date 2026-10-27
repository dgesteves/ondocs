---
'ondocs': minor
---

**Answers now link only to their sources by default.** `links` on `AskDialog`, `AskAnswer`, the plugins' `dialog` and the script tag's `data-links` defaults to `'sources'`: a link in an answer stays a link only when it points at one of the answer's source pages, at any anchor, and any other link shows as its text. Citations link as before. To upgrade with answers' links to other pages kept, set `links: 'all'` (`dialog: { links: 'all' }` in the plugins, `data-links="all"` on the script tag), the default until now.

Hardening, all opt-in or invisible to readers:

- With the bot check on, a question passed in as the dialog opens (`question`, `data-ondocs-open="…"`, `openAskDialog(q)`, `window.Ondocs.open(q)`) waits for the Turnstile widget and its token. It was sent without one, and the endpoint refused it with `challenge_required` until the reader pressed Retry.
- The HTML loader leaves out elements readers never see: those with the `hidden` attribute, or an inline `display: none` or `visibility: hidden`. Inactive tab panels, `hidden="until-found"`, what a collapsed `<details>` holds and `aria-hidden` text are kept.
- `turnstile({ secretKey, hostnames })` refuses a token solved on a hostname not in the list, for a widget that lists several.
- `createMcpHandler({ allowedHosts })` answers only requests whose `Host` is listed, for docs on a private network or on localhost: an `Origin` check alone reads a request after DNS rebinding as the endpoint's own.
- The script tag takes `data-dialog-integrity`, the Subresource Integrity hash of `embed-dialog.global.js`, so a page that pins `embed.global.js` with `integrity` pins the dialog's file too. See "Pin the script tag" in the security guide.
- `ondocs dev` lets a browser MCP client send `Mcp-Method` and `Mcp-Name` in its preflight, lets the dialog on another port read `Retry-After`, and explains a refused `Origin: null` instead of suggesting a flag that refuses it too.
