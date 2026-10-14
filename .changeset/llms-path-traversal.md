---
'ondocs': patch
---

A page's URL can no longer write files outside the `llms.txt` folder. `ondocs index --llms-txt <dir>` wrote each page's `.md` copy at its URL's path, so a frontmatter `url: /../../AGENTS` (or `/%2e%2e/%2e%2e/AGENTS`) replaced the project's `AGENTS.md`. A URL with a `.` or `..` segment, as written or percent-encoded, now fails the build, naming the page, as a `javascript:` URL does; this includes relative ones such as `../page`, which used to be accepted. The plugins and the CLI also check that every `.md` copy, and every page they link to its copy, is inside the output folder, and skip any other with a warning.
