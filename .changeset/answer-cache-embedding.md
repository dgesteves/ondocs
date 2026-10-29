---
'ondocs': patch
---

The answer cache starts fresh when the same pages are embedded, or embedded with another model or size. Its key covered the index's content hash, which counts the pages' text but not their vectors, so with a shared store (`upstashAnswerCache`) a deploy that moved from a keyword-only index to an embedded one, or from `text-embedding-3-small` to `-large`, kept serving the answers the old index found for up to `ttlSeconds`. Keys for keyword-only retrieval are unchanged; a site with embeddings starts its cache once more after upgrading.
