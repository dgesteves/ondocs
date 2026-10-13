---
'ondocs': patch
---

Code in an answer is coloured: comments, strings, numbers, keywords, and the keys of JSON and YAML, by a small tokenizer that adds about 1 KB gzipped to the dialog and still renders the model's text as text. The colours are custom properties, `--ask-code-comment`, `--ask-code-keyword`, `--ask-code-string`, `--ask-code-number` and `--ask-code-property`, set for the light and dark themes at 4.5:1 or more; outside the dialog, set them where you render `AskAnswer`. A code block also names its fence's language in `data-lang`.
