---
'ondocs': patch
---

An index without embeddings (`-e none`, or a plugin build with no model key) answers more plain questions: its keyword gate defaults to `minKeywordCoverage: 0.4` instead of 0.5, since nothing else can catch a question that one word the docs never use holds under 0.5. On real questions about Docusaurus, Astro and Vitest, it refuses 13 to 17% of the answerable ones instead of 26 to 39%, and lets one or two more of 15 off-topic questions reach the model. An index with embeddings keeps 0.5, and `retrieval: { minKeywordCoverage }` still sets it.

The MCP `search` tool no longer returns a bare empty list: with no results it adds a `note` that tells the agent to search again with fewer or different keywords, or to call `list_pages`, before concluding the docs do not cover the topic.
