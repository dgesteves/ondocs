---
'ondocs': minor
---

ondocs works with AI SDK 6 as well as 7: the `ai` peer range is now `^6.0.16 || ^7.0.95`, and `@ai-sdk/openai`'s `^3.0.0 || ^4.0.0`, so a project on AI SDK 6 can add ondocs without moving to 7. The endpoint streams each answer through the result's own `toUIMessageStream()`, which both have, and passes the instructions, the end-of-answer callback and `generation.telemetry` by AI SDK 6's names as well as 7's, which AI SDK 7 reads first. `ondocs/mock` and Workers AI embeddings use model classes both read, and the type declarations name no type that AI SDK 6 lacks, so they typecheck there without `skipLibCheck`. AI SDK 6 has no timeout for the model's first word, so there an answer's default timeout is the 90 seconds for the whole answer. [Compatibility](https://ondocs.vercel.app/docs/getting-started#compatibility) lists what CI runs.

ondocs now needs Node.js 22.13 or later (`engines`: `>=22.13.0`), up from 22.12: if you build your site on Node.js 22.12, update Node.js first. On 22.12, loading an ES module with `require()` prints an experimental warning, and one that fails to load ends the process.
