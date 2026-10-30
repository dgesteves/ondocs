---
'ondocs': patch
---

`ondocs index` no longer drops MDX text that only looks like an import or export. Any line starting with `import ` or `export ` was read as one, with the lines after it up to a blank line, so a wrapped paragraph such as "you can\nexport the site as static files" lost its second half from the index and the `.md` copies. As in MDX, an import or export now counts only where a block starts: on the first line, or after a blank line or a heading. An export holding a template string is now dropped whole, where its backticks used to leave part of it in the text.
