---
'ondocs': patch
---

The dialog's footer no longer says "Check the sources." under an answer that shows none: a refusal ("I don't know.", from the gate or the model) or an answer that cites none. It shows the new `footerNoSources` label there, "Answers come from this site and can be wrong.", and the usual `footer` again once an answer shows its sources. A site that gives its own `footer` label and not `footerNoSources` keeps its `footer` there, so its footer stays in its language.
