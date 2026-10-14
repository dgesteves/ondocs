---
'ondocs': minor
---

The dialog's footer no longer says "Check the sources." when it shows none: after a refusal ("I don't know.", from the gate or the model), an answer that cites none, or an error, such as a rate limit or the day's budget running out. It shows the new `footerNoSources` label there, "Answers come from this site and can be wrong.", and the usual `footer` again once an answer shows its sources. An error after the sources have streamed keeps them, and the usual `footer`. A site that gives its own `footer` label and not `footerNoSources` keeps its `footer` there, so its footer stays in its language.
