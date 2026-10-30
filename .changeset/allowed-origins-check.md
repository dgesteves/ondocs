---
'ondocs': patch
---

`createAskHandler` and `createMcpHandler` check `allowedOrigins` when they are made. An entry that no browser sends as its `Origin`, such as `'https://blog.example.com/'` with a trailing slash, `'https://Blog.Example.com'` or `'https://blog.example.com:443'`, matched no request, so the page on that origin silently got no CORS headers (and a 403 from the MCP endpoint). Each now fails with the origin to write instead. A list holding `'*'` says to pass `'*'` itself, and a string other than `'*'`, which JavaScript code could pass and which was searched as text (`'https://blog.example.com'` let `https://blog.example.co` in), is refused. It also refuses `'null'`, which let a request with `Origin: null` in (a sandboxed iframe or a `file://` page), and `''`, which splitting an empty environment variable gives and which acted as an empty list.
