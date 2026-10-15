---
'ondocs': patch
---

A model call that fails no longer uses up the day's token `budget`. An answer the model fails before it writes a word, from a bad key, a quota, an outage or a timeout, now gives its reservation back, and so does a follow-up's rewrite that fails. Before, each one kept its worst case counted, so an outage could leave the endpoint answering 429 `budget_exceeded` until midnight UTC with nothing spent. An answer the visitor abandons still keeps its reservation.

Answers also time out by default now: 30 seconds for the model's first word and 90 seconds in all, so a provider that stalls ends the answer, and the dialog says it was cut off, instead of holding it open. Your own `generation.timeout` replaces both. A follow-up's rewrite gives up after 20 seconds, and the question is answered as it was asked.
