# Roadmap

ondocs is built in the open, and this page is the plan: what is in review, what comes next, and what waits until a site needs it. To weigh in, add a reaction or a comment on an item's issue, or start a thread in [Discussions](https://github.com/dgesteves/ondocs/discussions) for something that has no issue yet.

## Merged, in the next release

- Keys typed right after ⌘I are kept while the dialog loads, so the start of a question is no longer lost. [#183](https://github.com/dgesteves/ondocs/pull/183)
- A 1.0 contract: an API report in CI, one meaning per option name (the old names work until 1.0), options checked when the handler is made, and a policy for the index format. [#185](https://github.com/dgesteves/ondocs/pull/185)
- `ondocs index` skips a static site's 404 page. [#200](https://github.com/dgesteves/ondocs/issues/200)
- AI SDK 6 support next to AI SDK 7, and one compatibility statement. [#265](https://github.com/dgesteves/ondocs/pull/265)

## In review

- Evals on real Stack Overflow questions in CI, and `ondocs eval -c` with hit@5 and MRR. [#184](https://github.com/dgesteves/ondocs/pull/184)
- Each plugin guide opens with a no-key try-out, VitePress is named wherever the other plugins are, and the Fumadocs and Nextra guides say why to use ondocs there. [#186](https://github.com/dgesteves/ondocs/pull/186)
- Support tiers on the Limits page (tested in CI, or documented only), and new integrations wait four weeks after launch unless someone asks for one. [#187](https://github.com/dgesteves/ondocs/pull/187)

## Next

### Ask dialog

- The site and the three demos load the dialog while the page is idle, so ⌘I opens at once. [#188](https://github.com/dgesteves/ondocs/issues/188)
- Small fixes across the dialog, the plugins and the CLI. Help wanted. [#189](https://github.com/dgesteves/ondocs/issues/189)
- A check of streaming answers with VoiceOver and NVDA. Help wanted. [#190](https://github.com/dgesteves/ondocs/issues/190)

### Answers and search

- How-to answers include the exact command or config line from the docs. [#191](https://github.com/dgesteves/ondocs/issues/191)
- The relevance gate's default, checked on real questions for 512-dimension embeddings. [#192](https://github.com/dgesteves/ondocs/issues/192)
- The website eval finds the Netlify deploy page again. Help wanted. [#92](https://github.com/dgesteves/ondocs/issues/92)
- Synonyms for docs vocabulary in keyword search. Good first issue. [#55](https://github.com/dgesteves/ondocs/issues/55)

### Endpoint and security

- Safer defaults: answer links only to cited sources, SRI for the script tag, `allowedHosts` for MCP, a CSP snippet, and Turnstile fixes. [#193](https://github.com/dgesteves/ondocs/issues/193)

### MCP

- Claude Code, Cursor and VS Code tested against the endpoint and added to the tested-clients table. Help wanted. [#195](https://github.com/dgesteves/ondocs/issues/195)
- `list_pages` treats a `null` prefix as no prefix. Good first issue. [#196](https://github.com/dgesteves/ondocs/issues/196)

### CLI

- Try ondocs on your own docs in the browser with `ondocs dev`, and see the closest pages after "I don't know". [#197](https://github.com/dgesteves/ondocs/issues/197)
- `ondocs init` in monorepos: locales from the build, host config at the workspace root, pnpm and Yarn commands. [#198](https://github.com/dgesteves/ondocs/issues/198)
- A warning before the index gets too big to deploy. [#199](https://github.com/dgesteves/ondocs/issues/199)

### Plugins and languages

- Starlight translations for the dialog, a translated "I don't know", locale indexes in `ondocs dev` and the MCP route, right-to-left text, and ⌘I on non-Latin keyboards. [#201](https://github.com/dgesteves/ondocs/issues/201)
- llms.txt and the Markdown copies: the remaining gaps. Help wanted. [#202](https://github.com/dgesteves/ondocs/issues/202)

### Docs, examples and demos

- Copyable starters for Docusaurus, Starlight and VitePress, with a zero-key GitHub Pages one first. [#203](https://github.com/dgesteves/ondocs/issues/203)
- A live Nextra demo. [#204](https://github.com/dgesteves/ondocs/issues/204)
- Docs and contributor polish: missing option rows, timeout docs, an architecture map. Help wanted. [#205](https://github.com/dgesteves/ondocs/issues/205)
- A short `ask-index.json` excerpt on the Index file page. Good first issue. [#206](https://github.com/dgesteves/ondocs/issues/206)

### CI

- CI on real docs sites and the oldest supported peers, plus Windows, a browser test that asks a question, and Bun and Deno checks. [#207](https://github.com/dgesteves/ondocs/issues/207)

## Waiting for your feedback

Each of these waits for a site that needs it. The line says what would make it happen; say so on the issue.

- Version-aware answers for Docusaurus sites that index every version: a site with `versions: 'all'` that needs them. [#208](https://github.com/dgesteves/ondocs/issues/208)
- A report of the questions your docs could not answer: sites that want it, and a data-retention design they accept. [#209](https://github.com/dgesteves/ondocs/issues/209)
- Agents-only mode, MCP and llms.txt without the dialog: one site that asks. It is close to possible today. [#210](https://github.com/dgesteves/ondocs/issues/210)
- Agent skills generated from the docs index: adopters who would install them. [#211](https://github.com/dgesteves/ondocs/issues/211)
- Citations that point at one row of an API options table: real questions whose answer is one row. [#212](https://github.com/dgesteves/ondocs/issues/212)
- An agentic answer mode for questions that span pages: evals that show one retrieval pass falls short. [#213](https://github.com/dgesteves/ondocs/issues/213)
- A guide for docs behind a login: a team with private docs that wants Ask or MCP on them. [#214](https://github.com/dgesteves/ondocs/issues/214)
- A lighter dialog for non-React sites, built on Preact: sites where the dialog's download matters. [#215](https://github.com/dgesteves/ondocs/issues/215)
- Search results and page-aware suggestions in the dialog: readers who would rather search than ask. [#216](https://github.com/dgesteves/ondocs/issues/216)
- Indexes for large sites, loaded per section: a site that outgrows one index file. [#217](https://github.com/dgesteves/ondocs/issues/217)
- Stopwords and stemming per language in keyword search: a non-English site on keyword-only search. [#218](https://github.com/dgesteves/ondocs/issues/218)

## Not planned

- Boosting titles and headings in ranking (field weighting): it would force a re-embed, and no published measurement shows a gain yet. Revisit if the real-question evals show a ranking gap.
- New llms.txt output options: the dedicated llms.txt plugins do more, and ondocs steps aside when one is installed.
- New framework, host or model integrations in the first four weeks after launch, unless an issue asks for one. Fixes, and tests that move an integration to "tested in CI", are welcome all along.
- A shared brand, more renames or a shared site kit across ondocs, onsystem and signoff-ui: the listings and redirects depend on the current names.
