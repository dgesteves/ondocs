---
'ondocs': patch
---

Fixes from following the docs on a fresh install:

- `ondocs index --llms-txt` resolves the relative links and images in Markdown files from each file's folder, so they work from the page's `.md` copy and from `llms-full.txt`. Before, `content/index.md`, copied to `/docs.md`, kept `./setup.md` as written, which pointed at `/setup.md` there instead of `/docs/setup.md`. A link to another page's file goes to that page's copy. An HTML `index.html` page's links are now resolved from its folder too.
- `ondocs init` no longer takes a `docusaurus deploy` script for GitHub Pages: every new Docusaurus site has one, wherever it is hosted. With no host config, init asks, as the docs say. The `gh-pages` package, a script that runs it, and a Pages workflow still count.
- For GitHub Pages, init asks for the site's URL when the config has a template's placeholder, such as `https://your-docusaurus-site.example.com`, and warns when it keeps one: the Worker reads the index from that URL.
- When the site's config already adds the ondocs plugin, init's next steps no longer say to add it. On GitHub Pages they say which options to give it.
- On a site with no config to detect, the error now says how to name a plain HTML site's folder, as in `npx ondocs init --out public`, and names the folder when it finds one with HTML files.
- For a site indexed with `ondocs index` (Next.js and static sites), init says that a keyword-only index needs `-e none` when there is no key. The plugins build one without a key, but the CLI stops.
