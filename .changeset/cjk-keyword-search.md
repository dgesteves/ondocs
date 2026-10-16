---
'ondocs': patch
---

Keyword search finds Chinese, Japanese and Korean text. A run of it with no space was one term, which a question matched only where a page had the same run, so every keyword path (MCP search without an `embeddingModel`, `-e none` and `-e mock` indexes, the keyword half of hybrid search) found almost nothing: `怎么安装插件？` was refused on a page headed 安装插件. A run is now split into overlapping pairs of characters, without question words such as 怎么, 如何, どこ and 어떻게, and kana keep their voicing marks (`デプロイ` was folded to `テフロイ`). On the docs' five-page test site, a `-e none` index now answers 7 of 8 Chinese questions with the right page first, up from 1, and 6 of 8 Japanese ones, up from 1, and still refuses all 6 off-topic questions in each language.

A CJK paragraph longer than a chunk is now cut at `。`, `！`, `？`, `；` or `：`, and the next chunk repeats the end of the one before, as in other languages; before, it was cut mid-sentence with no overlap. A hard cut never splits a surrogate pair, so a chunk no longer ends or starts with half an emoji.

The keyword side is built when an index loads, so an index needs no rebuild for it. One with a CJK paragraph longer than a chunk is cut differently now, so `ondocs index --check` fails on it until you rebuild it, which embeds only the changed chunks again. An `-e mock` index of CJK pages keeps the vectors of the chunks that did not change, made from the old terms: delete it (and `node_modules/.cache/ondocs` for a plugin's build) and build it again. Indexes of other languages are unchanged.
