---
'ondocs': patch
---

`ondocs index` without `--embedding` now embeds with OpenAI's `text-embedding-3-small` at 512 dimensions, as the plugins do, with `OPENAI_API_KEY` or through AI Gateway. Before, it built the model's full 1,536, so a site that followed the README's Next.js line shipped an index about twice the size: 2.93 MB against 1.54 MB for docusaurus.io's 1,070 chunks. `--dimensions` sets another size, and a model you name with `--embedding` is still built at its own size unless `--dimensions` gives one.

An index the CLI built at 1,536 dimensions needs nothing: the endpoints, `ondocs dev` and `ondocs eval` read the size from the index, and `ondocs index --check` without flags still passes on it. The next `ondocs index` embeds every chunk again, once, at 512 (as a first build does), and reuses those vectors after that. To keep the full size, pass `--dimensions 1536`; that build also embeds every chunk once. An endpoint that sets `dimensions` in `embeddingProviderOptions` by hand must set the size of the index it serves.

A plugin build without a model key now also says what its keyword-only index means: the Ask box answers only questions that use enough of the docs' own words, the MCP endpoint `init` writes searches by keywords either way, and the key belongs where the site builds as well as where the endpoint runs. `embedding: 'none'` builds the same index without the warning.

Over a mock index (`-e mock`), a similarity now counts only from a chunk that shares two of the question's words, not one: a single common word in a short section let off-topic questions through. On docusaurus.io's docs, 15 off-topic Stack Overflow titles about git, Bash, SQL and Java got 6 quoted answers instead of 10, as many as from a keyword-only index; on the ondocs docs, 4 instead of 7. Of the 22 answerable questions in the sample eval of docusaurus.io's docs, one more is refused, one that had been answered from a page that does not answer it, and the right page is in the top three for 17 instead of 16. `retrieval.similarityNeedsKeyword` now also takes the number of words: `true` is one, as before.
