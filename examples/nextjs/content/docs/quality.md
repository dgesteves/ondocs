---
title: Measure and improve answers
description: Score retrieval in CI with ondocs eval, collect readers' feedback, and keep a log of the questions your docs do not answer.
section: Guides
order: 26
---

Three tools tell you how well your docs answer: `ondocs eval`, which scores retrieval against questions whose answers you know, in CI; readers' thumbs up and down in the dialog; and a log of the questions the docs did not answer, the content gaps to write next. None of them sends anything anywhere unless you wire it to.

## Score retrieval with eval

Write down questions your readers ask, with the pages that answer them, and a few your docs should not answer:

```yaml
# ask-eval.yaml
thresholds:
  hit@3: 0.8
  refusalRecall: 1

questions:
  - question: How do I deploy to GitHub Pages?
    expect: /docs/deployment/github-pages
  - question: How do I add a tip or warning callout?
    expect: [/docs/markdown-features/admonitions, /docs/markdown-features]
  - question: Why is each vector stored as int8?
    expect: /docs/index-format#vectors
  - question: What will the weather be in Lisbon tomorrow?
    unanswerable: true
```

Then run it against the index your build wrote:

```sh
npx ondocs eval ask-eval.yaml --index build/ask-index.json
```

For each question it prints where the first expected page came among the pages found, or that the gate refused it, with the best keyword coverage and similarity it saw. Then come the scores:

- **hit@1** and **hit@3**: the share of answerable questions whose expected page came first, or in the top three. An `expect` with a `#anchor` must match that section.
- **Refusal precision**: of the questions the gate refused, the share that should have been refused. Under 1, the gate turns away questions your docs answer.
- **Refusal recall**: of the questions marked `unanswerable`, the share it refused. Under 1, off-topic questions reach the model.

`eval` exits 1 when a score is under its threshold, so it fails CI, and `--json` prints the report for other tools. Thresholds in the file can be overridden with `--min-hit-at-1`, `--min-hit-at-3`, `--min-refusal-precision` and `--min-refusal-recall`, and `retrieval` in the file takes the handler's retrieval settings, so the eval scores what the endpoint runs.

It runs what the endpoint runs before the model, embedding each question as the index was, so it calls no language model. With an embedded index it makes one embedding call per question, with the key the index's model needs; `--keyword-only` makes none. It measures retrieval and the relevance gate, not the wording of the answers.

This repository runs two eval files in CI: one of this site's own questions against the website's index, and one of the 22 questions and 6 off-topic ones the 2026-10-10 audit asked of docusaurus.io's docs, where keyword search scores hit@1 14 of 22, hit@3 18 of 22, and refuses all 6 off-topic questions and 2 it should answer. Copy `test/eval/docusaurus.io.yaml` from the repository as a start. When you change `minSimilarity` or `minKeywordCoverage`, the eval shows what moved.

## With OpenAI's embeddings

The eval of docusaurus.io's docs in CI searches by keywords only, since embedding them needs a key. The [retrieval eval workflow](https://github.com/dgesteves/ondocs/blob/main/.github/workflows/retrieval-eval.yml) measures them with embeddings, run by hand: it indexes the same docs, at the same pinned commit, with OpenAI's `text-embedding-3-small` at 512 dimensions, the plugins' default, and runs `ondocs eval` with the same 22 questions and 6 off-topic ones. It scores the relevance gate at a `minSimilarity` of 0.15, 0.20, 0.25 (the default for OpenAI's models), 0.30, 0.35 and 0.40, and reports how close each question's nearest chunk is, to check that 0.25 suits this model. It counts the chunks before it embeds any and stops above 1,500 (the docs are 1,070), and it keeps the report and the index with the run. `node scripts/retrieval-eval.mjs --stub` runs the same steps against a local stand-in for OpenAI's API, with no key and no cost.

> **Not run yet.** The results go here after the first run, with its date, the ondocs version and the commit of docusaurus.io's docs.

| Search                                         | Right page first | Right page in the top 3 | Off-topic questions answered | Answerable questions refused |
| ---------------------------------------------- | ---------------- | ----------------------- | ---------------------------- | ---------------------------- |
| Keywords only                                  | 14 of 22         | 18 of 22                | 0 of 6                       | 2 of 22                      |
| Keywords and text-embedding-3-small, gate 0.25 | not run yet      | not run yet             | not run yet                  | not run yet                  |

The gate from 0.15 to 0.40: not run yet.

## Feedback from readers

Give the handler an `onFeedback`, and the dialog asks "Was this helpful?" under each answer, with thumbs up and down, and then offers a comment:

```ts
export const POST = createAskHandler({
  index,
  model,
  onFeedback: ({ rating, comment, id, question }) => {
    console.log(JSON.stringify({ feedback: rating, comment, id, question }));
  },
});
```

The dialog posts the rating to the same endpoint, with the question, the answer and its sources as the reader saw them, and a comment as a second call with the same `id`. That `id` is the answer's, the one `onFinish` gets, so you can join a rating to everything else about the answer. Without `onFeedback` the dialog shows no thumbs, and a posted rating gets a 400. A rating counts against the rate limit like a question, and costs no model call.

## Questions your docs do not answer

`onFinish` runs after every answer. Two of its fields mark the questions worth reading:

- **`refused`**: nothing in the docs cleared the relevance gate, so the reader got "I don't know" and the model was not called.
- **`lowConfidence`**: the model answered but cited none of its sources, which usually means it said the sources do not cover the question.

Together they are the content gaps: the questions to write pages for, or the words your pages should use. Log them wherever suits you. To a file, on a server you run:

```ts
import { appendFile } from 'node:fs/promises';

onFinish: async ({ question, refused, lowConfidence, followUp, retrieval }) => {
  if (!refused && !lowConfidence) return;
  const line = { at: new Date().toISOString(), question, asked: followUp?.question, refused, best: retrieval.best };
  await appendFile('unanswered.jsonl', `${JSON.stringify(line)}\n`);
},
```

To a KV store, in a Cloudflare Worker with a KV namespace bound as `GAPS`:

```ts
onFinish: async ({ id, question, refused, lowConfidence }) => {
  if (refused || lowConfidence) {
    await env.GAPS.put(`${new Date().toISOString().slice(0, 10)}:${id}`, question, { expirationTtl: 90 * 86_400 });
  }
},
```

Or to a webhook, such as a Slack channel's:

```ts
onFinish: async ({ question, refused, lowConfidence }) => {
  if (refused || lowConfidence) {
    await fetch(process.env.GAPS_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `Unanswered: ${question}` }),
    });
  }
},
```

`onFinish` runs after the answer has streamed, so a slow log never delays the reader, and if it throws the error goes to `onError`. Then read the log now and then: `jq -r .question unanswered.jsonl | sort | uniq -c | sort -rn` lists the questions asked most. The ones that should be answerable, but are not, go in your eval file next.

## What leaves your site

Nothing, unless you send it. The questions and ratings reach your endpoint, and go no further than the code you write in `onFinish` and `onFeedback`; ondocs sends no telemetry and keeps no store. A question is what a reader typed, so it can hold personal details: log only what you need, with no IP address, and keep it only as long as you use it. See [Rate limits and security](/docs/security#privacy-what-leaves-your-servers).
