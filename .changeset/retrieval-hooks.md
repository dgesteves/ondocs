---
'ondocs': minor
---

`createAskHandler` takes two retrieval hooks. `retrieval.rerank(question, hits, { signal, index })` puts the candidates in a new order before `topK` is applied, with the AI SDK's `rerank()` and a reranking model, or to boost sections. `retrieval.retrieve(query, search, context)` finds the candidates instead of the built-in retrieval, with `search` to call it. The relevance gate decides after both: each hit's chunk is measured again against the question, so a hook cannot make an off-topic page count. A hook that throws is reported to `onError` and skipped. Without hooks, retrieval is unchanged. `gateHits`, the gate on hits from anywhere, is exported from `ondocs`.
