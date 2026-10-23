---
'ondocs': patch
---

The MCP endpoint trims the trailing slashes of `list_pages`'s `prefix` and `fetch`'s `id` in linear time, and so does the ask endpoint where it rewrites a follow-up question (the whitespace before the citations in earlier answers) and in `normalizeQuestion`, the answer cache's key (trailing punctuation): long runs of slashes, whitespace or punctuation were slow. What they return is unchanged. `prefix` and `id` are now limited to the 2,048 characters the tools' schema has always advertised: a longer one is a tool error the agent reads, `id is limited to 2048 characters.`, as a `query` over `maxQueryLength` is.

In the `.md` copies' links and in `llms.txt`, `[`, `]` and `\` in a link's text are escaped only outside code spans, where Markdown reads no escapes. A link around `<code>C:\dir\</code>` showed `C:\\dir\\` in 0.14.0, and one around `<code>arr[0]</code>` showed `arr\[0\]`; both show as written now, and still link.
