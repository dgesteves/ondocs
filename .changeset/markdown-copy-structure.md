---
'ondocs': patch
---

The `.md` copies, `llms-full.txt` and the text the plugins index from built pages keep more of a page's structure:

- A loose list, which remark and markdown-it write as `<li><p>` when a list has blank lines between its items, no longer has a lone `-` above each item. The three demos' `llms-full.txt` had three each. A numbered list counts from its `start`, so steps that a code block splits go on from 3.
- Each tab panel starts with its tab's label (Docusaurus and Starlight tabs, VitePress code groups), and the list of tab names goes, so an agent can tell the npm command from the pnpm one, in the copies and in what the MCP server's `search` and `fetch` return.
- An admonition (a Docusaurus admonition, a Starlight aside, a VitePress custom block) is a quote that starts with its type and title in the copies, as `> **Danger: Take care**`. The index text reads `Danger: Take care` where the title is not just the type.
- The copies keep the backticks in inline code (`` a`b ``) and the code in headings (``## The `ask` option``), put a code block's title on its fence (`` ```js title="docusaurus.config.js" ``, quotes and all), keep the code blocks inside a quote, which were dropped, and start a paragraph at a `<details>` that follows an unclosed `<p>`, as minified HTML has it: the Docusaurus demo read "chatgpt.com/plugins.Other clients".
- A page's copy keeps an H1 that is not its title, such as a Markdown file's "Installing Acme on Linux" under a frontmatter `title` of "Setup". Before, any leading H1 was dropped. An H1 that repeats the title is still written once, also when the title keeps a permalink from the page's `<h1>` ("Installation¶", "Installation #") or reads as Markdown (`The <Ask> component`, `__init__`).
- `llms.txt` links are encoded when there is no site URL too: `/guides/getting%20started.md`, not `/guides/getting started.md`, which is not a Markdown link. Parentheses are encoded with or without one.
- When a site's docs are a section called "Docs", as in Docusaurus with docs at `/docs/`, its other top-level pages are listed under "Pages" instead of in that section.

The index text changes on built pages with loose lists, tabs, an admonition whose title is not its type, inline code that holds a backtick, or a `<details>` after an unclosed paragraph. Until the index is built again, `ondocs index --check` reports those chunks as changed. The next plugin build or `ondocs index` embeds them again and reuses the vectors of every other chunk. An index built from Markdown or MDX files is unchanged.
