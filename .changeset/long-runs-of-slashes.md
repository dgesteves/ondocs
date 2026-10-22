---
'ondocs': patch
---

A long run of slashes in a path, a base or a URL, or of whitespace before a list in a built page, no longer slows ondocs down. On 100,000 of them, `markdownPath`, `rootedPath`, `excluder`, `launcherScript`, the Docusaurus plugin's reading of its docs versions, `loadIndex` on an index with copies of a chunk, and the `.md` copy of a built page each took 14 to 31 s; they now take under 3 ms. The Worker that `ondocs init --host github-pages` writes, and the Cloudflare template, trim `SITE_URL`'s trailing slashes the same way. What they return is unchanged.

Two escapes are complete now. In the `.md` copies, a code block's title that holds both kinds of quote has its backslashes escaped as well as its double quotes, so a title that ends in `\` no longer leaves the fence's `title="…"` open. In `llms.txt`, a backslash in a page's title is escaped, so `C:\` is written `[C:\\](/docs/win.md)`, a link, instead of a line of text.
